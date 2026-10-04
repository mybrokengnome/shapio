import { sql, type Kysely } from 'kysely';

/**
 * Per-site schema (plan site-schema): a definition belongs to one site (`models.site_id`) or is shared by every
 * site (null, what every existing definition becomes). API IDs are unique per scope; whether a shared API ID
 * collides with a site's is the planner's rule (every view a change touches must stay valid), checked under
 * the schema lock. `schema_drafts.shared` says whether a change set's draft creates a shared definition; a
 * draft otherwise takes its change set's site. Nothing here runs DDL per model (CONTRIBUTING.md rule 1).
 *
 * `down` refuses while any definition belongs to a site: two sites may each have a `post`, which one index
 * over `lower(api_key)` cannot hold. Share or delete them first; then `down` is lossless.
 */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table models add column site_id uuid references sites (id)`.execute(db);
  await sql`create index models_site_idx on models (site_id)`.execute(db);
  await sql`drop index models_api_key_uq`.execute(db);
  await sql`
    create unique index models_api_key_uq on models (coalesce(site_id, ${sql.lit(NIL_UUID)}::uuid), lower(api_key))
    where deleted_at is null
  `.execute(db);
  await sql`alter table schema_drafts add column shared boolean not null default false`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const { rows } = await sql<{
    count: string;
  }>`select count(*)::text as count from models where site_id is not null`.execute(db);
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new Error(
      'Cannot roll back per-site schema while definitions belong to a site: two sites may share an API ID. ' +
        'Share or delete the site definitions first.',
    );
  }
  await sql`alter table schema_drafts drop column shared`.execute(db);
  await sql`drop index models_api_key_uq`.execute(db);
  await sql`create unique index models_api_key_uq on models (lower(api_key)) where deleted_at is null`.execute(
    db,
  );
  await sql`drop index models_site_idx`.execute(db);
  await sql`alter table models drop column site_id`.execute(db);
};
