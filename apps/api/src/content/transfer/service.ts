import { createHash, randomUUID } from 'node:crypto';
import { pipeline, Transform, type Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../db/index.js';
import { AppError } from '../../helpers/appError.js';
import { describeError } from '../../helpers/errors.js';
import { enqueueJob } from '../../jobs/queue.js';
import type { MediaStorage, StorageDriver } from '../../media/types.js';
import type { FieldVisibilityLookup } from '../../permissions/policy.js';
import { GLOBAL_ACTIONS, type ContentAction, type PermissionEvaluator } from '../../permissions/types.js';
import type { PublishingRuntime } from '../../publishing/runtime.js';
import * as jobsRepository from '../../repositories/jobs.js';
import * as mediaAssetsRepository from '../../repositories/mediaAssets.js';
import type { SiteActorContext } from '../../services/actorContext.js';
import { recordAudit } from '../../services/audit.js';
import type { SchemaServiceContext } from '../../services/schemaAccess.js';
import { applyConfig } from './applyConfig.js';
import { removeStoredBundle, stageBundle, storeBundle } from './bundleFile.js';
import { createExportStream } from './export.js';
import type { ExportOptions } from './format.js';
import { isAssetKey } from './importMedia.js';
import { TRANSFER_IMPORT_JOB, TRANSFER_IMPORT_MAX_ATTEMPTS, type ImportPayload } from './job.js';
import { StreamClosedError } from './ndjson.js';
import { planImport, type ImportDiff, type ImportOptions, type ImportPlan } from './plan.js';

/**
 * Content export and import (package L): `GET /api/admin/transfer/export`, `POST …/import`, the import's
 * progress and media file transfer. Both directions cover the whole instance (schema, locales, roles,
 * content, media, publishing config), so they need an instance administrator: every global permission and
 * every content action on every model, which the built-in owner and admin roles hold.
 */
export type TransferContext = SiteActorContext & {
  db: Database;
  permissions: PermissionEvaluator;
  storage: MediaStorage;
  /** A schema service context on the current snapshot (re-read when an import step moves the schema). */
  schemaContext: () => Promise<SchemaServiceContext>;
  publishing: PublishingRuntime;
  fieldVisibility: FieldVisibilityLookup;
  log: FastifyBaseLogger;
  maxUploadBytes: number;
};

const EXPORT_ACTIONS: readonly ContentAction[] = ['read'];
const IMPORT_ACTIONS: readonly ContentAction[] = [
  'read',
  'create',
  'update',
  'delete',
  'publish',
  'schemaManage',
];

const forbidden = () =>
  new AppError(403, 'FORBIDDEN', 'Exporting and importing content needs an owner or admin role');

const assertInstanceAdmin = async (context: TransferContext, actions: readonly ContentAction[]) => {
  for (const action of GLOBAL_ACTIONS) {
    if (!(await context.permissions.canPerform(context.actor, action))) {
      throw forbidden();
    }
  }
  const { snapshot } = await context.schemaContext();
  for (const { definition } of snapshot.definitions) {
    for (const action of actions) {
      if (!(await context.permissions.evaluate(context.actor, { action, modelId: definition.id })).allowed) {
        throw forbidden();
      }
    }
  }
};

const audit = (
  context: TransferContext,
  action: string,
  metadata: Record<string, unknown>,
  target?: string,
) =>
  recordAudit(context.db, {
    actor: context.actor,
    site: context.site,
    action,
    metadata,
    ...(target ? { target: { type: 'transfer', id: target } } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
  });

/** Streams the bundle (NDJSON). Exports are audited: they can carry app users' password hashes. */
export const exportBundle = async (context: TransferContext, options: ExportOptions): Promise<Readable> => {
  await assertInstanceAdmin(context, EXPORT_ACTIONS);
  await audit(context, 'transfer.export', options);
  return createExportStream(context.db, context.site.id, options, (error) => {
    if (!(error instanceof StreamClosedError)) {
      context.log.error({ err: error }, 'content export failed');
    }
  });
};

export type ImportResponse =
  | { dryRun: true; diff: ImportDiff }
  | {
      dryRun: false;
      importId: string;
      diff: ImportDiff;
      webhookSecrets: Array<{ id: string; name: string; secret: string }>;
    };

const conflictError = (diff: ImportDiff) =>
  new AppError(
    409,
    'TRANSFER_CONFLICT',
    'The target changed things the bundle also has. Nothing was imported; see the plan for the conflicts.',
    { diff },
  );

/** Applies the instance-wide part of a planned import and queues the job that reads the stored bundle. */
const applyAndQueue = async (
  context: TransferContext,
  plan: ImportPlan,
  payload: Omit<ImportPayload, 'pendingChangeIds'>,
) => {
  const applied = await applyConfig(
    {
      schemaContext: context.schemaContext,
      actor: context,
      publishing: context.publishing,
      fieldVisibility: context.fieldVisibility,
    },
    plan,
  );
  const { job } = await enqueueJob({
    type: TRANSFER_IMPORT_JOB,
    payload: { ...payload, pendingChangeIds: applied.pendingChangeIds } satisfies ImportPayload,
    idempotencyKey: `${TRANSFER_IMPORT_JOB}:${payload.importId}`,
    maxAttempts: TRANSFER_IMPORT_MAX_ATTEMPTS,
  });
  return { applied, job };
};

/**
 * Plans an import and, unless `dryRun`, applies the instance-wide part (locales, schema, roles, publishing
 * config, folders) and queues the `transfer.import` job for users, media and entries. Conflicts refuse the
 * whole import before anything is written.
 */
export const importBundle = async (
  context: TransferContext,
  input: Readable,
  options: ImportOptions & { dryRun: boolean },
): Promise<ImportResponse> => {
  await assertInstanceAdmin(context, IMPORT_ACTIONS);
  const staged = await stageBundle(input);
  try {
    const plan = await planImport(await context.schemaContext(), staged.open(), options);
    if (options.dryRun) {
      return { dryRun: true, diff: plan.diff };
    }
    if (plan.diff.conflicts > 0) {
      throw conflictError(plan.diff);
    }
    const importId = randomUUID();
    const bundle = await storeBundle(context.storage, staged, importId);
    const { applied, job } = await applyAndQueue(context, plan, {
      importId,
      siteId: context.site.id,
      bundle,
      prune: options.prune,
    }).catch(async (error: unknown) => {
      // No job will ever read the stored bundle: remove it, as the job would have.
      await removeStoredBundle(context.storage, bundle).catch((cleanupError: unknown) =>
        context.log.warn(
          { err: describeError(cleanupError), key: bundle.key },
          'could not remove the bundle of a failed import',
        ),
      );
      throw error;
    });
    await audit(context, 'transfer.import', { importId, jobId: job.id, prune: options.prune }, job.id);
    return { dryRun: false, importId: job.id, diff: plan.diff, webhookSecrets: applied.webhookSecrets };
  } finally {
    await staged.remove();
  }
};

export type ImportStatus = {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  /** The job's checkpoint while it runs, its result once it succeeded. */
  progress: unknown;
  createdAt: Date;
  finishedAt: Date | null;
};

const importNotFound = (id: string) => new AppError(404, 'IMPORT_NOT_FOUND', `No import ${id}`, { id });

export const getImportStatus = async (context: TransferContext, id: string): Promise<ImportStatus> => {
  await assertInstanceAdmin(context, EXPORT_ACTIONS);
  const job = await jobsRepository.findById(id, context.db);
  if (!job || job.type !== TRANSFER_IMPORT_JOB) {
    throw importNotFound(id);
  }
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    lastError: job.last_error,
    progress: job.status === 'succeeded' ? job.result : job.checkpoint,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
  };
};

const assetNotFound = (id: string) => new AppError(404, 'NOT_FOUND', `No media asset ${id}`, { id });

/** An asset's original file, read through its storage adapter (`shapio export --with-media`). */
export const readMediaFile = async (context: TransferContext, assetId: string) => {
  await assertInstanceAdmin(context, EXPORT_ACTIONS);
  const asset = await mediaAssetsRepository.findLiveOnSite(context.site.id, assetId, context.db);
  if (!asset) {
    throw assetNotFound(assetId);
  }
  const adapter = context.storage.get(asset.storage_driver as StorageDriver);
  return {
    stream: await adapter.getStream(asset.storage_key),
    mimeType: asset.mime_type,
    sizeBytes: Number(asset.size_bytes),
  };
};

export type MediaUpload = { storageKey: string; sha256: string; sizeBytes: number; mimeType: string };

/** Copies a stream to storage while hashing it. */
const putHashed = async (storage: MediaStorage, input: Readable, upload: MediaUpload) => {
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      size += chunk.length;
      done(null, chunk);
    },
  });
  const source = pipeline(input, counter, () => undefined);
  await storage.active.put(upload.storageKey, source, {
    contentType: upload.mimeType,
    contentLength: upload.sizeBytes,
  });
  return { sha256: hash.digest('hex'), size };
};

/**
 * Stores one media file of a bundle before its import (`shapio import` with a `--with-media` bundle), at the
 * bundle's key in the active storage, verified against the manifest's checksum and size. Refuses keys that
 * do not belong to the asset and assets the target already has.
 */
export const writeMediaFile = async (
  context: TransferContext,
  assetId: string,
  input: Readable,
  upload: MediaUpload,
): Promise<{ stored: boolean }> => {
  await assertInstanceAdmin(context, IMPORT_ACTIONS);
  if (
    !isAssetKey({
      id: assetId,
      storageKey: upload.storageKey,
      visibility: upload.storageKey.startsWith('private/') ? 'private' : 'public',
    })
  ) {
    throw new AppError(
      400,
      'MEDIA_KEY_INVALID',
      `${upload.storageKey} is not a storage key of asset ${assetId}`,
    );
  }
  if (upload.sizeBytes > context.maxUploadBytes) {
    throw new AppError(
      413,
      'MEDIA_TOO_LARGE',
      `The file is larger than MEDIA_MAX_UPLOAD_BYTES (${context.maxUploadBytes})`,
    );
  }
  // Asset IDs are unique across sites: an asset of this ID anywhere (any site, deleted or not) is a conflict.
  const existing = await mediaAssetsRepository.findById(assetId, context.db);
  if (existing) {
    if (existing.storage_key === upload.storageKey && existing.checksum_sha256 === upload.sha256) {
      input.resume();
      return { stored: false };
    }
    throw new AppError(
      409,
      'MEDIA_EXISTS',
      `Asset ${assetId} already exists on the target with another file`,
    );
  }
  const written = await putHashed(context.storage, input, upload);
  if (written.sha256 !== upload.sha256 || written.size !== upload.sizeBytes) {
    await context.storage.active.delete(upload.storageKey);
    throw new AppError(422, 'MEDIA_CHECKSUM_MISMATCH', 'The file does not match its checksum and size', {
      expected: { sha256: upload.sha256, sizeBytes: upload.sizeBytes },
      received: { sha256: written.sha256, sizeBytes: written.size },
    });
  }
  return { stored: true };
};
