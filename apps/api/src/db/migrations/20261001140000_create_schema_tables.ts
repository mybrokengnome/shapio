import { sql, type Kysely } from 'kysely';

/**
 * Schema registry (package D, ADR 0002): models and components (one table, `kind` discriminator), immutable
 * schema revisions, the per-model active pointer, schema change jobs, locales and schema settings.
 * Model definitions are data: creating or changing a model never runs DDL (CONTRIBUTING.md rule 1).
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('models')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('kind', 'text', (col) =>
      col.notNull().check(sql`kind in ('collection', 'singleton', 'component')`),
    )
    // The API key of the active revision, denormalised so the database itself rejects two live
    // definitions with the same (case-folded) key even if two activations race.
    .addColumn('api_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Soft delete: entries keep their model and reappear if the definition is applied again.
    .addColumn('deleted_at', 'timestamptz')
    .execute();
  await sql`create unique index models_api_key_uq on models (lower(api_key)) where deleted_at is null`.execute(
    db,
  );

  await db.schema
    .createTable('schema_revisions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('model_id', 'uuid', (col) => col.notNull().references('models.id').onDelete('restrict'))
    .addColumn('version', 'integer', (col) => col.notNull().check(sql`version > 0`))
    .addColumn('definition', 'jsonb', (col) => col.notNull())
    // `sha256:<hex>` of the canonical serialization (@shapio/schema hashDefinition).
    .addColumn('hash', 'text', (col) => col.notNull())
    .addColumn('parent_revision_id', 'uuid', (col) => col.references('schema_revisions.id'))
    .addColumn('created_by_type', 'text', (col) => col.notNull())
    .addColumn('created_by_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('schema_revisions_model_version_uq', ['model_id', 'version'])
    .execute();
  // Revisions are history: never rewritten.
  await sql`
    create function schema_revisions_immutable() returns trigger language plpgsql as $$
    begin
      raise exception 'schema_revisions rows are immutable';
    end;
    $$
  `.execute(db);
  await sql`
    create trigger schema_revisions_no_update before update on schema_revisions
    for each row execute function schema_revisions_immutable()
  `.execute(db);

  await db.schema
    .createTable('model_active_versions')
    .addColumn('model_id', 'uuid', (col) => col.primaryKey().references('models.id').onDelete('cascade'))
    .addColumn('revision_id', 'uuid', (col) => col.notNull().references('schema_revisions.id'))
    .addColumn('version', 'integer', (col) => col.notNull())
    // system_versions.schema_version right after this activation.
    .addColumn('schema_version', 'integer', (col) => col.notNull())
    .addColumn('activated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('schema_change_jobs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('target_type', 'text', (col) => col.notNull().check(sql`target_type in ('model', 'locale')`))
    .addColumn('target_id', 'text', (col) => col.notNull())
    .addColumn('model_id', 'uuid', (col) => col.references('models.id'))
    .addColumn('from_revision_id', 'uuid', (col) => col.references('schema_revisions.id'))
    .addColumn('to_revision_id', 'uuid', (col) => col.references('schema_revisions.id'))
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'running', 'activated', 'failed', 'cancelled')`),
    )
    .addColumn('plan', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('job_id', 'uuid', (col) => col.references('jobs.id').onDelete('set null'))
    .addColumn('error', 'jsonb')
    .addColumn('requested_by_type', 'text', (col) => col.notNull())
    .addColumn('requested_by_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    .execute();
  // One change in flight per model or locale; a second one is refused until the first finishes.
  await sql`
    create unique index schema_change_jobs_in_flight_uq on schema_change_jobs (target_type, target_id)
    where status in ('pending', 'running')
  `.execute(db);
  await db.schema
    .createIndex('schema_change_jobs_model_idx')
    .on('schema_change_jobs')
    .columns(['model_id', 'created_at desc'])
    .execute();

  await db.schema
    .createTable('locales')
    .addColumn('code', 'text', (col) => col.primaryKey())
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('fallbacks', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index locales_single_default_uq on locales (is_default) where is_default`.execute(
    db,
  );
  // Every instance starts with one locale so localized models work out of the box; it can be renamed.
  await sql`insert into locales (code, label, is_default) values ('en', 'English', true)`.execute(db);

  // Single row. `read_only` is the opt-in lock (ADR 0002): the admin UI cannot change models, only
  // `shapio schema apply` can. Never on by default.
  await db.schema
    .createTable('schema_settings')
    .addColumn('id', 'boolean', (col) =>
      col
        .primaryKey()
        .defaultTo(true)
        .check(sql`id`),
    )
    .addColumn('read_only', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('read_only_reason', 'text')
    .addColumn('updated_by_type', 'text')
    .addColumn('updated_by_id', 'text')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`insert into schema_settings default values`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('schema_settings').execute();
  await db.schema.dropTable('locales').execute();
  await db.schema.dropTable('schema_change_jobs').execute();
  await db.schema.dropTable('model_active_versions').execute();
  await db.schema.dropTable('schema_revisions').execute();
  await sql`drop function schema_revisions_immutable()`.execute(db);
  await db.schema.dropTable('models').execute();
};
