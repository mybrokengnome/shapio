import type { FastifyBaseLogger } from 'fastify';
import { JOB_PRIORITY } from '../../constants/jobPriorities.js';
import { analyzeHeadsStatement, CONTENT_HEADS_TABLE } from '../../content/compiler/expressions.js';
import {
  addFilterCheckNotValid,
  CONTENT_INDEX_RECHECK_MS,
  createFilterIndexConcurrently,
  DOCUMENT_INDEX,
  DRAFT_SCALARS_INDEX,
  dropIndexConcurrently,
  fillFilterDataBatch,
  FILTER_INDEX,
  filterCheckState,
  hasMissingFilterData,
  readContentIndexForm,
  validateFilterCheck,
  type HeadKey,
} from '../../db/contentFilterIndex.js';
import { currentDialect } from '../../db/dialect.js';
import type { Database } from '../../db/index.js';
import { getIndexState, tableExists } from '../../db/indexCatalog.js';
import { enqueueJob } from '../../jobs/queue.js';
import type { JobHandler } from '../../jobs/types.js';
import * as jobsRepository from '../../repositories/jobs.js';
import * as jobsAdminRepository from '../../repositories/jobsAdmin.js';
import { withIndexBuildLock, type IndexBuildOutcome } from './indexes.js';

/**
 * `entry_heads.filter_data` on an instance upgraded with heads present (ADR 0001, "Filter data"; PostgreSQL
 * only). `schema.contentFilterIndex`, enqueued by the migration `20261112120000_entry_heads_scalars_gin`:
 * 1. fills the column on rows written before the trigger, in short batches that skip locked rows;
 * 2. adds the check `entry_heads_filter_data_present` `NOT VALID` and validates it: from then on no row can
 *    lack the column, which is what lets a process use it (`readContentIndexForm`);
 * 3. builds `entry_heads_filter_data_gin` `CONCURRENTLY`;
 * 4. enqueues `schema.contentDocumentIndexDrop`, `DOCUMENT_INDEX_DROP_DELAY_MS` later, when every process has
 *    seen the new index (each looks every `CONTENT_INDEX_RECHECK_MS`), so no process is left without an index.
 * Every step is idempotent and resumes where an earlier attempt stopped; dead jobs are queued again by retention.
 */
export const CONTENT_FILTER_INDEX_JOB = 'schema.contentFilterIndex';
/** The key the migration enqueues the build under. */
export const CONTENT_FILTER_INDEX_KEY = 'schema.contentFilterIndex:v1';
export const CONTENT_DOCUMENT_INDEX_DROP_JOB = 'schema.contentDocumentIndexDrop';
export const CONTENT_DOCUMENT_INDEX_DROP_KEY = 'schema.contentDocumentIndexDrop:v1';
export const DOCUMENT_INDEX_DROP_DELAY_MS = 5 * CONTENT_INDEX_RECHECK_MS;
/** A dead job is queued again at most this often (the daily retention job looks). */
export const CONTENT_INDEX_REQUEUE_AFTER_MS = 24 * 60 * 60 * 1000;

const FILL_BATCH = 500;
/** Passes over the table before giving up on rows that stay locked (the job retries later). */
const MAX_FILL_PASSES = 20;

const isPostgresWithHeads = async (db: Database) =>
  currentDialect() === 'postgres' && (await tableExists(db, CONTENT_HEADS_TABLE));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type FillHooks = {
  /** Called after each batch (tests write rows between batches). */
  afterBatch?: (filled: number) => Promise<void>;
  signal?: AbortSignal;
};

/**
 * Fills `filter_data` everywhere it is missing: passes in key order until none is left. A pass can miss rows
 * another transaction held; the next pass, after a short pause, picks them up.
 */
export const fillFilterData = async (
  db: Database,
  log: FastifyBaseLogger,
  hooks: FillHooks = {},
): Promise<number> => {
  let total = 0;
  for (let pass = 0; pass < MAX_FILL_PASSES; pass += 1) {
    let after: HeadKey | null = null;
    for (;;) {
      hooks.signal?.throwIfAborted();
      const batch = await fillFilterDataBatch(db, after, FILL_BATCH);
      total += batch.filled;
      await hooks.afterBatch?.(batch.filled);
      if (!batch.last) {
        break;
      }
      after = batch.last;
    }
    if (!(await hasMissingFilterData(db))) {
      log.info({ filled: total, passes: pass + 1 }, 'content filter data filled');
      return total;
    }
    await pause(100 * (pass + 1));
  }
  throw new Error('Some content heads stayed locked while filling their filter data; trying again later');
};

/** Steps 2 and 3, under the index build lock (the check's validation and the build both scan the table). */
const proveAndIndexNow = async (db: Database, log: FastifyBaseLogger): Promise<void> => {
  const check = await filterCheckState(db);
  if (check === 'missing') {
    await addFilterCheckNotValid(db);
  }
  if (check !== 'valid') {
    // Fails, and the job retries (filling again first), if a row still lacks filter data.
    await validateFilterCheck(db);
  }
  const state = await getIndexState(db, FILTER_INDEX);
  if (state === 'valid') {
    return;
  }
  if (state === 'invalid') {
    log.warn({ indexName: FILTER_INDEX }, 'dropping invalid index left by an earlier build');
    await dropIndexConcurrently(db, FILTER_INDEX);
  }
  const startedAt = performance.now();
  await createFilterIndexConcurrently(db);
  if ((await getIndexState(db, FILTER_INDEX)) !== 'valid') {
    throw new Error(`Index ${FILTER_INDEX} is not valid after building`);
  }
  await analyzeHeadsStatement().execute(db);
  log.info(
    { indexName: FILTER_INDEX, durationMs: Math.round(performance.now() - startedAt) },
    'content filter index built',
  );
};

/** Steps 1 to 3. `exists` when the filter form is already live. */
export const buildContentFilterIndex = async (
  db: Database,
  log: FastifyBaseLogger,
  hooks: FillHooks = {},
): Promise<IndexBuildOutcome> => {
  if (!(await isPostgresWithHeads(db))) {
    return 'skipped';
  }
  if ((await readContentIndexForm(db)) === 'filter') {
    return 'exists';
  }
  await fillFilterData(db, log, hooks);
  await withIndexBuildLock(db, () => proveAndIndexNow(db, log));
  return 'built';
};

/**
 * Drops the whole-document index (and a draft's scalar index), never before the filter form is live (it
 * finishes the build first if need be). Returns whether there was anything to drop.
 */
export const dropContentDocumentIndex = async (db: Database, log: FastifyBaseLogger): Promise<boolean> => {
  if (!(await isPostgresWithHeads(db))) {
    return false;
  }
  await buildContentFilterIndex(db, log);
  return withIndexBuildLock(db, async () => {
    let dropped = false;
    for (const name of [DOCUMENT_INDEX, DRAFT_SCALARS_INDEX]) {
      if ((await getIndexState(db, name)) !== 'missing') {
        await dropIndexConcurrently(db, name);
        log.info({ indexName: name }, 'old content containment index dropped');
        dropped = true;
      }
    }
    return dropped;
  });
};

const createBuildHandler =
  (db: Database): JobHandler =>
  async (context) => {
    const outcome = await buildContentFilterIndex(db, context.log, { signal: context.signal });
    if (outcome !== 'skipped') {
      await enqueueJob(
        {
          type: CONTENT_DOCUMENT_INDEX_DROP_JOB,
          runAt: new Date(Date.now() + DOCUMENT_INDEX_DROP_DELAY_MS),
          priority: JOB_PRIORITY.background,
          maxAttempts: 5,
          idempotencyKey: CONTENT_DOCUMENT_INDEX_DROP_KEY,
        },
        db,
      );
    }
    return { outcome };
  };

const createDropHandler =
  (db: Database): JobHandler =>
  async (context) => ({ dropped: await dropContentDocumentIndex(db, context.log) });

export const createContentFilterIndexHandlers = (db: Database): Array<[string, JobHandler]> => [
  [CONTENT_FILTER_INDEX_JOB, createBuildHandler(db)],
  [CONTENT_DOCUMENT_INDEX_DROP_JOB, createDropHandler(db)],
];

/**
 * Queues a dead build or drop again, as a new round of attempts, once it has been dead for
 * `CONTENT_INDEX_REQUEUE_AFTER_MS` (a job that keeps failing runs a round a day, never in a loop). Until the
 * build succeeds queries keep the whole-document index: correct, only larger. Returns how many it queued.
 */
export const requeueDeadContentFilterIndexJobs = async (
  db: Database,
  now: Date,
  log: FastifyBaseLogger,
): Promise<number> => {
  let requeued = 0;
  for (const key of [CONTENT_FILTER_INDEX_KEY, CONTENT_DOCUMENT_INDEX_DROP_KEY]) {
    const job = await jobsRepository.findByIdempotencyKey(key, db);
    const deadSince = job?.finished_at ?? job?.updated_at;
    if (
      job?.status === 'dead' &&
      deadSince &&
      now.getTime() - deadSince.getTime() >= CONTENT_INDEX_REQUEUE_AFTER_MS &&
      (await jobsAdminRepository.requeueDead(job.id, now, db, 'Queued again a day after: '))
    ) {
      requeued += 1;
    }
  }
  if (requeued > 0) {
    log.info({ requeued }, 'content index jobs queued again');
  }
  return requeued;
};
