import type { FastifyBaseLogger } from 'fastify';
import type { RawBuilder } from 'kysely';
import { INDEX_BUILD_LOCK_KEY, LOCK_NAMESPACE } from '../../constants/lockKeys.js';
import {
  analyzeHeadsStatement,
  CONTENT_HEADS_TABLE,
  createFieldIndexColumnStatement,
  createFieldIndexStatement,
  createFieldStatisticsStatement,
  dropFieldIndexColumnStatement,
  dropIndexStatement,
  dropStatisticsStatement,
  fieldIndexName,
  type FieldIndexSpec,
} from '../../content/compiler/expressions.js';
import { withPolledSessionAdvisoryLock } from '../../db/advisoryLocks.js';
import { executeIdempotentDdl } from '../../db/ddl.js';
import type { Database } from '../../db/index.js';
import { getIndexState, tableExists } from '../../db/indexCatalog.js';
import type { IndexStep } from './steps.js';

export type IndexBuildOutcome = 'built' | 'exists' | 'skipped';

/**
 * One field-index build or drop at a time, across every worker and instance. Two `CREATE INDEX
 * CONCURRENTLY` runs on `entry_heads` wait for each other's snapshots and deadlock, which leaves an INVALID
 * index and sends the job into backoff; several models created together would take minutes to index.
 * The lock is a session lock on its own connection, idle outside any transaction, and waiting for it polls
 * rather than blocks, so neither the holder nor the waiters hold up the concurrent build itself.
 */
/** Runs a statement the dialect may not have (extended statistics on SQLite and MySQL). */
const executeIfAny = (db: Database, statement: RawBuilder<unknown> | null): Promise<void> =>
  executeIdempotentDdl(db, statement);

const withIndexBuildLock = <T>(db: Database, fn: () => Promise<T>): Promise<T> =>
  withPolledSessionAdvisoryLock(db, LOCK_NAMESPACE.indexBuilds, INDEX_BUILD_LOCK_KEY, fn);

/**
 * Builds one field's expression index with `CREATE INDEX CONCURRENTLY` (never inside activation, so writes
 * continue). Idempotent and safe to retry: a valid index is kept, an INVALID one left by a failed or
 * interrupted build is dropped and rebuilt. Each index gets an extended-statistics object on the same
 * expression (partial indexes carry no expression statistics), and a fresh build ends with ANALYZE so the
 * planner can use both at once. Without content tables (before package E) there is nothing to index.
 *
 * On SQLite the build is a plain `CREATE INDEX`: it holds the single write lock until it finishes, so writes
 * wait for it (readers do not). That is the documented single-process limitation (ADR 0001, "D2: as
 * built"); builds stay in this prerequisite job, never in activation, and their duration is logged.
 */
export const buildFieldIndex = (
  db: Database,
  step: IndexStep,
  log: FastifyBaseLogger,
): Promise<IndexBuildOutcome> => withIndexBuildLock(db, () => buildFieldIndexNow(db, step, log));

const buildFieldIndexNow = async (
  db: Database,
  step: IndexStep,
  log: FastifyBaseLogger,
): Promise<IndexBuildOutcome> => {
  if (!(await tableExists(db, CONTENT_HEADS_TABLE))) {
    log.info({ indexName: step.indexName }, 'no content table yet; index build skipped');
    return 'skipped';
  }
  const spec: FieldIndexSpec = {
    modelId: step.modelId,
    fieldId: step.fieldId,
    type: step.fieldType,
    ...(step.localized !== undefined ? { localized: step.localized } : {}),
  };
  // The name of the index this build creates (the current layout), not the step's: a step planned before an
  // upgrade that changed the layout carries the old layout's name.
  const indexName = fieldIndexName(spec);
  const state = await getIndexState(db, indexName);
  if (state === 'valid') {
    await executeIfAny(db, createFieldStatisticsStatement(spec));
    return 'exists';
  }
  if (state === 'invalid') {
    log.warn({ indexName }, 'dropping invalid index left by an earlier build');
    await dropIndexNow(db, indexName);
  }
  const startedAt = performance.now();
  // MySQL indexes a virtual column holding the expression, added first (null elsewhere).
  await executeIfAny(db, createFieldIndexColumnStatement(spec));
  await executeIfAny(db, createFieldIndexStatement(spec));
  if ((await getIndexState(db, indexName)) !== 'valid') {
    throw new Error(`Index ${indexName} is not valid after building`);
  }
  await executeIfAny(db, createFieldStatisticsStatement(spec));
  await analyzeHeadsStatement().execute(db);
  const durationMs = Math.round(performance.now() - startedAt);
  log.info({ indexName, fieldId: step.fieldId, durationMs }, 'field index built');
  return 'built';
};

/** The index, then what only exists for it: its statistics (PostgreSQL) or its column (MySQL). */
const dropIndexNow = async (db: Database, indexName: string): Promise<void> => {
  await executeIfAny(db, dropIndexStatement(indexName));
  await executeIfAny(db, dropFieldIndexColumnStatement(indexName));
};

export const dropFieldIndex = (db: Database, indexName: string): Promise<void> =>
  withIndexBuildLock(db, async () => {
    if (await tableExists(db, CONTENT_HEADS_TABLE)) {
      await dropIndexNow(db, indexName);
      await executeIfAny(db, dropStatisticsStatement(indexName));
    }
  });
