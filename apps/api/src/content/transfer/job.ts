import type { Readable } from 'node:stream';
import { PRIMARY_SITE_ID } from '../../constants/sites.js';
import type { Database } from '../../db/index.js';
import { AppError } from '../../helpers/appError.js';
import { describeError } from '../../helpers/errors.js';
import { PermanentJobError, type JobContext, type JobHandler } from '../../jobs/types.js';
import type { MediaStorage } from '../../media/types.js';
import { ALLOW_ALL_POLICY } from '../../permissions/policy.js';
import type { PermissionEvaluator, Principal } from '../../permissions/types.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import { loadSnapshot } from '../../schema/loadSnapshot.js';
import type { NetworkSchema, SchemaSnapshot } from '../../schema/snapshot.js';
import { buildContentContext } from '../../services/contentContext.js';
import { deleteEntry } from '../../services/contentEntries.js';
import { getSiteRef } from '../../services/sites.js';
import { openStoredBundle, removeStoredBundle, type StoredBundle } from './bundleFile.js';
import type { AppUserRecord, BundleRecord, EntryRecord, MediaAssetRecord } from './format.js';
import { importEntry } from './importEntry.js';
import { importMediaBatch } from './importMedia.js';
import { importUserBatch } from './importUsers.js';
import { readBundle } from './ndjson.js';

/**
 * The `transfer.import` job (package L): imports a bundle's users, media, entries and (with `--prune`)
 * removes target entries the bundle does not have. It is resumable: each phase reads the stored bundle from
 * the start, skips the lines its checkpoint says are done, and saves the checkpoint after every batch, so a
 * worker crash or restart continues where it stopped. Every write is idempotent by stable ID.
 */
export const TRANSFER_IMPORT_JOB = 'transfer.import';
export const TRANSFER_IMPORT_MAX_ATTEMPTS = 20;

const PHASES = ['waiting', 'users', 'media', 'entries', 'content', 'prune', 'cleanup'] as const;
export type ImportPhase = (typeof PHASES)[number];

const BATCH_SIZE = 100;
const ERROR_LIMIT = 100;
/** Prune rounds: entries referenced by other pruned entries go once those are gone. */
const PRUNE_ROUNDS = 5;

export type ImportPayload = {
  importId: string;
  /** The site the bundle is imported into (jobs queued before sites existed import into the primary site). */
  siteId: string;
  bundle: StoredBundle;
  prune: boolean;
  pendingChangeIds: string[];
};

export type ImportError = { id: string; code: string; message: string };

export type ImportProgress = {
  phase: ImportPhase;
  /** Last bundle line the current phase finished. */
  line: number;
  counts: {
    users: { added: number; unchanged: number };
    media: { added: number; unchanged: number };
    entries: { added: number; updated: number; unchanged: number };
    pruned: number;
  };
  errors: ImportError[];
  errorCount: number;
};

const initialProgress = (): ImportProgress => ({
  phase: 'waiting',
  line: 0,
  counts: {
    users: { added: 0, unchanged: 0 },
    media: { added: 0, unchanged: 0 },
    entries: { added: 0, updated: 0, unchanged: 0 },
    pruned: 0,
  },
  errors: [],
  errorCount: 0,
});

const isProgress = (value: unknown): value is ImportProgress =>
  typeof value === 'object' && value !== null && PHASES.includes((value as ImportProgress).phase);

const readPayload = (payload: unknown): ImportPayload => {
  const value = payload as Partial<ImportPayload> | null;
  if (!value?.importId || !value.bundle?.key || !value.bundle.driver) {
    throw new PermanentJobError('The transfer.import payload is incomplete');
  }
  return {
    importId: value.importId,
    siteId: value.siteId ?? PRIMARY_SITE_ID,
    bundle: value.bundle,
    prune: value.prune === true,
    pendingChangeIds: value.pendingChangeIds ?? [],
  };
};

/** The import acts as Shapio itself: the request that started it was authorised as an instance admin. */
const SYSTEM_ACTOR: Principal = { kind: 'system', component: 'transfer' };
const SYSTEM_PERMISSIONS: PermissionEvaluator = {
  evaluate: async () => ALLOW_ALL_POLICY,
  canPerform: async () => true,
  canPerformOnSite: async () => true,
};

export type TransferJobDependencies = { db: Database; storage: MediaStorage };

type Run = {
  deps: TransferJobDependencies;
  job: JobContext;
  payload: ImportPayload;
  progress: ImportProgress;
};

const save = async (run: Run) => {
  if (!(await run.job.saveCheckpoint(run.progress))) {
    throw new Error('Lost the job lease; another worker continues the import');
  }
};

const recordError = (run: Run, error: ImportError) => {
  run.progress.errorCount += 1;
  if (run.progress.errors.length < ERROR_LIMIT) {
    run.progress.errors.push(error);
  }
};

const open = (run: Run): Promise<Readable> => openStoredBundle(run.deps.storage, run.payload.bundle);

/** Calls `handle` with batches of one record type, from the checkpointed line on, saving after each batch. */
const forEachBatch = async <T extends BundleRecord>(
  run: Run,
  type: T['type'],
  handle: (batch: T[]) => Promise<void>,
) => {
  let batch: T[] = [];
  let last = run.progress.line;
  const flush = async () => {
    if (batch.length > 0) {
      await handle(batch);
      batch = [];
    }
    run.progress.line = last;
    await save(run);
    if (run.job.signal.aborted) {
      throw new Error('The import was interrupted by a shutdown; it resumes from its checkpoint');
    }
  };
  for await (const { line, record } of readBundle(await open(run))) {
    if (line <= run.progress.line || record.type !== type) {
      continue;
    }
    batch.push(record as T);
    last = line;
    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();
};

const waitForSchema = async (run: Run) => {
  const changes = await transferImportRepository.findSchemaChangeStatuses(run.payload.pendingChangeIds);
  const failed = changes.find((change) => change.status === 'failed' || change.status === 'cancelled');
  if (failed) {
    throw new PermanentJobError(`Schema change ${failed.id} failed: ${JSON.stringify(failed.error)}`);
  }
  if (changes.some((change) => change.status !== 'activated')) {
    // Retried with backoff until the planned changes (e.g. index builds) are active.
    throw new Error('Waiting for the imported schema changes to activate');
  }
};

const importUsers = (run: Run) =>
  forEachBatch<AppUserRecord>(run, 'appUser', async (batch) => {
    const result = await importUserBatch(run.deps.db, run.payload.siteId, batch);
    run.progress.counts.users.added += result.added;
    run.progress.counts.users.unchanged += result.unchanged;
    result.errors.forEach((error) => recordError(run, error));
  });

const importMedia = (run: Run) =>
  forEachBatch<MediaAssetRecord>(run, 'mediaAsset', async (batch) => {
    const result = await importMediaBatch(run.deps.db, run.deps.storage, run.payload.siteId, batch);
    run.progress.counts.media.added += result.added;
    run.progress.counts.media.unchanged += result.unchanged;
    result.errors.forEach((error) => recordError(run, error));
  });

/** The target site's view of the current schema: entries of other sites' models read as unknown. */
const loadSiteSnapshot = async (run: Run): Promise<SchemaSnapshot> =>
  (await loadSnapshot(run.deps.db)).forSite(run.payload.siteId);

/** Entry rows first (IDs only), so relations between bundle entries resolve whatever their order. */
const importEntryRows = (run: Run, snapshot: SchemaSnapshot) =>
  forEachBatch<EntryRecord>(run, 'entry', async (batch) => {
    const owners = await transferImportRepository.findAppUsers(
      batch.flatMap((entry) => (entry.ownerAppUserId ? [entry.ownerAppUserId] : [])),
      [],
    );
    await transferImportRepository.insertEntries(
      run.payload.siteId,
      batch
        .filter((entry) => snapshot.byId.has(entry.modelId))
        .map((entry) => ({
          ...entry,
          ownerAppUserId:
            entry.ownerAppUserId && owners.ids.has(entry.ownerAppUserId) ? entry.ownerAppUserId : null,
        })),
      run.deps.db,
    );
  });

/** Problems with one entry (invalid data, a conflict, a constraint the bundle breaks) are reported, not retried. */
const entryFailure = (error: unknown): Omit<ImportError, 'id'> | undefined => {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: `${error.message}${error.details ? ` ${JSON.stringify(error.details)}` : ''}`,
    };
  }
  const code = (error as { code?: unknown } | null)?.code;
  // SQLSTATE class 23: integrity constraint violations.
  return typeof code === 'string' && code.startsWith('23')
    ? { code: 'CONSTRAINT_VIOLATION', message: describeError(error) }
    : undefined;
};

const importContent = async (run: Run, initial: SchemaSnapshot) => {
  let snapshot = initial;
  const context = { db: run.deps.db, actor: SYSTEM_ACTOR, siteId: run.payload.siteId };
  await forEachBatch<EntryRecord>(run, 'entry', async (batch) => {
    for (const entry of batch) {
      try {
        let outcome;
        try {
          outcome = await importEntry(context, snapshot, entry);
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'SCHEMA_CHANGED') {
            throw error;
          }
          snapshot = await loadSiteSnapshot(run);
          outcome = await importEntry(context, snapshot, entry);
        }
        run.progress.counts.entries[outcome] += 1;
      } catch (error) {
        const failure = entryFailure(error);
        if (!failure) {
          throw error;
        }
        recordError(run, { id: entry.id, ...failure });
      }
    }
  });
};

/** Deletes live target entries of the bundle's models that the bundle does not have. */
const prune = async (run: Run, network: NetworkSchema) => {
  const keep = new Set<string>();
  const models = new Set<string>();
  for await (const { record } of readBundle(await open(run))) {
    if (record.type === 'entry') {
      keep.add(record.id);
      models.add(record.modelId);
    }
  }
  const context = buildContentContext({
    db: run.deps.db,
    network,
    permissions: SYSTEM_PERMISSIONS,
    actor: SYSTEM_ACTOR,
    site: await getSiteRef(run.payload.siteId, run.deps.db),
  });
  const { snapshot } = context;
  let failed: ImportError[] = [];
  for (let round = 0; round < PRUNE_ROUNDS; round += 1) {
    failed = [];
    let deleted = 0;
    for (let after: string | null = null; ;) {
      const rows = await transferImportRepository.listLiveEntryIds(
        run.payload.siteId,
        [...models],
        after,
        500,
      );
      if (rows.length === 0) {
        break;
      }
      for (const row of rows.filter((candidate) => !keep.has(candidate.id))) {
        const model = snapshot.byId.get(row.model_id);
        try {
          await deleteEntry(context, model?.definition.apiKey ?? '', row.id);
          deleted += 1;
        } catch (error) {
          if (!(error instanceof AppError)) {
            throw error;
          }
          failed.push({ id: row.id, code: error.code, message: error.message });
        }
      }
      after = rows.at(-1)?.id ?? null;
    }
    run.progress.counts.pruned += deleted;
    if (failed.length === 0 || deleted === 0) {
      break;
    }
  }
  failed.forEach((error) => recordError(run, error));
};

const runPhase = async (run: Run, phase: ImportPhase) => {
  switch (phase) {
    case 'waiting':
      return waitForSchema(run);
    case 'users':
      return importUsers(run);
    case 'media':
      return importMedia(run);
    case 'entries':
      return importEntryRows(run, await loadSiteSnapshot(run));
    case 'content':
      return importContent(run, await loadSiteSnapshot(run));
    case 'prune':
      return run.payload.prune ? prune(run, await loadSnapshot(run.deps.db)) : undefined;
    case 'cleanup':
      return removeStoredBundle(run.deps.storage, run.payload.bundle).catch((error: unknown) =>
        run.job.log.warn(
          { err: describeError(error), key: run.payload.bundle.key },
          'could not remove an imported bundle',
        ),
      );
  }
};

export const runImportJob = async (deps: TransferJobDependencies, job: JobContext) => {
  const payload = readPayload(job.payload);
  const run: Run = {
    deps,
    job,
    payload,
    progress: isProgress(job.checkpoint) ? job.checkpoint : initialProgress(),
  };
  for (const phase of PHASES.slice(PHASES.indexOf(run.progress.phase))) {
    run.progress.phase = phase;
    await runPhase(run, phase);
    const next = PHASES[PHASES.indexOf(phase) + 1];
    if (next) {
      run.progress.phase = next;
      run.progress.line = 0;
      await save(run);
    }
  }
  job.log.info(
    { importId: payload.importId, counts: run.progress.counts, errors: run.progress.errorCount },
    'import finished',
  );
  return { importId: payload.importId, ...run.progress, phase: 'done' };
};

export const createTransferJobHandlers = (deps: TransferJobDependencies): [string, JobHandler][] => [
  [TRANSFER_IMPORT_JOB, (job) => runImportJob(deps, job)],
];
