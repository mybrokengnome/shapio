import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { AuditEvents, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AuditEventRow = Selectable<AuditEvents>;
export type NewAuditEvent = Insertable<AuditEvents>;

export const insert = (event: NewAuditEvent, trx: Executor = db) =>
  trx.insertInto('audit_events').values(event).returning(['id', 'occurred_at']).executeTakeFirstOrThrow();

/** One page of successful events of the given actions, oldest first after `afterSeq` (keyset on `seq`). */
export const findSuccessfulByActionsPage = (
  actions: readonly string[],
  page: { afterSeq: string | null; limit: number },
  executor: Executor = db,
) =>
  executor
    .selectFrom('audit_events')
    .select(['seq', 'action', 'target_id', 'metadata', 'occurred_at'])
    .where('action', 'in', actions)
    .where('outcome', '=', 'success')
    .$if(page.afterSeq !== null, (qb) => qb.where('seq', '>', page.afterSeq ?? '0'))
    .orderBy('seq')
    .limit(page.limit)
    .execute();
