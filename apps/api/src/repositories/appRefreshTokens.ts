import type { Insertable, Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { AppRefreshTokens, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type NewAppRefreshToken = Insertable<AppRefreshTokens>;

export const insert = (token: NewAppRefreshToken, trx: Executor = db) =>
  trx.insertInto('app_refresh_tokens').values(token).returning(['id', 'family_id']).executeTakeFirstOrThrow();

/** Locks the token row for this hash, so concurrent refreshes with one token rotate it at most once. */
export const lockByTokenHash = (tokenHash: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('app_refresh_tokens')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .forUpdate()
    .executeTakeFirst();

export const findByTokenHash = (tokenHash: string, trx: Executor = db) =>
  trx.selectFrom('app_refresh_tokens').selectAll().where('token_hash', '=', tokenHash).executeTakeFirst();

export const markUsed = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('app_refresh_tokens').set({ used_at: now }).where('id', '=', id).execute();

/** Spends the one retry a rotated token gets within the reuse grace. */
export const markGraceUsed = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('app_refresh_tokens').set({ reuse_grace_used_at: now }).where('id', '=', id).execute();

/** Revokes every live token of one sign-in (logout, reuse detection). Returns how many were revoked. */
export const revokeFamily = async (familyId: string, now: Date, reason: string, trx: Executor = db) =>
  Number(
    (
      await trx
        .updateTable('app_refresh_tokens')
        .set({ revoked_at: now, revoked_reason: reason })
        .where('family_id', '=', familyId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst()
    ).numUpdatedRows,
  );

/** Revokes every live token of the account (password change or reset, block, deletion). */
export const revokeAllForUser = (appUserId: string, now: Date, reason: string, trx: Executor = db) =>
  trx
    .updateTable('app_refresh_tokens')
    .set({ revoked_at: now, revoked_reason: reason })
    .where('app_user_id', '=', appUserId)
    .where('revoked_at', 'is', null)
    .execute();
