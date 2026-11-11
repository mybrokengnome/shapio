import { randomBytes } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
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
    .set((eb) => ({ schema_version: eb('schema_version', '+', eb.lit(1)), updated_at: now }))
    .returning('schema_version')
    .executeTakeFirstOrThrow();
  return row.schema_version;
};

/** Records the Shapio release this database is served by (in-process readers compare their own with it). */
export const setRelease = async (release: string, executor: Executor = db): Promise<void> => {
  await executor.updateTable('system_versions').set({ release }).execute();
};

/** The instance's schema ID, written once by the migration: what a client's `<schemaId>:<version>` names. */
export const getSchemaId = async (executor: Executor = db): Promise<string> => {
  const row = await executor.selectFrom('system_versions').select('schema_id').executeTakeFirstOrThrow();
  return row.schema_id;
};

/**
 * The instance's item ID key (plan item-ids), written by the migration. A database left without one (a
 * migration stopped between its two statements) gets one here, once: never a key that changes between reads.
 */
export const getItemIdKey = async (executor: Executor = db): Promise<string> => {
  const row = await executor.selectFrom('system_versions').select('item_id_key').executeTakeFirstOrThrow();
  if (row.item_id_key) {
    return row.item_id_key;
  }
  await executor
    .updateTable('system_versions')
    .set({ item_id_key: randomBytes(32).toString('hex') })
    .where('item_id_key', 'is', null)
    .execute();
  const filled = await executor.selectFrom('system_versions').select('item_id_key').executeTakeFirstOrThrow();
  if (!filled.item_id_key) {
    throw new Error('system_versions.item_id_key could not be set; run the database migrations');
  }
  return filled.item_id_key;
};
