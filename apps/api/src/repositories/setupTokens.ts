import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export const supersedeUnused = (now: Date, trx: Executor = db) =>
  trx
    .updateTable('setup_tokens')
    .set({ superseded_at: now, updated_at: now })
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .execute();

export const insert = (tokenHash: string, trx: Executor = db) =>
  trx.insertInto('setup_tokens').values({ token_hash: tokenHash }).returning('id').executeTakeFirstOrThrow();

/** Marks the live token with this hash used; returns whether one was (a token works once). */
export const consume = async (tokenHash: string, now: Date, trx: Executor = db): Promise<boolean> => {
  const result = await trx
    .updateTable('setup_tokens')
    .set({ used_at: now, updated_at: now })
    .where('token_hash', '=', tokenHash)
    .where('used_at', 'is', null)
    .where('superseded_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
};
