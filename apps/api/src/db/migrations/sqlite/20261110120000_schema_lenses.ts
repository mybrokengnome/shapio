import { sql, type Kysely } from 'kysely';
import {
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
  LENS_HISTORY_BACKFILL_KEYS,
} from '../20261110120000_schema_lenses.js';
import { rebuildWithCheck } from './rebuildWithCheck.js';

/**
 * SQLite twin of `../20261110120000_schema_lenses.ts`. SQLite cannot add a column whose default is an
 * expression, so `system_versions` is rebuilt with `schema_id` (its one row takes the default on the copy).
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`create table "schema_activations" (
    "model_id" text_uuid not null,
    "schema_version" integer not null,
    "site_id" text_uuid,
    "revision_id" text_uuid,
    "backfilled" integer_boolean not null default 0,
    "created_at" text_timestamptz not null default (shapio_now()),
    constraint "schema_activations_model_id_fkey" foreign key (model_id) references models (id) on delete cascade,
    constraint "schema_activations_revision_id_fkey" foreign key (revision_id) references schema_revisions (id),
    constraint "schema_activations_pkey" primary key (model_id, schema_version)
  )`.execute(db);
  await sql`create index "schema_activations_version_idx" on "schema_activations" (schema_version)`.execute(
    db,
  );
  await sql`
    insert into "schema_activations" (model_id, schema_version, site_id, revision_id, backfilled, created_at)
    select active.model_id, active.schema_version, m.site_id, active.revision_id, 1, active.activated_at
    from "model_active_versions" active
    join "models" m on m.id = active.model_id
  `.execute(db);
  await sql`
    insert into "jobs" (type, payload, max_attempts, idempotency_key)
    select ${LENS_HISTORY_BACKFILL_JOB}, '{}', 5, ${LENS_HISTORY_BACKFILL_KEY}
    where exists (select 1 from "schema_activations")
    on conflict do nothing
  `.execute(db);
  await rebuildWithCheck(db, {
    table: 'system_versions',
    step: 'schema_lenses',
    rewrite: (definition) => {
      if (
        !/^create table "system_versions"/i.test(definition) ||
        /schema_id/.test(definition) ||
        !/,\s*constraint /i.test(definition)
      ) {
        throw new Error(`system_versions: unexpected definition ${definition}`);
      }
      // Columns come before the table constraints.
      return definition.replace(
        /,(\s*)constraint /i,
        ', "schema_id" text_uuid not null default (gen_random_uuid()),$1constraint ',
      );
    },
  });
  await sql`alter table "token_reads" add column "last_schema_version" integer`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "token_reads" drop column "last_schema_version"`.execute(db);
  await sql`alter table "system_versions" drop column "schema_id"`.execute(db);
  await sql`delete from "jobs" where idempotency_key in (${sql.join([...LENS_HISTORY_BACKFILL_KEYS])})`.execute(
    db,
  );
  await sql`drop table "schema_activations"`.execute(db);
};
