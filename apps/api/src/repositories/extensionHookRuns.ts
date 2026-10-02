import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Claims a post-commit hook run. Returns false when it already ran (or another transaction holding the same
 * claim commits first: the insert waits for it). Call it inside the transaction that does the hook's work.
 */
export const claim = async (
  run: { eventId: string; hook: string; jobId: string | null },
  trx: Executor = db,
): Promise<boolean> => {
  const inserted = await trx
    .insertInto('extension_hook_runs')
    .values({ event_id: run.eventId, hook: run.hook, job_id: run.jobId })
    .onConflict((oc) => oc.columns(['event_id', 'hook']).doNothing())
    .returning('event_id')
    .executeTakeFirst();
  return inserted !== undefined;
};
