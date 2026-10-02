import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Emailed single-use app-user tokens: email confirmations and password resets share one shape (the token
 * hash is written by the email job, so the plain token never sits in the jobs table).
 */
export type AppUserTokenTable = 'email_confirmations' | 'app_password_resets';

export const insert = (
  table: AppUserTokenTable,
  row: { appUserId: string; email: string; expiresAt: Date },
  trx: Executor = db,
) =>
  trx
    .insertInto(table)
    .values({ app_user_id: row.appUserId, email: row.email, expires_at: row.expiresAt })
    .returning('id')
    .executeTakeFirstOrThrow();

export const findById = (table: AppUserTokenTable, id: string, trx: Executor = db) =>
  trx.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst();

/** Locks the row for this token hash so it can be used at most once. */
export const lockByTokenHash = (table: AppUserTokenTable, tokenHash: string, trx: Transaction<DB>) =>
  trx.selectFrom(table).selectAll().where('token_hash', '=', tokenHash).forUpdate().executeTakeFirst();

export const setTokenHash = (
  table: AppUserTokenTable,
  id: string,
  tokenHash: string,
  now: Date,
  trx: Executor = db,
) => trx.updateTable(table).set({ token_hash: tokenHash, updated_at: now }).where('id', '=', id).execute();

/** Marks every unused token of the account used: completing one kills the others. */
export const consumeAllForUser = (
  table: AppUserTokenTable,
  appUserId: string,
  now: Date,
  trx: Executor = db,
) =>
  trx
    .updateTable(table)
    .set({ used_at: now, updated_at: now })
    .where('app_user_id', '=', appUserId)
    .where('used_at', 'is', null)
    .execute();
