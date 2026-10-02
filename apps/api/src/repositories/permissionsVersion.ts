import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** The durable permissions version; caches compare against it (build plan §3.4). */
export const getPermissionsVersion = async (trx: Executor = db): Promise<number> => {
  const row = await trx.selectFrom('system_versions').select('permissions_version').executeTakeFirstOrThrow();
  return row.permissions_version;
};

/** Call in the same transaction as every permission change, so caches reload exactly when it commits. */
export const bumpPermissionsVersion = (trx: Executor = db) =>
  trx
    .updateTable('system_versions')
    .set({ permissions_version: sql<number>`permissions_version + 1`, updated_at: sql`now()` })
    .execute();
