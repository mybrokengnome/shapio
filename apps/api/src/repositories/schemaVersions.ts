import { sql, type Kysely, type Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** The global schema version: the durable value every instance compares its cached snapshot against. */
export const getSchemaVersion = async (executor: Executor = db): Promise<number> => {
  const row = await executor.selectFrom('system_versions').select('schema_version').executeTakeFirstOrThrow();
  return row.schema_version;
};

/** Increments the global schema version in the caller's transaction and returns the new value. */
export const bumpSchemaVersion = async (trx: Executor, now: Date): Promise<number> => {
  const row = await trx
    .updateTable('system_versions')
    .set({ schema_version: sql<number>`schema_version + 1`, updated_at: now })
    .returning('schema_version')
    .executeTakeFirstOrThrow();
  return row.schema_version;
};
