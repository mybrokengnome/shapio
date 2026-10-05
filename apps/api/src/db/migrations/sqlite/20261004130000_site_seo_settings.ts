import { sql, type Kysely } from 'kysely';

/**
 * SQLite twin of `../20261004130000_site_seo_settings.ts`. `insert or ignore` stands in for `on conflict do
 * nothing` (the grant's unique index); the permissions version moves only when a grant was added or removed.
 */
const bumpPermissionsVersion = (db: Kysely<unknown>) =>
  sql`update "system_versions" set permissions_version = permissions_version + 1, updated_at = shapio_now()`.execute(
    db,
  );

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "sites" add column "seo_defaults" text_jsonb`.execute(db);
  const granted = await sql`
    insert or ignore into "admin_role_permissions" (role_id, action, model_id, condition, field_ids)
    select role_id, 'site.settings', null, null, null
    from "admin_role_permissions"
    where action = 'publishing.manage' and model_id is null
  `.execute(db);
  if (Number(granted.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const revoked = await sql`delete from "admin_role_permissions" where action = 'site.settings'`.execute(db);
  if (Number(revoked.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
  await sql`alter table "sites" drop column "seo_defaults"`.execute(db);
};
