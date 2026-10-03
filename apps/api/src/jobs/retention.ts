import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import * as assistRunsRepository from '../repositories/assistRuns.js';
import * as retentionRepository from '../repositories/retention.js';
import * as usageRepository from '../repositories/usage.js';
import { usageDayOf } from '../usage/keys.js';
import { enqueueJob } from './queue.js';
import type { JobHandler } from './types.js';

/**
 * `system.retention`: once a day, delete finished bookkeeping older than RETENTION_DAYS (succeeded jobs,
 * dispatched outbox events, after-hook run records, resolved health findings) and stale presence rows; usage
 * counters and assist runs older than USAGE_RETENTION_DAYS. Dead jobs and undispatched events stay for an operator.
 * One job per UTC day (idempotency key `system.retention:<date>`); each run schedules the next day's, and
 * every worker start makes sure today's exists, so instances starting together still create one.
 */
export const RETENTION_JOB = 'system.retention';
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 5000;
const PRESENCE_RETENTION_MS = 60 * 60 * 1000;

const dayKey = (at: Date) => `${RETENTION_JOB}:${at.toISOString().slice(0, 10)}`;

/** Ensures the retention job for the day of `now` exists (no-op if it was already created or ran). */
export const ensureRetentionScheduled = (db: Kysely<DB>, now = new Date()) =>
  enqueueJob({ type: RETENTION_JOB, runAt: now, idempotencyKey: dayKey(now) }, db);

/** Deletes in batches until a batch comes back short, stopping early on shutdown. */
const pruneAll = async <T>(
  prune: (before: T, limit: number, executor: Kysely<DB>) => Promise<number>,
  db: Kysely<DB>,
  before: T,
  signal: AbortSignal,
) => {
  let total = 0;
  for (;;) {
    const removed = await prune(before, BATCH_SIZE, db);
    total += removed;
    if (removed < BATCH_SIZE || signal.aborted) {
      return total;
    }
  }
};

export const createRetentionJobHandlers = (
  db: Kysely<DB>,
  {
    days,
    usageDays = days,
    now = () => new Date(),
  }: { days: number; /** USAGE_RETENTION_DAYS (defaults to `days`). */ usageDays?: number; now?: () => Date },
): Array<[string, JobHandler]> => [
  [
    RETENTION_JOB,
    async (job) => {
      const at = now();
      const before = new Date(at.getTime() - days * DAY_MS);
      // Daily usage buckets: keep the last `usageDays` days, today included.
      const usageBefore = usageDayOf(new Date(at.getTime() - (usageDays - 1) * DAY_MS));
      const removed = {
        jobs: await pruneAll(retentionRepository.pruneSucceededJobs, db, before, job.signal),
        outboxEvents: await pruneAll(retentionRepository.pruneDispatchedOutboxEvents, db, before, job.signal),
        extensionHookRuns: await pruneAll(retentionRepository.pruneExtensionHookRuns, db, before, job.signal),
        fieldReads: await pruneAll(usageRepository.pruneFieldReads, db, usageBefore, job.signal),
        tokenReads: await pruneAll(usageRepository.pruneTokenReads, db, usageBefore, job.signal),
        // Assist runs (who used which model, token counts) are usage records: same retention.
        assistRuns: await pruneAll(
          assistRunsRepository.pruneRuns,
          db,
          new Date(at.getTime() - usageDays * DAY_MS),
          job.signal,
        ),
        healthFindings: await pruneAll(
          retentionRepository.pruneResolvedHealthFindings,
          db,
          before,
          job.signal,
        ),
        // Presence lives seconds, not days: anything not seen for an hour is gone.
        editorPresence: await pruneAll(
          retentionRepository.pruneStalePresence,
          db,
          new Date(at.getTime() - PRESENCE_RETENTION_MS),
          job.signal,
        ),
      };
      const next = new Date(at.getTime() + DAY_MS);
      await enqueueJob({ type: RETENTION_JOB, runAt: next, idempotencyKey: dayKey(next) }, db);
      job.log.info({ before, removed }, 'retention pruned finished bookkeeping');
      return { before: before.toISOString(), removed };
    },
  ],
];
