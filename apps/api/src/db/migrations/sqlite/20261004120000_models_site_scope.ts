import { sql, type Kysely } from 'kysely';

/**
 * SQLite twin of `../20261004120000_models_site_scope.ts`. `down` rebuilds `models` without `site_id`
 * (SQLite cannot drop a column that carries a foreign key). With `legacy_alter_table` on, renaming the old
 * table aside leaves the references of `schema_revisions`, `model_active_versions`, `schema_change_jobs` and
 * `entries` pointing at the name `models`, which the rebuilt table then takes; dropping the renamed table
 * deletes nothing they reference.
 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "models" add column "site_id" text_uuid references sites (id)`.execute(db);
  await sql`create index "models_site_idx" on "models" (site_id)`.execute(db);
  await sql`drop index "models_api_key_uq"`.execute(db);
  await sql`
    create unique index "models_api_key_uq" on "models" (coalesce(site_id, ${sql.lit(NIL_UUID)}), lower(api_key))
    where (deleted_at IS NULL)
  `.execute(db);
  await sql`alter table "schema_drafts" add column "shared" integer_boolean not null default 0`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const { rows } = await sql<{
    count: number;
  }>`select count(*) as count from "models" where site_id is not null`.execute(db);
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new Error(
      'Cannot roll back per-site schema while definitions belong to a site: two sites may share an API ID. ' +
        'Share or delete the site definitions first.',
    );
  }
  await sql`alter table "schema_drafts" drop column "shared"`.execute(db);
  await sql`pragma legacy_alter_table = on`.execute(db);
  await sql`alter table "models" rename to "models_before_site_scope"`.execute(db);
  await sql`create table "models" (
    "id" text_uuid not null,
    "kind" text not null,
    "api_key" text not null,
    "created_at" text_timestamptz not null default (shapio_now()),
    "updated_at" text_timestamptz not null default (shapio_now()),
    "deleted_at" text_timestamptz,
    constraint "models_kind_check" CHECK ((kind IN ('collection', 'singleton', 'component'))),
    constraint "models_pkey" primary key (id)
  )`.execute(db);
  await sql`insert into "models" (id, kind, api_key, created_at, updated_at, deleted_at)
    select id, kind, api_key, created_at, updated_at, deleted_at from "models_before_site_scope"`.execute(db);
  await sql`drop table "models_before_site_scope"`.execute(db);
  await sql`pragma legacy_alter_table = off`.execute(db);
  await sql`create unique index "models_api_key_uq" on "models" (lower(api_key)) where (deleted_at IS NULL)`.execute(
    db,
  );
};
