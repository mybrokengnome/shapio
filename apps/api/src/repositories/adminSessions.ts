import { sql, type Insertable, type Kysely, type Selectable, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { AdminSessions, DB } from '../db/types.js';
import type { RoleAssignment } from '../permissions/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AdminSessionRow = Selectable<AdminSessions>;
export type NewAdminSession = Insertable<AdminSessions>;

export const insert = (session: NewAdminSession, trx: Executor = db) =>
  trx.insertInto('admin_sessions').values(session).returningAll().executeTakeFirstOrThrow();

/**
 * The live session for a cookie token hash, with its user's status and role IDs, in one query. Expiry is
 * checked by the caller against its clock so the rules live in one place (services/adminSessions.ts).
 */
export const findActiveByTokenHash = (tokenHash: string, trx: Executor = db) =>
  trx
    .selectFrom('admin_sessions')
    .innerJoin('admin_users', 'admin_users.id', 'admin_sessions.admin_user_id')
    .select([
      'admin_sessions.id',
      'admin_sessions.admin_user_id',
      'admin_sessions.csrf_secret',
      'admin_sessions.last_seen_at',
      'admin_sessions.expires_at',
      'admin_sessions.rotation_required',
      'admin_users.status as user_status',
    ])
    // Every role assignment, on any site (site_id null = every site); narrowed per request (sites plan §H).
    .select((eb) =>
      eb.fn
        .coalesce(
          eb
            .selectFrom('admin_user_roles')
            .select(
              sql<RoleAssignment[]>`jsonb_agg(jsonb_build_object('roleId', role_id, 'siteId', site_id)
                order by role_id, site_id nulls first)`.as('assignments'),
            )
            .whereRef('admin_user_roles.admin_user_id', '=', 'admin_sessions.admin_user_id'),
          sql<RoleAssignment[]>`'[]'::jsonb`,
        )
        .as('assignments'),
    )
    .where('admin_sessions.token_hash', '=', tokenHash)
    .where('admin_sessions.revoked_at', 'is', null)
    .executeTakeFirst();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('admin_sessions').selectAll().where('id', '=', id).executeTakeFirst();

export const listActiveForUser = (adminUserId: string, now: Date, trx: Executor = db) =>
  trx
    .selectFrom('admin_sessions')
    .select(['id', 'ip', 'user_agent', 'created_at', 'last_seen_at', 'expires_at'])
    .where('admin_user_id', '=', adminUserId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .orderBy('last_seen_at', 'desc')
    .execute();

/** Writes `last_seen_at` only if it is older than `staleBefore`, so most requests do not write. */
export const touch = (id: string, now: Date, staleBefore: Date, trx: Executor = db) =>
  trx
    .updateTable('admin_sessions')
    .set({ last_seen_at: now })
    .where('id', '=', id)
    .where('last_seen_at', '<', staleBefore)
    .execute();

/** Revokes one session; returns whether a live session was revoked (fenced so rotation races lose cleanly). */
export const revoke = async (id: string, now: Date, trx: Executor = db): Promise<boolean> => {
  const result = await trx
    .updateTable('admin_sessions')
    .set({ revoked_at: now, updated_at: now })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};

export const revokeAllForUser = (
  adminUserId: string,
  now: Date,
  { exceptSessionId }: { exceptSessionId?: string } = {},
  trx: Executor = db,
) =>
  trx
    .updateTable('admin_sessions')
    .set({ revoked_at: now, updated_at: now })
    .where('admin_user_id', '=', adminUserId)
    .where('revoked_at', 'is', null)
    .$if(exceptSessionId !== undefined, (qb) => qb.where('id', '!=', exceptSessionId ?? ''))
    .execute();

/** Marks a user's live sessions for rotation on their next request (privilege change). */
export const requireRotationForUser = (adminUserId: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('admin_sessions')
    .set({ rotation_required: true, updated_at: now })
    .where('admin_user_id', '=', adminUserId)
    .where('revoked_at', 'is', null)
    .execute();

/**
 * Claims the rotation of a session marked for it: clears the flag and shortens its life to `graceUntil`.
 * Returns false if another request already claimed it.
 */
export const claimRotation = async (
  id: string,
  graceUntil: Date,
  now: Date,
  trx: Executor = db,
): Promise<boolean> => {
  const result = await trx
    .updateTable('admin_sessions')
    .set({ rotation_required: false, expires_at: graceUntil, updated_at: now })
    .where('id', '=', id)
    .where('rotation_required', '=', true)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};
