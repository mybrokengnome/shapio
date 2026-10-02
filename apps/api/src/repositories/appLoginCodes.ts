import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

type NewLoginCode = { appUserId: string; codeHash: string; codeChallenge: string; expiresAt: Date };

export const insert = (row: NewLoginCode, trx: Executor = db) =>
  trx
    .insertInto('app_login_codes')
    .values({
      app_user_id: row.appUserId,
      code_hash: row.codeHash,
      code_challenge: row.codeChallenge,
      expires_at: row.expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

/** Locks the code so it is exchanged at most once. */
export const lockByCodeHash = (codeHash: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('app_login_codes')
    .selectAll()
    .where('code_hash', '=', codeHash)
    .forUpdate()
    .executeTakeFirst();

export const markUsed = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('app_login_codes').set({ used_at: now }).where('id', '=', id).execute();
