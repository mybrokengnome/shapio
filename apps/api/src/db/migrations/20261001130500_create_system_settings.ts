import { sql, type Kysely } from 'kysely';

/**
 * Instance-wide key/value settings that must survive restarts and be shared by every instance, e.g. the
 * generated signing secret. General purpose: later packages add keys, not tables.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('system_settings')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('system_settings').execute();
};
