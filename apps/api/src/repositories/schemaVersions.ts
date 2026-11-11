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
 * Gives the instance its item ID key (plan item-ids) if it has none, in its own statement: the migration writes
 * one, and startup runs this for a database left without (a migration stopped between its two statements). The
 * update is conditional, so processes starting together agree on the first key written.
 */
export const ensureItemIdKey = async (executor: Kysely<DB> = db): Promise<void> => {
  await executor
    .updateTable('system_versions')
    .set({ item_id_key: randomBytes(32).toString('hex') })
    .where('item_id_key', 'is', null)
    .execute();
};

/** 32 bytes as hexadecimal, as the migration and `ensureItemIdKey` write it. */
const ITEM_ID_KEY_PATTERN = /^[0-9a-f]{64}$/i;

/** A stored key of any other shape is refused loudly: it must never become a short or empty HMAC key. */
const checkedItemIdKey = (key: string): string => {
  if (!ITEM_ID_KEY_PATTERN.test(key)) {
    throw new Error(
      'system_versions.item_id_key is not 64 hexadecimal characters; restore it from a backup (every item ID derived from it depends on it)',
    );
  }
  return key;
};

const readItemIdKey = async (executor: Executor) =>
  (await executor.selectFrom('system_versions').select('item_id_key').executeTakeFirstOrThrow()).item_id_key;

/**
 * The instance's item ID key. Only read: inside a caller's transaction it is never written, since a key created
 * there would roll back with the caller's write while this process keeps using it. Still missing (startup did
 * not run against this database), it is created outside any transaction, on the base handle, and read from there.
 * A stored key that is not 64 hexadecimal characters throws (startup reads it, so the server never starts).
 */
export const getItemIdKey = async (executor: Executor = db): Promise<string> => {
  const key = await readItemIdKey(executor);
  if (key !== null) {
    return checkedItemIdKey(key);
  }
  const base = executor.isTransaction ? db : executor;
  await ensureItemIdKey(base);
  const created = await readItemIdKey(base);
  if (created === null) {
    throw new Error('system_versions.item_id_key could not be set; run the database migrations');
  }
  return checkedItemIdKey(created);
};
