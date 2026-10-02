import { sql, type Kysely } from 'kysely';

/**
 * Content storage (package E, ADR 0001): entries, immutable content revisions, mutable heads (one per
 * entry, locale and state) with every content index, derived relation edges, the unique-value registry
 * and the publication log behind `?snapshot=N`. User content models never get tables of their own
 * (CONTRIBUTING.md rule 1): their values are JSONB keyed by stable field IDs.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('entries')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('model_id', 'uuid', (col) => col.notNull().references('models.id').onDelete('restrict'))
    // The app user who owns the entry (`ownedByPrincipal`). Package I adds the foreign key to app_users.
    .addColumn('owner_app_user_id', 'uuid')
    .addColumn('created_by_admin_id', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Soft delete: revisions stay as history; heads, edges and registry rows are removed.
    .addColumn('deleted_at', 'timestamptz')
    .execute();
  await sql`create index entries_model_idx on entries (model_id, created_at) where deleted_at is null`.execute(
    db,
  );
  await sql`create index entries_owner_idx on entries (owner_app_user_id) where owner_app_user_id is not null`.execute(
    db,
  );

  await db.schema
    .createTable('content_revisions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('restrict'))
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('schema_revision_id', 'uuid', (col) => col.notNull().references('schema_revisions.id'))
    .addColumn('data', 'jsonb', (col) => col.notNull())
    // Why the revision exists: an explicit save, a publish of autosaved changes, a restore...
    .addColumn('reason', 'text', (col) =>
      col.notNull().check(sql`reason in ('create', 'save', 'publish', 'restore', 'duplicate', 'localize')`),
    )
    .addColumn('author_type', 'text', (col) => col.notNull())
    .addColumn('author_id', 'text')
    // Always a revision of the same entry and locale.
    .addColumn('parent_revision_id', 'uuid', (col) => col.references('content_revisions.id'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  // The only index on history (ADR 0001): content indexes live on heads.
  await db.schema
    .createIndex('content_revisions_entry_idx')
    .on('content_revisions')
    .columns(['entry_id', 'locale', 'created_at'])
    .execute();
  // History is never rewritten. Deleting is allowed only for an explicit purge (a removed locale).
  await sql`
    create function content_revisions_immutable() returns trigger language plpgsql as $$
    begin
      raise exception 'content_revisions rows are immutable';
    end;
    $$
  `.execute(db);
  await sql`
    create trigger content_revisions_no_update before update on content_revisions
    for each row execute function content_revisions_immutable()
  `.execute(db);

  // Every head write takes the next value, so the schema planner can re-check "heads changed after a
  // watermark" at activation (ADR 0002, transitional write policy).
  await sql`create sequence entry_heads_change_seq as bigint`.execute(db);
  await db.schema
    .createTable('entry_heads')
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull().check(sql`state in ('draft', 'published')`))
    .addColumn('revision_id', 'uuid', (col) => col.notNull().references('content_revisions.id'))
    .addColumn('data', 'jsonb', (col) => col.notNull())
    // Set when an autosave changed `data` since `revision_id` was written; cleared by the next revision.
    .addColumn('autosaved_at', 'timestamptz')
    // Optimistic concurrency token for editors (stale writes get 409).
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('change_seq', 'bigint', (col) =>
      col.notNull().defaultTo(sql`nextval('entry_heads_change_seq')`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('entry_heads_pkey', ['entry_id', 'locale', 'state'])
    .execute();
  await sql`alter sequence entry_heads_change_seq owned by entry_heads.change_seq`.execute(db);
  // Serves `data @> {...}` only (scalar equality and containment filters).
  await sql`create index entry_heads_data_gin on entry_heads using gin (data jsonb_path_ops)`.execute(db);
  await db.schema
    .createIndex('entry_heads_model_locale_state_idx')
    .on('entry_heads')
    .columns(['model_id', 'locale', 'state'])
    .execute();
  await db.schema
    .createIndex('entry_heads_change_seq_idx')
    .on('entry_heads')
    .columns(['model_id', 'change_seq'])
    .execute();

  await db.schema
    .createTable('relation_edges')
    .addColumn('source_entry_id', 'uuid', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('field_id', 'uuid', (col) => col.notNull())
    // Order of the target among every value of this field in the head (document order).
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('target_entry_id', 'uuid', (col) => col.notNull().references('entries.id'))
    .addPrimaryKeyConstraint('relation_edges_pkey', [
      'source_entry_id',
      'locale',
      'state',
      'field_id',
      'position',
    ])
    .addForeignKeyConstraint(
      'relation_edges_head_fk',
      ['source_entry_id', 'locale', 'state'],
      'entry_heads',
      ['entry_id', 'locale', 'state'],
      (constraint) => constraint.onDelete('cascade'),
    )
    .execute();
  await db.schema
    .createIndex('relation_edges_target_idx')
    .on('relation_edges')
    .columns(['target_entry_id', 'state'])
    .execute();

  await db.schema
    .createTable('unique_values')
    .addColumn('field_id', 'uuid', (col) => col.notNull())
    // The head's locale for localized fields; `*` for shared fields (every locale holds the same value).
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull().check(sql`state in ('draft', 'published')`))
    // SHA-256 of the field's normalized value.
    .addColumn('value_hash', 'text', (col) => col.notNull())
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    .addPrimaryKeyConstraint('unique_values_pkey', ['field_id', 'locale', 'state', 'value_hash'])
    .execute();
  await db.schema.createIndex('unique_values_entry_idx').on('unique_values').column('entry_id').execute();

  // Single row: the last publication sequence number. Publishing increments it in the publishing
  // transaction, so the row lock orders publications by commit and a reader never sees N before N-1.
  await db.schema
    .createTable('publication_state')
    .addColumn('id', 'boolean', (col) =>
      col
        .primaryKey()
        .defaultTo(true)
        .check(sql`id`),
    )
    .addColumn('last_seq', 'bigint', (col) => col.notNull().defaultTo(0))
    .execute();
  await sql`insert into publication_state default values`.execute(db);

  // Which revision was live for (entry, locale) from one publication sequence number until another.
  await db.schema
    .createTable('publication_log')
    .addColumn('id', 'bigint', (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id'))
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('revision_id', 'uuid', (col) => col.notNull().references('content_revisions.id'))
    .addColumn('from_seq', 'bigint', (col) => col.notNull())
    // Null while the revision is still live.
    .addColumn('to_seq', 'bigint')
    .addColumn('published_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`create unique index publication_log_open_uq on publication_log (entry_id, locale) where to_seq is null`.execute(
    db,
  );
  await db.schema
    .createIndex('publication_log_model_seq_idx')
    .on('publication_log')
    .columns(['model_id', 'from_seq'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('publication_log').execute();
  await db.schema.dropTable('publication_state').execute();
  await db.schema.dropTable('unique_values').execute();
  await db.schema.dropTable('relation_edges').execute();
  await db.schema.dropTable('entry_heads').execute();
  await db.schema.dropTable('content_revisions').execute();
  await sql`drop function content_revisions_immutable()`.execute(db);
  await db.schema.dropTable('entries').execute();
};
