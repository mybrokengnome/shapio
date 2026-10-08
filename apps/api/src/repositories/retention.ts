import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Deletes of finished bookkeeping older than a cutoff, in bounded batches so a large backlog never holds
 * long locks. Each returns the number of rows removed by that batch. Only finished rows are eligible: dead
 * and pending jobs, and undispatched outbox events, are never touched.
 */
const deleted = (result: { numDeletedRows: bigint }) => Number(result.numDeletedRows);

export const pruneSucceededJobs = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('jobs')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('jobs')
          .select('id')
          .where('status', '=', 'succeeded')
          .where('finished_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

export const pruneDispatchedOutboxEvents = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('outbox_events')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('outbox_events')
          .select('id')
          .where('dispatched_at', 'is not', null)
          .where('dispatched_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

export const pruneExtensionHookRuns = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('extension_hook_runs')
      .where((eb) =>
        eb(
          eb.refTuple('event_id', 'hook'),
          'in',
          eb
            .selectFrom('extension_hook_runs')
            .select(['event_id', 'hook'])
            .where('completed_at', '<', before)
            .limit(limit)
            .$asTuple('event_id', 'hook'),
        ),
      )
      .executeTakeFirstOrThrow(),
  );

/** Health findings resolved before the cutoff (open findings are never pruned). */
export const pruneResolvedHealthFindings = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('content_health_findings')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('content_health_findings')
          .select('id')
          .where('resolved_at', 'is not', null)
          .where('resolved_at', '<', before)
          .limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/** Presence rows of tabs that stopped sending heartbeats (reads ignore them already; this frees space). */
export const pruneStalePresence = async (before: Date, limit: number, trx: Executor = db) =>
  deleted(
    await trx
      .deleteFrom('editor_presence')
      .where('last_seen_at', '<', before)
      .where('entry_id', 'in', (eb) =>
        eb.selectFrom('editor_presence').select('entry_id').where('last_seen_at', '<', before).limit(limit),
      )
      .executeTakeFirstOrThrow(),
  );

/**
 * Dead jobs of one type that finished before a cutoff, with their payload, in id order after `afterId`
 * (keyset paging). Read only: dead jobs stay for an operator.
 */
export const listDeadJobs = (
  type: string,
  before: Date,
  afterId: string | null,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('jobs')
    .select(['id', 'payload'])
    .where('type', '=', type)
    .where('status', '=', 'dead')
    .where('finished_at', '<', before)
    .$if(afterId !== null, (qb) => qb.where('id', '>', afterId as string))
    .orderBy('id')
    .limit(limit)
    .execute();
