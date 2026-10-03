import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Transaction } from 'kysely';
import { JOB_PRIORITY } from '../constants/jobPriorities.js';
import {
  MEDIA_EVENTS,
  MEDIA_GRANT_EXPIRE_JOB,
  MEDIA_JOB_MAX_ATTEMPTS,
  MEDIA_PROCESS_JOB,
  MEDIA_SNIFF_SAMPLE_BYTES,
  MEDIA_UPLOAD_CONFIRM_GRACE_SECONDS,
  MEDIA_UPLOAD_GRANT_TTL_SECONDS,
  MEDIA_UPLOAD_ROUTE_PREFIX,
} from '../constants/media.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { enqueueJob } from '../jobs/queue.js';
import { readStream } from '../media/checksum.js';
import { buildAssetKey, sanitizeFilename, visibilityOfKey, type MediaVisibility } from '../media/keys.js';
import { enqueuePurge } from '../media/purge.js';
import { signUploadGrant, verifyUploadGrant } from '../media/signing.js';
import { isMimeTypeAllowed, normalizeMimeType, sniffMediaType } from '../media/sniff.js';
import type { StorageAdapter, StorageDriver } from '../media/types.js';
import type { Principal } from '../permissions/types.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as mediaFoldersRepository from '../repositories/mediaFolders.js';
import * as mediaUploadGrantsRepository from '../repositories/mediaUploadGrants.js';
import type { MediaUploadGrantRow } from '../repositories/mediaUploadGrants.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import { recordAudit } from './audit.js';
import type { MediaServiceContext } from './mediaContext.js';
import { toAssetViewOne, type MediaAssetView } from './mediaViews.js';

export type UploadGrantInput = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  visibility?: MediaVisibility;
};

/** How the client sends the bytes; the same for every driver: a multipart POST of `fields`, then `file`. */
export type UploadInstructions = {
  method: 'POST';
  url: string;
  fields: Record<string, string>;
  fileField: 'file';
};

export type UploadGrantView = {
  grantId: string;
  assetId: string;
  expiresAt: Date;
  maxSizeBytes: number;
  upload: UploadInstructions;
};

/** Grants are confirmed by whoever asked for them. */
const principalKey = (actor: Principal): string => {
  switch (actor.kind) {
    case 'admin':
      return `admin:${actor.adminUserId}`;
    case 'token':
      return `token:${actor.tokenId}`;
    case 'appUser':
      return `appUser:${actor.appUserId}`;
    case 'system':
      return `system:${actor.component}`;
    case 'anonymous':
      return 'anonymous';
  }
};

const adminIdOf = (actor: Principal): string | null => (actor.kind === 'admin' ? actor.adminUserId : null);

const toUnixSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const assertUploadAllowed = (context: MediaServiceContext, input: UploadGrantInput): string => {
  const mimeType = normalizeMimeType(input.mimeType);
  if (!isMimeTypeAllowed(mimeType, context.limits.allowedTypes)) {
    throw new AppError(415, 'TYPE_NOT_ALLOWED', `Uploads of type ${mimeType} are not allowed`, {
      allowedTypes: context.limits.allowedTypes,
    });
  }
  if (input.sizeBytes > context.limits.maxUploadBytes) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than the upload limit', {
      maxSizeBytes: context.limits.maxUploadBytes,
    });
  }
  return mimeType;
};

const uploadInstructions = async (
  context: MediaServiceContext,
  adapter: StorageAdapter,
  grant: MediaUploadGrantRow,
): Promise<UploadInstructions> => {
  if (adapter.presignedUpload) {
    const { url, fields } = await adapter.presignedUpload({
      key: grant.storage_key,
      contentType: grant.declared_mime_type,
      maxSizeBytes: Number(grant.max_size_bytes),
      expiresInSeconds: MEDIA_UPLOAD_GRANT_TTL_SECONDS,
    });
    return { method: 'POST', url, fields, fileField: 'file' };
  }
  // Without direct uploads the bytes go to Shapio, authorised by a signature in the form (like an S3
  // policy), so the client flow is identical and no cookie or CSRF token is involved.
  const expires = toUnixSeconds(grant.expires_at);
  return {
    method: 'POST',
    url: context.urls.absoluteUrl(`${MEDIA_UPLOAD_ROUTE_PREFIX}${grant.id}`),
    fields: {
      'Content-Type': grant.declared_mime_type,
      expires: String(expires),
      signature: signUploadGrant(context.signingSecret, grant.id, expires),
    },
    fileField: 'file',
  };
};

type GrantTarget = {
  kind: 'create' | 'replace';
  assetId: string;
  folderId: string | null;
  visibility: MediaVisibility;
};

const insertGrant = async (
  context: MediaServiceContext,
  input: UploadGrantInput,
  mimeType: string,
  target: GrantTarget,
): Promise<UploadGrantView> => {
  const adapter = context.storage.active;
  const filename = sanitizeFilename(input.filename);
  const expiresAt = new Date(Date.now() + MEDIA_UPLOAD_GRANT_TTL_SECONDS * 1000);
  const grant = await db.transaction().execute(async (trx) => {
    const row = await mediaUploadGrantsRepository.insert(
      {
        site_id: context.site.id,
        asset_id: target.assetId,
        kind: target.kind,
        storage_driver: adapter.driver,
        storage_key: buildAssetKey(target.visibility, target.assetId, filename),
        original_filename: filename,
        declared_mime_type: mimeType,
        max_size_bytes: context.limits.maxUploadBytes,
        folder_id: target.folderId,
        visibility: target.visibility,
        created_by: adminIdOf(context.actor),
        created_by_principal: principalKey(context.actor),
        expires_at: expiresAt,
      },
      trx,
    );
    // Removes the object if the upload is never confirmed.
    await enqueueJob(
      {
        type: MEDIA_GRANT_EXPIRE_JOB,
        payload: { grantId: row.id },
        runAt: new Date(expiresAt.getTime() + MEDIA_UPLOAD_CONFIRM_GRACE_SECONDS * 1000),
        idempotencyKey: `${MEDIA_GRANT_EXPIRE_JOB}:${row.id}`,
        maxAttempts: MEDIA_JOB_MAX_ATTEMPTS,
      },
      trx,
    );
    return row;
  });
  return {
    grantId: grant.id,
    assetId: grant.asset_id,
    expiresAt: grant.expires_at,
    maxSizeBytes: Number(grant.max_size_bytes),
    upload: await uploadInstructions(context, adapter, grant),
  };
};

/** The upload's folder must be on the request's site; another site's folder reads as missing. */
const assertFolderExists = async (context: MediaServiceContext, folderId: string | null | undefined) => {
  if (folderId && !(await mediaFoldersRepository.findById(context.site.id, folderId))) {
    throw new AppError(400, 'FOLDER_NOT_FOUND', 'The folder does not exist');
  }
};

/** Step 1 of an upload: limits checked, asset ID and storage key fixed, upload instructions returned. */
export const createUploadGrant = async (
  context: MediaServiceContext,
  input: UploadGrantInput,
): Promise<UploadGrantView> => {
  const mimeType = assertUploadAllowed(context, input);
  await assertFolderExists(context, input.folderId);
  return insertGrant(context, input, mimeType, {
    kind: 'create',
    assetId: randomUUID(),
    folderId: input.folderId ?? null,
    visibility: input.visibility ?? 'public',
  });
};

/** Step 1 of replacing an asset's file: same flow; confirm swaps the file and keeps the asset's ID. */
export const createReplaceGrant = async (
  context: MediaServiceContext,
  assetId: string,
  input: Omit<UploadGrantInput, 'folderId' | 'visibility'>,
): Promise<UploadGrantView> => {
  const mimeType = assertUploadAllowed(context, input);
  const asset = await mediaAssetsRepository.findLiveOnSite(context.site.id, assetId);
  if (!asset) {
    throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
  }
  return insertGrant(context, input, mimeType, {
    kind: 'replace',
    assetId,
    folderId: asset.folder_id,
    visibility: asset.visibility as MediaVisibility,
  });
};

/** The multipart body of a local upload: form fields sent before the file, and the file itself. */
export type ReceivedUpload = {
  fields: Readonly<Record<string, string | undefined>>;
  file: Readable;
  /** True once the file stream was cut at the size limit. */
  truncated: () => boolean;
};

const goneGrant = () =>
  new AppError(404, 'UPLOAD_GRANT_INVALID', 'This upload grant is unknown, used or expired');

/**
 * Local driver only: receives the bytes of a grant (the S3 driver's browser uploads go to the bucket).
 * Authorised by the grant's signature, not by a session. `readUpload` parses the request with the grant's
 * size limit; the bytes stream to disk and are re-checked on confirm.
 */
export const receiveLocalUpload = async (
  context: Pick<MediaServiceContext, 'storage' | 'signingSecret'>,
  grantId: string,
  readUpload: (maxSizeBytes: number) => Promise<ReceivedUpload | undefined>,
): Promise<void> => {
  const grant = await mediaUploadGrantsRepository.findById(grantId);
  if (
    !grant ||
    grant.status !== 'pending' ||
    grant.storage_driver !== 'local' ||
    grant.expires_at <= new Date()
  ) {
    throw goneGrant();
  }
  const upload = await readUpload(Number(grant.max_size_bytes));
  if (!upload) {
    throw new AppError(400, 'FILE_MISSING', 'The form has no file');
  }
  const { fields } = upload;
  const check = verifyUploadGrant(
    context.signingSecret,
    grant.id,
    Number(fields.expires),
    fields.signature ?? '',
  );
  if (check !== 'valid' || fields['Content-Type'] !== grant.declared_mime_type) {
    upload.file.resume();
    throw check === 'expired'
      ? goneGrant()
      : new AppError(403, 'UPLOAD_SIGNATURE_INVALID', 'Invalid upload signature');
  }
  const adapter = context.storage.get('local');
  await adapter.put(grant.storage_key, upload.file, { contentType: grant.declared_mime_type });
  if (upload.truncated()) {
    await adapter.delete(grant.storage_key);
    throw new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than the upload limit', {
      maxSizeBytes: Number(grant.max_size_bytes),
    });
  }
};

const rejectUpload = async (adapter: StorageAdapter, grant: MediaUploadGrantRow, error: AppError) => {
  await adapter.delete(grant.storage_key);
  await mediaUploadGrantsRepository.setStatus(grant.id, 'rejected');
  return error;
};

/** Verifies the uploaded object: present, within the limit, and of an allowed type judged by its bytes. */
const inspectUpload = async (
  context: MediaServiceContext,
  adapter: StorageAdapter,
  grant: MediaUploadGrantRow,
) => {
  const info = await adapter.head(grant.storage_key);
  if (!info) {
    throw new AppError(400, 'UPLOAD_MISSING', 'No file was uploaded for this grant');
  }
  if (info.size === 0) {
    throw await rejectUpload(adapter, grant, new AppError(400, 'FILE_EMPTY', 'The file is empty'));
  }
  if (info.size > Number(grant.max_size_bytes)) {
    throw await rejectUpload(
      adapter,
      grant,
      new AppError(413, 'FILE_TOO_LARGE', 'The file is larger than the upload limit', {
        maxSizeBytes: Number(grant.max_size_bytes),
      }),
    );
  }
  const sampleSize = Math.min(info.size, MEDIA_SNIFF_SAMPLE_BYTES);
  const sample = await readStream(
    await adapter.getStream(grant.storage_key, { start: 0, end: sampleSize - 1 }),
    sampleSize,
  );
  const sniffed = await sniffMediaType(sample, grant.declared_mime_type, context.limits.allowedTypes);
  if (!sniffed.ok) {
    throw await rejectUpload(
      adapter,
      grant,
      new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file content is not an allowed type', {
        reason: sniffed.code,
        detected: sniffed.detected ?? null,
        declared: grant.declared_mime_type,
      }),
    );
  }
  return { sizeBytes: info.size, mimeType: sniffed.mimeType };
};

const enqueueProcessing = (trx: Transaction<DB>, assetId: string, storageKey: string) =>
  enqueueJob(
    {
      type: MEDIA_PROCESS_JOB,
      payload: { assetId, storageKey },
      priority: JOB_PRIORITY.interactive,
      idempotencyKey: `${MEDIA_PROCESS_JOB}:${storageKey}`,
      maxAttempts: MEDIA_JOB_MAX_ATTEMPTS,
    },
    trx,
  );

type InspectedUpload = { sizeBytes: number; mimeType: string };

const recordNewAsset = async (
  trx: Transaction<DB>,
  context: MediaServiceContext,
  grant: MediaUploadGrantRow,
  upload: InspectedUpload,
) => {
  const folderId =
    grant.folder_id && (await mediaFoldersRepository.findById(grant.site_id, grant.folder_id, trx))
      ? grant.folder_id
      : null;
  const asset = await mediaAssetsRepository.insert(
    {
      id: grant.asset_id,
      // The site the upload was granted on (the folder, if any, is on the same site: composite key).
      site_id: grant.site_id,
      folder_id: folderId,
      storage_driver: grant.storage_driver,
      storage_key: grant.storage_key,
      original_filename: grant.original_filename,
      mime_type: upload.mimeType,
      size_bytes: upload.sizeBytes,
      visibility: grant.visibility,
      status: 'processing',
      created_by: adminIdOf(context.actor),
    },
    trx,
  );
  await recordAudit(trx, {
    ...context,
    action: 'media.upload',
    target: { type: 'media_asset', id: asset.id },
    metadata: { filename: asset.original_filename, mimeType: asset.mime_type, sizeBytes: upload.sizeBytes },
  });
  await writeOutboxEvent(trx, {
    type: MEDIA_EVENTS.created,
    siteId: grant.site_id,
    aggregateType: 'media_asset',
    aggregateId: asset.id,
    payload: { assetId: asset.id },
  });
  return asset;
};

const recordReplacement = async (
  trx: Transaction<DB>,
  context: MediaServiceContext,
  grant: MediaUploadGrantRow,
  upload: InspectedUpload,
) => {
  const current = await mediaAssetsRepository.lockOnSite(grant.site_id, grant.asset_id, trx);
  if (!current || current.deleted_at !== null) {
    throw new AppError(404, 'NOT_FOUND', 'Media asset not found');
  }
  if (visibilityOfKey(grant.storage_key) !== current.visibility) {
    throw new AppError(
      409,
      'ASSET_CHANGED',
      'The asset changed visibility since the upload started; upload again',
    );
  }
  const oldVariantKeys = await mediaVariantsRepository.deleteForAsset(current.id, trx);
  const asset = await mediaAssetsRepository.update(
    current.id,
    {
      storage_driver: grant.storage_driver,
      storage_key: grant.storage_key,
      original_filename: grant.original_filename,
      mime_type: upload.mimeType,
      size_bytes: upload.sizeBytes,
      width: null,
      height: null,
      checksum_sha256: null,
      status: 'processing',
      processing_error: null,
      version: current.version + 1,
    },
    trx,
  );
  const driver = current.storage_driver as StorageDriver;
  await enqueuePurge(
    trx,
    [current.storage_key, ...oldVariantKeys].map((key) => ({ driver, key })),
  );
  await recordAudit(trx, {
    ...context,
    action: 'media.replace',
    target: { type: 'media_asset', id: asset.id },
    metadata: {
      previousFilename: current.original_filename,
      previousChecksumSha256: current.checksum_sha256,
      filename: asset.original_filename,
      mimeType: asset.mime_type,
      sizeBytes: upload.sizeBytes,
    },
  });
  await writeOutboxEvent(trx, {
    type: MEDIA_EVENTS.updated,
    siteId: grant.site_id,
    aggregateType: 'media_asset',
    aggregateId: asset.id,
    payload: { assetId: asset.id, replaced: true },
  });
  return asset;
};

/**
 * Step 3 of an upload: the server checks what actually arrived (never trusting the client), records the
 * asset (or swaps the file of the asset being replaced) and queues checksum, dimensions and variants.
 */
export const confirmUpload = async (
  context: MediaServiceContext,
  grantId: string,
): Promise<{ created: boolean; asset: MediaAssetView }> => {
  const grant = await mediaUploadGrantsRepository.findById(grantId);
  // A grant is completed by whoever asked for it, on the site it was granted on (sites plan §H).
  if (
    !grant ||
    grant.site_id !== context.site.id ||
    grant.created_by_principal !== principalKey(context.actor)
  ) {
    throw new AppError(404, 'NOT_FOUND', 'Upload grant not found');
  }
  if (grant.status !== 'pending') {
    throw new AppError(409, 'UPLOAD_GRANT_USED', 'This upload was already confirmed or rejected');
  }
  if (grant.expires_at.getTime() + MEDIA_UPLOAD_CONFIRM_GRACE_SECONDS * 1000 <= Date.now()) {
    throw new AppError(410, 'UPLOAD_GRANT_EXPIRED', 'This upload grant has expired; upload again');
  }
  const adapter = context.storage.get(grant.storage_driver as StorageDriver);
  const upload = await inspectUpload(context, adapter, grant);
  const asset = await db.transaction().execute(async (trx) => {
    const locked = await mediaUploadGrantsRepository.lockById(grantId, trx);
    if (locked?.status !== 'pending') {
      throw new AppError(409, 'UPLOAD_GRANT_USED', 'This upload was already confirmed or rejected');
    }
    const row =
      grant.kind === 'replace'
        ? await recordReplacement(trx, context, grant, upload)
        : await recordNewAsset(trx, context, grant, upload);
    await mediaUploadGrantsRepository.setStatus(grant.id, 'consumed', trx);
    await enqueueProcessing(trx, row.id, row.storage_key);
    return row;
  });
  return { created: grant.kind === 'create', asset: await toAssetViewOne(context, asset) };
};
