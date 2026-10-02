import { sql, type Kysely } from 'kysely';

/**
 * Foundation tables shared by every package: durable versions, the job queue, the transactional outbox
 * and the audit log. Statuses are text with CHECK constraints so new states need only a constraint change.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  // Single-row table. Durable version counters; caches compare against these on every request.
  await db.schema
    .createTable('system_versions')
    .addColumn('id', 'boolean', (col) =>
      col
        .primaryKey()
        .defaultTo(true)
        .check(sql`id`),
    )
    .addColumn('schema_version', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('permissions_version', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await sql`insert into system_versions default values`.execute(db);

  await db.schema
    .createTable('jobs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('pending')
        .check(sql`status in ('pending', 'running', 'succeeded', 'dead')`),
    )
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (col) =>
      col
        .notNull()
        .defaultTo(10)
        .check(sql`max_attempts > 0`),
    )
    .addColumn('idempotency_key', 'text')
    .addColumn('locked_by', 'text')
    .addColumn('locked_until', 'timestamptz')
    .addColumn('checkpoint', 'jsonb')
    .addColumn('result', 'jsonb')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    .execute();
  await db.schema
    .createIndex('jobs_idempotency_key_uq')
    .on('jobs')
    .column('idempotency_key')
    .unique()
    .where(sql.ref('idempotency_key'), 'is not', null)
    .execute();
  // Claim order for runnable jobs. Expired leases are found through the running-status index.
  await db.schema
    .createIndex('jobs_pending_idx')
    .on('jobs')
    .columns(['priority desc', 'run_at'])
    .where(sql.ref('status'), '=', 'pending')
    .execute();
  await db.schema
    .createIndex('jobs_running_lease_idx')
    .on('jobs')
    .column('locked_until')
    .where(sql.ref('status'), '=', 'running')
    .execute();

  await db.schema
    .createTable('outbox_events')
    .addColumn('id', 'bigint', (col) => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn('event_id', 'uuid', (col) =>
      col
        .notNull()
        .unique()
        .defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('aggregate_type', 'text', (col) => col.notNull())
    .addColumn('aggregate_id', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('dispatched_at', 'timestamptz')
    .addColumn('dispatch_attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_dispatch_error', 'text')
    .execute();
  await db.schema
    .createIndex('outbox_events_undispatched_idx')
    .on('outbox_events')
    .column('id')
    .where(sql.ref('dispatched_at'), 'is', null)
    .execute();

  await db.schema
    .createTable('audit_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('occurred_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('actor_type', 'text', (col) =>
      col.notNull().check(sql`actor_type in ('admin', 'app_user', 'token', 'anonymous', 'system')`),
    )
    .addColumn('actor_id', 'text')
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('target_type', 'text')
    .addColumn('target_id', 'text')
    .addColumn('outcome', 'text', (col) => col.notNull().check(sql`outcome in ('success', 'failure')`))
    .addColumn('request_id', 'text')
    .addColumn('ip', 'text')
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
  await db.schema
    .createIndex('audit_events_occurred_at_idx')
    .on('audit_events')
    .column('occurred_at desc')
    .execute();
  await db.schema
    .createIndex('audit_events_target_idx')
    .on('audit_events')
    .columns(['target_type', 'target_id', 'occurred_at desc'])
    .execute();
  await db.schema
    .createIndex('audit_events_actor_idx')
    .on('audit_events')
    .columns(['actor_type', 'actor_id', 'occurred_at desc'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('audit_events').execute();
  await db.schema.dropTable('outbox_events').execute();
  await db.schema.dropTable('jobs').execute();
  await db.schema.dropTable('system_versions').execute();
};
