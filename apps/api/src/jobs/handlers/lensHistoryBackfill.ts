import type { Database } from '../../db/index.js';
import * as jobsRepository from '../../repositories/jobs.js';
import * as jobsAdminRepository from '../../repositories/jobsAdmin.js';
import {
  backfillActivationHistory,
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
} from '../../schema/lens/history.js';
import { clearLensCaches } from '../../schema/lens/views.js';
import type { JobHandler } from '../types.js';

export { LENS_HISTORY_BACKFILL_JOB };

/**
 * What a failed run says, in the job's error (Develop › Live › Failed jobs shows it): until the rebuild
 * succeeds, reads naming a version from before 0.9.0 answer `SCHEMA_VERSION_UNAVAILABLE`.
 */
export const LENS_HISTORY_FAILED_NOTICE =
  'Older schema versions from before 0.9.0 are unavailable: the history rebuild failed';

/** A dead rebuild is queued again at most this often (the daily retention job looks). */
export const LENS_HISTORY_REQUEUE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * `schema.lensHistoryBackfill` (plan schema-lenses §1): rebuilds the activation history from before 0.9.0
 * out of the audit log. Enqueued once by the migration that added `schema_activations`, and only when it
 * wrote a baseline. Idempotent: a retried or repeated run inserts only the rows still missing.
 */
export const createLensHistoryBackfillHandler =
  (db: Database): JobHandler =>
  async (context) => {
    let inserted: number;
    try {
      ({ inserted } = await backfillActivationHistory(db));
    } catch (error) {
      throw new Error(
        `${LENS_HISTORY_FAILED_NOTICE}: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
    // Views built while history was incomplete are not cached; this drops anything else built meanwhile.
    clearLensCaches();
    context.log.info({ inserted }, 'schema activation history rebuilt from the audit log');
    return { inserted };
  };

/**
 * Queues a dead rebuild again, as a new round of attempts, once it has been dead for
 * `LENS_HISTORY_REQUEUE_AFTER_MS` (so a rebuild that keeps failing runs a round a day, never in a loop).
 * Returns whether it did.
 */
export const requeueDeadLensHistoryBackfill = async (
  db: Database,
  now: Date = new Date(),
): Promise<boolean> => {
  const job = await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, db);
  const deadSince = job?.finished_at ?? job?.updated_at;
  if (
    !job ||
    job.status !== 'dead' ||
    !deadSince ||
    now.getTime() - deadSince.getTime() < LENS_HISTORY_REQUEUE_AFTER_MS
  ) {
    return false;
  }
  return (await jobsAdminRepository.requeueDead(job.id, now, db, 'Queued again a day after: ')) !== undefined;
};
