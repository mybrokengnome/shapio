import { sql, type Insertable, type Kysely, type Selectable, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, OutboxEvents } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type OutboxEventRow = Selectable<OutboxEvents>;
export type NewOutboxEvent = Insertable<OutboxEvents>;

export const insert = (event: NewOutboxEvent, trx: Executor = db) =>
  trx.insertInto('outbox_events').values(event).returning(['id', 'event_id']).executeTakeFirstOrThrow();

export const findByEventId = (eventId: string, trx: Executor = db) =>
  trx.selectFrom('outbox_events').selectAll().where('event_id', '=', eventId).executeTakeFirst();

/**
 * Locks the oldest undispatched event that is still eligible for dispatch, skipping IDs already tried this pass. Concurrent relays skip locked
 * rows, so each event is handed to one relay at a time.
 */
export const lockNextUndispatched = (
  maxAttempts: number,
  excludeIds: readonly string[],
  trx: Executor = db,
) =>
  trx
    .selectFrom('outbox_events')
    .selectAll()
    .where('dispatched_at', 'is', null)
    .where('dispatch_attempts', '<', maxAttempts)
    .$if(excludeIds.length > 0, (qb) => qb.where('id', 'not in', excludeIds))
    .orderBy('id', 'asc')
    .limit(1)
    .forUpdate()
    .skipLocked()
    .executeTakeFirst();

export const markDispatched = (id: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('outbox_events')
    .set({
      dispatched_at: now,
      dispatch_attempts: sql<number>`dispatch_attempts + 1`,
      last_dispatch_error: null,
    })
    .where('id', '=', id)
    .execute();

export const recordDispatchFailure = (id: string, error: string, trx: Executor = db) =>
  trx
    .updateTable('outbox_events')
    .set({ dispatch_attempts: sql<number>`dispatch_attempts + 1`, last_dispatch_error: error })
    .where('id', '=', id)
    .execute();
