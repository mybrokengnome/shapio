import { sql, type CreateTableBuilder, type Kysely } from 'kysely';

/**
 * Publishing (package H): scheduled publications, releases, webhooks and their delivery log, deployment
 * connections and runs, and preview tokens. Secrets (webhook signing secrets, provider tokens) are stored
 * encrypted with a key derived from the instance signing secret; preview tokens are stored as hashes.
 */

const withTimestamps = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`));

const uuidPrimaryKey = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`));

const createdBy = <T extends string, C extends string>(table: CreateTableBuilder<T, C>) =>
  table.addColumn('created_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'));

const PUBLICATION_ACTION_CHECK = sql`action in ('publish', 'unpublish')`;

const createSchedulingTables = async (db: Kysely<unknown>) => {
  // One row per (entry, locale, action, time). The job that executes it checks and flips `status` in the
  // publishing transaction, so a retried job never publishes twice.
  await withTimestamps(
    createdBy(
      uuidPrimaryKey(db.schema.createTable('scheduled_publications'))
        .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('cascade'))
        .addColumn('model_id', 'uuid', (col) => col.notNull())
        .addColumn('locale', 'text', (col) => col.notNull())
        .addColumn('action', 'text', (col) => col.notNull().check(PUBLICATION_ACTION_CHECK))
        .addColumn('run_at', 'timestamptz', (col) => col.notNull())
        .addColumn('status', 'text', (col) =>
          col
            .notNull()
            .defaultTo('scheduled')
            .check(sql`status in ('scheduled', 'done', 'failed', 'cancelled')`),
        )
        // An admin API token that scheduled it (CI); executed later with that token's role, if still live.
        .addColumn('created_by_token', 'uuid', (col) => col.references('api_tokens.id').onDelete('set null'))
        .addColumn('job_id', 'uuid')
        .addColumn('snapshot_seq', 'bigint')
        .addColumn('error', 'text')
        .addColumn('executed_at', 'timestamptz'),
    ),
  ).execute();
  await db.schema
    .createIndex('scheduled_publications_status_idx')
    .on('scheduled_publications')
    .columns(['status', 'run_at'])
    .execute();
  await db.schema
    .createIndex('scheduled_publications_entry_idx')
    .on('scheduled_publications')
    .columns(['entry_id', 'locale'])
    .execute();

  await withTimestamps(
    createdBy(
      uuidPrimaryKey(db.schema.createTable('releases'))
        .addColumn('name', 'text', (col) => col.notNull().check(sql`length(name) between 1 and 200`))
        .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
        .addColumn('status', 'text', (col) =>
          col
            .notNull()
            .defaultTo('draft')
            .check(sql`status in ('draft', 'scheduled', 'published', 'failed', 'cancelled')`),
        )
        .addColumn('scheduled_at', 'timestamptz')
        // The job that executes the schedule; a superseded job sees another ID and does nothing.
        .addColumn('schedule_job_id', 'uuid')
        .addColumn('scheduled_by', 'uuid', (col) => col.references('admin_users.id').onDelete('set null'))
        .addColumn('scheduled_by_token', 'uuid', (col) =>
          col.references('api_tokens.id').onDelete('set null'),
        )
        .addColumn('executed_at', 'timestamptz')
        .addColumn('snapshot_seq', 'bigint')
        .addColumn('error', 'text')
        .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
    ),
  ).execute();
  await db.schema
    .createIndex('releases_status_idx')
    .on('releases')
    .columns(['status', 'created_at'])
    .execute();

  await uuidPrimaryKey(db.schema.createTable('release_items'))
    .addColumn('release_id', 'uuid', (col) => col.notNull().references('releases.id').onDelete('cascade'))
    .addColumn('entry_id', 'uuid', (col) => col.notNull().references('entries.id').onDelete('cascade'))
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull().check(PUBLICATION_ACTION_CHECK))
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'done', 'failed')`),
    )
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('release_items_entry_locale_uq', ['release_id', 'entry_id', 'locale'])
    .execute();
};

const createWebhookTables = async (db: Kysely<unknown>) => {
  await withTimestamps(
    createdBy(
      uuidPrimaryKey(db.schema.createTable('webhooks'))
        .addColumn('name', 'text', (col) => col.notNull().check(sql`length(name) between 1 and 200`))
        .addColumn('url', 'text', (col) => col.notNull())
        // Event names or `prefix.*` patterns from the catalogue (webhooks/catalogue.ts).
        .addColumn('events', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
        .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
        .addColumn('secret_encrypted', 'text', (col) => col.notNull())
        .addColumn('allow_private_network', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('max_attempts', 'integer', (col) =>
          col
            .notNull()
            .defaultTo(8)
            .check(sql`max_attempts between 1 and 20`),
        )
        .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
    ),
  ).execute();

  // One row per (webhook, event). `payload` is the exact body sent, so every attempt signs the same bytes.
  await withTimestamps(
    uuidPrimaryKey(db.schema.createTable('webhook_deliveries'))
      .addColumn('webhook_id', 'uuid', (col) => col.notNull().references('webhooks.id').onDelete('cascade'))
      .addColumn('event_id', 'uuid')
      .addColumn('event_type', 'text', (col) => col.notNull())
      .addColumn('payload', 'jsonb', (col) => col.notNull())
      .addColumn('is_test', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('status', 'text', (col) =>
        col
          .notNull()
          .defaultTo('pending')
          .check(sql`status in ('pending', 'retrying', 'succeeded', 'dead')`),
      )
      .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('last_response_status', 'integer')
      .addColumn('last_error', 'text')
      // Bounded summaries of each attempt (request headers without the signature, truncated response).
      .addColumn('attempt_log', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
      .addColumn('job_id', 'uuid')
      .addColumn('delivered_at', 'timestamptz'),
  ).execute();
  await db.schema
    .createIndex('webhook_deliveries_event_uq')
    .on('webhook_deliveries')
    .columns(['webhook_id', 'event_id'])
    .unique()
    .where(sql.ref('event_id'), 'is not', null)
    .execute();
  await db.schema
    .createIndex('webhook_deliveries_webhook_idx')
    .on('webhook_deliveries')
    .columns(['webhook_id', 'created_at desc'])
    .execute();
};

const createDeploymentTables = async (db: Kysely<unknown>) => {
  await withTimestamps(
    createdBy(
      uuidPrimaryKey(db.schema.createTable('deployment_connections'))
        .addColumn('name', 'text', (col) => col.notNull().check(sql`length(name) between 1 and 200`))
        .addColumn('provider', 'text', (col) =>
          col.notNull().check(sql`provider in ('generic_webhook', 'cloudflare_pages', 'github')`),
        )
        // Non-secret provider settings (URL, account and project, repository and branch).
        .addColumn('settings', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
        // Named secrets (signing secret, API token, deploy hook URL) as one encrypted JSON document.
        .addColumn('secrets_encrypted', 'text', (col) => col.notNull())
        // Secrets taken from the server environment: secret name → variable name, stored as-is.
        .addColumn('secret_env_refs', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
        // Preview tokens issued for this connection read with this delivery role's field grants.
        .addColumn('delivery_role_id', 'uuid', (col) => col.references('admin_roles.id').onDelete('set null'))
        .addColumn('preview_url_template', 'text')
        .addColumn('trigger_policy', sql`text[]`, (col) => col.notNull().defaultTo(sql`'{}'::text[]`))
        .addColumn('debounce_seconds', 'integer', (col) =>
          col
            .notNull()
            .defaultTo(10)
            .check(sql`debounce_seconds between 0 and 3600`),
        )
        .addColumn('allow_private_network', 'boolean', (col) => col.notNull().defaultTo(false))
        .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
        .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1)),
    ),
  ).execute();

  // `status_rank` orders states (queued 0, triggered 1, building 2, unknown 3, deployed/failed 4); updates
  // only move it forward, so a late callback can never regress a run.
  await withTimestamps(
    createdBy(
      uuidPrimaryKey(db.schema.createTable('deployment_runs'))
        .addColumn('connection_id', 'uuid', (col) =>
          col.notNull().references('deployment_connections.id').onDelete('cascade'),
        )
        .addColumn('status', 'text', (col) =>
          col
            .notNull()
            .defaultTo('queued')
            .check(sql`status in ('queued', 'triggered', 'building', 'deployed', 'failed', 'unknown')`),
        )
        .addColumn('status_rank', 'integer', (col) => col.notNull().defaultTo(0))
        .addColumn('trigger', 'text', (col) =>
          col.notNull().check(sql`trigger in ('publish', 'release', 'schema', 'manual', 'retry')`),
        )
        .addColumn('snapshot_seq', 'bigint')
        .addColumn('schema_version', 'integer')
        .addColumn('retry_of', 'uuid', (col) => col.references('deployment_runs.id').onDelete('set null'))
        .addColumn('provider_ref', 'text')
        .addColumn('log_url', 'text')
        .addColumn('site_url', 'text')
        .addColumn('error', 'text')
        .addColumn('timeline', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
        .addColumn('job_id', 'uuid')
        .addColumn('triggered_at', 'timestamptz')
        .addColumn('finished_at', 'timestamptz'),
    ),
  ).execute();
  // At most one queued run per connection: bursts of publishes coalesce into it.
  await db.schema
    .createIndex('deployment_runs_queued_uq')
    .on('deployment_runs')
    .column('connection_id')
    .unique()
    .where(sql.ref('status'), '=', 'queued')
    .execute();
  await db.schema
    .createIndex('deployment_runs_connection_idx')
    .on('deployment_runs')
    .columns(['connection_id', 'created_at desc'])
    .execute();
};

const createPreviewTables = async (db: Kysely<unknown>) => {
  await uuidPrimaryKey(db.schema.createTable('preview_tokens'))
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('token_prefix', 'text', (col) => col.notNull())
    .addColumn('model_id', 'uuid', (col) => col.notNull())
    // Null: every entry of the model. Otherwise exactly this entry (and `locale`, when set).
    .addColumn('entry_id', 'uuid', (col) => col.references('entries.id').onDelete('cascade'))
    .addColumn('locale', 'text')
    .addColumn('connection_id', 'uuid', (col) =>
      col.references('deployment_connections.id').onDelete('set null'),
    )
    // Optional: preview exactly what this delivery role (the site's token) would see, within the creator's access.
    .addColumn('delivery_role_id', 'uuid', (col) => col.references('admin_roles.id').onDelete('set null'))
    // Preview reads are evaluated with the creator's current permissions; no creator, no preview.
    .addColumn('created_by', 'uuid', (col) => col.notNull().references('admin_users.id').onDelete('cascade'))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema
    .createIndex('preview_tokens_entry_idx')
    .on('preview_tokens')
    .columns(['entry_id', 'created_at desc'])
    .execute();
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await createSchedulingTables(db);
  await createWebhookTables(db);
  await createDeploymentTables(db);
  await createPreviewTables(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('preview_tokens').execute();
  await db.schema.dropTable('deployment_runs').execute();
  await db.schema.dropTable('deployment_connections').execute();
  await db.schema.dropTable('webhook_deliveries').execute();
  await db.schema.dropTable('webhooks').execute();
  await db.schema.dropTable('release_items').execute();
  await db.schema.dropTable('releases').execute();
  await db.schema.dropTable('scheduled_publications').execute();
};
