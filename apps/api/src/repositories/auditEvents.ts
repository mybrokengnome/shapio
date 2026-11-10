import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { AuditEvents, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AuditEventRow = Selectable<AuditEvents>;
export type NewAuditEvent = Insertable<AuditEvents>;

export const insert = (event: NewAuditEvent, trx: Executor = db) =>
  trx.insertInto('audit_events').values(event).returning(['id', 'occurred_at']).executeTakeFirstOrThrow();

/** Successful events of the given actions, oldest first, with their target and metadata. */
export const findSuccessfulByActions = (actions: readonly string[], executor: Executor = db) =>
  executor
    .selectFrom('audit_events')
    .select(['action', 'target_id', 'metadata', 'occurred_at'])
    .where('action', 'in', actions)
    .where('outcome', '=', 'success')
    .orderBy('seq')
    .execute();
