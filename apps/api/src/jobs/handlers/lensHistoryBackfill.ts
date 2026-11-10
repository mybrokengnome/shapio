import type { Database } from '../../db/index.js';
import { backfillActivationHistory, LENS_HISTORY_BACKFILL_JOB } from '../../schema/lens/history.js';
import { clearLensCaches } from '../../schema/lens/views.js';
import type { JobHandler } from '../types.js';

export { LENS_HISTORY_BACKFILL_JOB };

/**
 * `schema.lensHistoryBackfill` (plan schema-lenses §1): rebuilds the activation history from before 0.9.0
 * out of the audit log. Enqueued once by the migration that added `schema_activations`, and only when it
 * wrote a baseline. Idempotent: a retried or repeated run inserts only the rows still missing.
 */
export const createLensHistoryBackfillHandler =
  (db: Database): JobHandler =>
  async (context) => {
    const { inserted } = await backfillActivationHistory(db);
    // Views built while history was incomplete are not cached; this drops anything else built meanwhile.
    clearLensCaches();
    context.log.info({ inserted }, 'schema activation history rebuilt from the audit log');
    return { inserted };
  };
