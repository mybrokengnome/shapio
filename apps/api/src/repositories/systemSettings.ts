import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export const findValue = async (key: string, trx: Executor = db): Promise<string | undefined> =>
  (await trx.selectFrom('system_settings').select('value').where('key', '=', key).executeTakeFirst())?.value;

/** Inserts the setting unless it exists; returns true when this call created it. */
export const insertIfAbsent = async (key: string, value: string, trx: Executor = db): Promise<boolean> => {
  const inserted = await trx
    .insertInto('system_settings')
    .values({ key, value })
    .onConflict((oc) => oc.column('key').doNothing())
    .returning('key')
    .executeTakeFirst();
  return inserted !== undefined;
};
