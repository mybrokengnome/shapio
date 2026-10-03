import { sql, type Kysely } from 'kysely';

/**
 * Field index layout v2 (sites plan §H): per-field expression indexes on `entry_heads` lead with `site_id`,
 * because every content query names its site. Building them is `CREATE INDEX CONCURRENTLY`, which cannot run
 * in a migration's transaction and may take a while, so this migration only enqueues the
 * `schema.fieldIndexLayout` job (schema/planner/indexLayout.ts), which rebuilds the indexes and drops the
 * old ones while the instance keeps serving. Nothing to rebuild (no field index yet, e.g. a new install):
 * no job.
 */
const JOB_TYPE = 'schema.fieldIndexLayout';
const IDEMPOTENCY_KEY = 'schema.fieldIndexLayout:v2';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    insert into jobs (type, payload, max_attempts, idempotency_key)
    select ${JOB_TYPE}, '{}'::jsonb, 5, ${IDEMPOTENCY_KEY}
    where exists (
      select 1 from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'entry_heads'::regclass and c.relname like 'eh\\_%'
    )
    on conflict do nothing
  `.execute(db);
};

/** The layout job is idempotent; rolling back only forgets it if it has not run yet. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from jobs where idempotency_key = ${IDEMPOTENCY_KEY} and status = 'pending'`.execute(db);
};
