import { sql, type Kysely } from 'kysely';

/**
 * SEO defaults per site (plan seo-fields): `sites.seo_defaults` holds the site's default texts per locale, its
 * default social image and Twitter handle (`SeoDefaults` in @shapio/schema). Nullable, no default: a
 * catalog-only change, no table rewrite.
 *
 * `site.settings` is the site action that edits them. Every role that holds `publishing.manage` (everything
 * about what a site publishes) gets it; the built-in owner and admin roles get it from `ensureSystemRoles`.
 * The permissions version moves only when grants changed, so running instances reload exactly then.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sites add column seo_defaults jsonb`.execute(db);
  await sql`
    with granted as (
      insert into admin_role_permissions (role_id, action, model_id, condition, field_ids)
      select role_id, 'site.settings', null, null, null
      from admin_role_permissions
      where action = 'publishing.manage' and model_id is null
      on conflict on constraint admin_role_permissions_grant_uq do nothing
      returning 1
    )
    update system_versions set permissions_version = permissions_version + 1, updated_at = now()
    where exists (select 1 from granted)
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    with revoked as (
      delete from admin_role_permissions where action = 'site.settings' returning 1
    )
    update system_versions set permissions_version = permissions_version + 1, updated_at = now()
    where exists (select 1 from revoked)
  `.execute(db);
  await sql`alter table sites drop column seo_defaults`.execute(db);
};
