import type { Insertable, Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, PasswordResets } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type NewPasswordReset = Insertable<PasswordResets>;

export const insert = (reset: NewPasswordReset, trx: Executor = db) =>
  trx.insertInto('password_resets').values(reset).returning('id').executeTakeFirstOrThrow();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('password_resets').selectAll().where('id', '=', id).executeTakeFirst();

/** Locks the reset for this token hash so it can be used at most once. */
export const lockByTokenHash = (tokenHash: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('password_resets')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .forUpdate()
    .executeTakeFirst();

export const setTokenHash = (id: string, tokenHash: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('password_resets')
    .set({ token_hash: tokenHash, updated_at: now })
    .where('id', '=', id)
    .execute();

/** Marks every unused reset of the user used: a completed reset (or password change) kills the others. */
export const consumeAllForUser = (adminUserId: string, now: Date, trx: Executor = db) =>
  trx
    .updateTable('password_resets')
    .set({ used_at: now, updated_at: now })
    .where('admin_user_id', '=', adminUserId)
    .where('used_at', 'is', null)
    .execute();
