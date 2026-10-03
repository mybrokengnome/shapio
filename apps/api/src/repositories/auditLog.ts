import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import { startsWith } from '../db/sql/text.js';
import { timestampCursorText, timestampParam } from '../db/sql/time.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AuditLogFilter = {
  actorType?: string;
  actorId?: string;
  action?: string;
  /** Matches `action` values starting with this prefix plus a dot, e.g. `role` → `role.*`. */
  actionPrefix?: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
  from?: Date;
  to?: Date;
};

/**
 * Keyset cursor: the (occurred_at, seq) of the last row of the previous page. `occurredAt` is ISO-8601 with
 * microseconds, because a JavaScript Date (milliseconds) would skip or repeat rows within one millisecond.
 * `seq` (decimal text) orders events written in the same instant the way they were written.
 */
export type AuditLogCursor = { occurredAt: string; seq: string };

/**
 * Newest first, keyset-paginated so deep pages stay as fast as the first. Admin, token and app-user actors are
 * resolved to a display name (and an admin's email) with left joins; the stored rows keep only IDs, and a
 * deleted actor simply has no name.
 */
export const listEvents = (
  filter: AuditLogFilter,
  cursor: AuditLogCursor | undefined,
  limit: number,
  trx: Executor = db,
) =>
  trx
    .selectFrom('audit_events as e')
    .leftJoin('admin_users as u', (join) =>
      join
        .on('e.actor_type', '=', 'admin')
        .on((eb) => eb(eb.cast('u.id', 'text'), '=', eb.ref('e.actor_id'))),
    )
    .leftJoin('api_tokens as t', (join) =>
      join
        .on('e.actor_type', '=', 'token')
        .on((eb) => eb(eb.cast('t.id', 'text'), '=', eb.ref('e.actor_id'))),
    )
    .leftJoin('app_users as au', (join) =>
      join
        .on('e.actor_type', '=', 'app_user')
        .on((eb) => eb(eb.cast('au.id', 'text'), '=', eb.ref('e.actor_id'))),
    )
    .select((eb) => [
      'e.id',
      'e.seq',
      'e.occurred_at',
      'e.actor_type',
      'e.actor_id',
      'e.action',
      'e.target_type',
      'e.target_id',
      'e.outcome',
      'e.request_id',
      'e.ip',
      'e.metadata',
      eb.fn
        .coalesce(
          eb.fn<string | null>('nullif', ['u.name', eb.val('')]),
          't.name',
          eb.fn<string | null>('nullif', ['au.name', eb.val('')]),
        )
        .as('actor_name'),
      eb.fn.coalesce('u.email', 'au.email').as('actor_email'),
      timestampCursorText('e.occurred_at').as('cursor_at'),
    ])
    .$if(filter.actorType !== undefined, (qb) => qb.where('e.actor_type', '=', filter.actorType ?? ''))
    .$if(filter.actorId !== undefined, (qb) => qb.where('e.actor_id', '=', filter.actorId ?? ''))
    .$if(filter.action !== undefined, (qb) => qb.where('e.action', '=', filter.action ?? ''))
    .$if(filter.actionPrefix !== undefined, (qb) =>
      qb.where((eb) => startsWith(eb.ref('e.action'), `${filter.actionPrefix ?? ''}.`)),
    )
    .$if(filter.targetType !== undefined, (qb) => qb.where('e.target_type', '=', filter.targetType ?? ''))
    .$if(filter.targetId !== undefined, (qb) => qb.where('e.target_id', '=', filter.targetId ?? ''))
    .$if(filter.outcome !== undefined, (qb) => qb.where('e.outcome', '=', filter.outcome ?? ''))
    .$if(filter.from !== undefined, (qb) => qb.where('e.occurred_at', '>=', filter.from ?? new Date(0)))
    .$if(filter.to !== undefined, (qb) => qb.where('e.occurred_at', '<', filter.to ?? new Date(0)))
    .$if(cursor !== undefined, (qb) => {
      const at = timestampParam(cursor?.occurredAt ?? null);
      return qb.where((eb) =>
        eb.or([
          eb('e.occurred_at', '<', at),
          eb.and([eb('e.occurred_at', '=', at), eb('e.seq', '<', cursor?.seq ?? '0')]),
        ]),
      );
    })
    .orderBy('e.occurred_at', 'desc')
    .orderBy('e.seq', 'desc')
    .limit(limit)
    .execute();
