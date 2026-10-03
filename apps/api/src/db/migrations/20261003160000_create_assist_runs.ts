import { sql, type Kysely } from 'kysely';

/**
 * Editor assists (plan agentic-ecosystem §A0, §I): one `assist_runs` row per assist request (who, which
 * action, which model, token usage, duration, outcome). Never prompt or response text. Content-ops runs are
 * jobs: `job_id` points at the job whose result holds the proposals. Pruned by the retention job after
 * USAGE_RETENTION_DAYS. Change sets an assist run opens are marked `source = 'assist'`.
 */
const ACTIONS = sql`action in ('alt_text', 'summarize', 'translate', 'rewrite', 'schema_draft', 'content_ops')`;
const SOURCES_WIDENED = sql`source in ('manual', 'release', 'restore', 'builder', 'assist')`;
const SOURCES_ORIGINAL = sql`source in ('manual', 'release', 'restore', 'builder')`;

const replaceSourceCheck = async (db: Kysely<unknown>, check: typeof SOURCES_WIDENED) => {
  await sql`alter table change_sets drop constraint change_sets_source_check`.execute(db);
  await sql`alter table change_sets add constraint change_sets_source_check check (${check}) not valid`.execute(
    db,
  );
  await sql`alter table change_sets validate constraint change_sets_source_check`.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('assist_runs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('site_id', 'uuid', (col) => col.notNull().references('sites.id').onDelete('cascade'))
    // `admin` or `token` (the same actor types as audit events), and the admin user or token ID.
    .addColumn('actor_type', 'text', (col) => col.notNull())
    .addColumn('actor_id', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull().check(ACTIONS))
    // The content-ops rule (`altMissing`, `localeMissing`); null for other actions.
    .addColumn('rule', 'text')
    .addColumn('provider', 'text', (col) => col.notNull())
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('duration_ms', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'text', (col) =>
      col.notNull().check(sql`status in ('queued', 'running', 'succeeded', 'failed')`),
    )
    .addColumn('error_code', 'text')
    .addColumn('job_id', 'uuid', (col) => col.references('jobs.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('finished_at', 'timestamptz')
    .execute();
  // Usage this month per site (status endpoint) and retention pruning by age.
  await db.schema
    .createIndex('assist_runs_site_created_idx')
    .on('assist_runs')
    .columns(['site_id', 'created_at'])
    .execute();
  await db.schema.createIndex('assist_runs_created_idx').on('assist_runs').column('created_at').execute();
  await replaceSourceCheck(db, SOURCES_WIDENED);
};

/** Refuses while change sets opened by assist exist: a down migration never deletes user data. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  const { rows } = await sql<{ count: string }>`
    select count(*)::text as count from change_sets where source = 'assist'
  `.execute(db);
  const count = Number(rows[0]?.count ?? 0);
  if (count > 0) {
    throw new Error(
      `Cannot roll back: ${count} change set(s) were opened by assist. Discard and delete them first, then run the rollback again.`,
    );
  }
  await replaceSourceCheck(db, SOURCES_ORIGINAL);
  await db.schema.dropTable('assist_runs').execute();
};
