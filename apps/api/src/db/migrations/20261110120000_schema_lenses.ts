import { sql, type Kysely } from 'kysely';

/**
 * Schema lenses (plan schema-lenses): the history a lens needs and two columns other packages use.
 * - `schema_activations`: which revision of each definition, in which scope, every global schema version
 *   made active (`revision_id` null: deleted at that version). Activation writes a row in its own
 *   transaction from now on. Baseline: one row per live definition from `model_active_versions`, marked
 *   `backfilled`; the `schema.lensHistoryBackfill` job this migration enqueues (only when there is a baseline)
 *   rebuilds the older rows from the audit log.
 *   `site_id` has no foreign key on purpose: a definition that moved off a workspace keeps the rows that
 *   place it there at older versions, and deleting that workspace must neither be refused nor rewrite them.
 * - `system_versions.schema_id`: a random ID, written once, that a client sends with its version
 *   (`<schemaId>:<version>`): version numbers only mean something on the instance that issued them.
 * - `token_reads.last_schema_version`: the schema version a token last read through (null: none).
 * SQLite and MySQL have their own twins.
 */
export const LENS_HISTORY_BACKFILL_JOB = 'schema.lensHistoryBackfill';
/** `:v2`: the corrected, re-runnable backfill (v1 put pre-0.9.0 history in wrong scopes; never released). */
export const LENS_HISTORY_BACKFILL_KEY = 'schema.lensHistoryBackfill:v2';
/** Every key this migration ever enqueued under, so `down` forgets them all and `up` can enqueue again. */
export const LENS_HISTORY_BACKFILL_KEYS = [
  'schema.lensHistoryBackfill:v1',
  LENS_HISTORY_BACKFILL_KEY,
] as const;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table schema_activations (
      model_id uuid not null constraint schema_activations_model_id_fkey references models (id) on delete cascade,
      schema_version integer not null,
      site_id uuid,
      revision_id uuid constraint schema_activations_revision_id_fkey references schema_revisions (id),
      backfilled boolean not null default false,
      created_at timestamptz not null default now(),
      constraint schema_activations_pkey primary key (model_id, schema_version)
    )
  `.execute(db);
  await sql`create index schema_activations_version_idx on schema_activations (schema_version)`.execute(db);
  await sql`
    insert into schema_activations (model_id, schema_version, site_id, revision_id, backfilled, created_at)
    select active.model_id, active.schema_version, models.site_id, active.revision_id, true, active.activated_at
    from model_active_versions active
    join models on models.id = active.model_id
  `.execute(db);
  await sql`
    insert into jobs (type, payload, max_attempts, idempotency_key)
    select ${LENS_HISTORY_BACKFILL_JOB}, '{}'::jsonb, 5, ${LENS_HISTORY_BACKFILL_KEY}
    where exists (select 1 from schema_activations)
    on conflict do nothing
  `.execute(db);
  // The one row gets its ID from the default; nothing ever writes the column again.
  await sql`alter table system_versions add column schema_id uuid not null default gen_random_uuid()`.execute(
    db,
  );
  await sql`alter table token_reads add column last_schema_version integer`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table token_reads drop column last_schema_version`.execute(db);
  await sql`alter table system_versions drop column schema_id`.execute(db);
  // Whatever its status: a finished job's key would otherwise stop the next `up` from enqueueing it again.
  await sql`delete from jobs where idempotency_key in (${sql.join([...LENS_HISTORY_BACKFILL_KEYS])})`.execute(
    db,
  );
  await sql`drop table schema_activations`.execute(db);
};
