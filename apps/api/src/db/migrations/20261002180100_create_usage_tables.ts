import { sql, type Kysely } from 'kysely';

/**
 * Field usage from delivery traffic (plan developer-face §5): daily counters written by the in-memory
 * aggregator (usage/aggregator.ts) in one multi-row upsert per flush, never per request. Counts only, no
 * payloads. `principal_key` is `token:<id>`, `app_users` or `anonymous`. Pruned by the retention job
 * after USAGE_RETENTION_DAYS.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('field_reads')
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    // A stable field ID, or `<relation field ID>.<target field ID>` for a populated relation's field.
    .addColumn('field_path', 'text', (col) => col.notNull())
    .addColumn('principal_key', 'text', (col) => col.notNull())
    // `explicit`: the reader selected the field; `implicit`: it asked for the whole model.
    .addColumn('selection', 'text', (col) => col.notNull().check(sql`selection in ('explicit', 'implicit')`))
    .addColumn('reads', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('last_read_at', 'timestamptz', (col) => col.notNull())
    .addPrimaryKeyConstraint('field_reads_pkey', [
      'day',
      'model_id',
      'field_path',
      'principal_key',
      'selection',
    ])
    .execute();
  await db.schema
    .createIndex('field_reads_model_day_idx')
    .on('field_reads')
    .columns(['model_id', 'day'])
    .execute();

  await db.schema
    .createTable('token_reads')
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('principal_key', 'text', (col) => col.notNull())
    .addColumn('requests', 'bigint', (col) => col.notNull().defaultTo(0))
    // The last `?snapshot=N` (or GraphQL `snapshot`) this principal pinned that day; null = never pinned.
    .addColumn('last_snapshot', 'bigint')
    .addColumn('last_read_at', 'timestamptz', (col) => col.notNull())
    .addPrimaryKeyConstraint('token_reads_pkey', ['day', 'principal_key'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('token_reads').execute();
  await db.schema.dropTable('field_reads').execute();
};
