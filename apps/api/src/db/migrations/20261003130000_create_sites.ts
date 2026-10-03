import { sql, type Kysely } from 'kysely';

/**
 * Sites (plan agentic-ecosystem §H, ADR 0011): one instance hosts many sites with one schema and one login.
 * A site owns its content, media, tokens, change sets, snapshots, app users and usage counters; models,
 * locales, admin users and roles stay instance-wide. Role assignments carry a site (null = every site).
 *
 * Every existing row moves to the primary site (fixed ID below, key `default`). Columns are added with a
 * constant default, which PostgreSQL records in the catalog without rewriting the table, and the default is
 * dropped straight after: from here on every insert must name its site. Copies of the entry's site (heads,
 * the publication log, unique values, findings, schedules, preview tokens) carry a composite foreign key to
 * `entries (id, site_id)`, so a copy can never disagree with its entry.
 *
 * `down` refuses while more than one site exists (merging sites would merge their snapshot ledgers and
 * uniqueness, and widen role assignments). With one site it is lossless.
 */

/** The primary site every existing row belongs to. Repeated in constants/sites.ts (migrations never import app code). */
const PRIMARY_SITE_ID = '00000000-0000-4000-b000-000000000001';
const PUBLIC_ROLE_ID = '00000000-0000-4000-a000-000000000001';
const AUTHENTICATED_ROLE_ID = '00000000-0000-4000-a000-000000000002';

type OnDelete = 'restrict' | 'cascade' | 'set null';

/** Tables whose rows always belong to one site, and what deleting a site does to them. */
const REQUIRED_SITE_TABLES: ReadonlyArray<[table: string, onDelete: OnDelete]> = [
  // Content and its derived rows: a site with content cannot be deleted.
  ['entries', 'restrict'],
  ['entry_heads', 'restrict'],
  ['unique_values', 'restrict'],
  ['publication_log', 'restrict'],
  ['scheduled_publications', 'restrict'],
  ['content_health_findings', 'restrict'],
  ['media_folders', 'restrict'],
  ['media_assets', 'restrict'],
  ['change_sets', 'restrict'],
  ['app_users', 'restrict'],
  ['app_user_roles', 'restrict'],
  ['app_oauth_accounts', 'restrict'],
  // Configuration and bookkeeping go with the (empty) site.
  ['publication_state', 'cascade'],
  ['publication_snapshots', 'cascade'],
  ['media_upload_grants', 'cascade'],
  ['preview_tokens', 'cascade'],
  ['deployment_connections', 'cascade'],
  ['field_reads', 'cascade'],
  ['token_reads', 'cascade'],
];

/** Null means "every site" (network): tokens, webhooks, role assignments; or "not about a site": history. */
const OPTIONAL_SITE_TABLES: ReadonlyArray<[table: string, onDelete: OnDelete]> = [
  ['api_tokens', 'cascade'],
  ['webhooks', 'cascade'],
  ['admin_user_roles', 'cascade'],
  ['outbox_events', 'set null'],
  ['audit_events', 'set null'],
];

/** Copies of the entry's site, tied to it by a composite foreign key. */
const ENTRY_SITE_COPIES: ReadonlyArray<[table: string, onDelete: OnDelete]> = [
  ['entry_heads', 'cascade'],
  ['unique_values', 'cascade'],
  ['publication_log', 'restrict'],
  ['scheduled_publications', 'cascade'],
  ['content_health_findings', 'cascade'],
  ['preview_tokens', 'cascade'],
];

const createSites = async (db: Kysely<unknown>) => {
  await sql`
    create table sites (
      id uuid primary key default gen_random_uuid(),
      key text not null unique check (key ~ '^[a-z][a-z0-9-]{0,62}$'),
      name text not null check (length(name) between 1 and 200),
      is_primary boolean not null default false,
      version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create unique index sites_single_primary_uq on sites (is_primary) where is_primary`.execute(db);
  await sql`insert into sites (id, key, name, is_primary) values (${PRIMARY_SITE_ID}, 'default', 'Default site', true)`.execute(
    db,
  );

  // Which app roles anonymous callers (`public`) and every signed-in app user (`authenticated`) hold on a
  // site. A new site binds nothing: deny by default (brief §8).
  await sql`
    create table site_app_roles (
      site_id uuid not null references sites(id) on delete cascade,
      audience text not null check (audience in ('public', 'authenticated')),
      role_id uuid not null references app_roles(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (site_id, audience, role_id)
    )
  `.execute(db);
  await sql`create index site_app_roles_role_idx on site_app_roles (role_id)`.execute(db);
  await sql`
    insert into site_app_roles (site_id, audience, role_id) values
      (${PRIMARY_SITE_ID}, 'public', ${PUBLIC_ROLE_ID}),
      (${PRIMARY_SITE_ID}, 'authenticated', ${AUTHENTICATED_ROLE_ID})
  `.execute(db);
};

const siteForeignKey = async (db: Kysely<unknown>, table: string, onDelete: OnDelete) => {
  const name = sql.id(`${table}_site_fk`);
  await sql`alter table ${sql.table(table)} add constraint ${name}
    foreign key (site_id) references sites(id) on delete ${sql.raw(onDelete)} not valid`.execute(db);
  await sql`alter table ${sql.table(table)} validate constraint ${name}`.execute(db);
};

const addSiteColumns = async (db: Kysely<unknown>) => {
  for (const [table, onDelete] of REQUIRED_SITE_TABLES) {
    // A constant default is a catalog-only change (no table rewrite); dropping it makes inserts name a site.
    await sql`alter table ${sql.table(table)}
      add column site_id uuid not null default ${sql.lit(PRIMARY_SITE_ID)}::uuid`.execute(db);
    await sql`alter table ${sql.table(table)} alter column site_id drop default`.execute(db);
    await siteForeignKey(db, table, onDelete);
  }
  for (const [table, onDelete] of OPTIONAL_SITE_TABLES) {
    await sql`alter table ${sql.table(table)} add column site_id uuid`.execute(db);
    await siteForeignKey(db, table, onDelete);
  }
  // Delivery tokens always belong to a site; admin tokens stay network tokens (null), as they behave today.
  await sql`
    update api_tokens t set site_id = ${PRIMARY_SITE_ID}
    from admin_roles r where r.id = t.role_id and r.kind = 'delivery'
  `.execute(db);
};

const tieCopiesToEntries = async (db: Kysely<unknown>) => {
  await sql`alter table entries add constraint entries_id_site_uq unique (id, site_id)`.execute(db);
  for (const [table, onDelete] of ENTRY_SITE_COPIES) {
    const name = sql.id(`${table}_entry_site_fk`);
    await sql`alter table ${sql.table(table)} add constraint ${name}
      foreign key (entry_id, site_id) references entries(id, site_id) on delete ${sql.raw(onDelete)} not valid`.execute(
      db,
    );
    await sql`alter table ${sql.table(table)} validate constraint ${name}`.execute(db);
  }
};

const rekeyContent = async (db: Kysely<unknown>) => {
  await sql`drop index entries_model_idx`.execute(db);
  await sql`create index entries_model_idx on entries (site_id, model_id, created_at) where deleted_at is null`.execute(
    db,
  );
  await sql`drop index entry_heads_model_locale_state_idx`.execute(db);
  await sql`create index entry_heads_model_locale_state_idx on entry_heads (site_id, model_id, locale, state)`.execute(
    db,
  );
  // Uniqueness is per site: two sites may both have an article with the slug `hello`.
  await sql`alter table unique_values drop constraint unique_values_pkey`.execute(db);
  await sql`alter table unique_values add constraint unique_values_pkey
    primary key (site_id, field_id, locale, state, value_hash)`.execute(db);

  // One publication sequence per site: snapshot N of site A has nothing to do with snapshot N of site B.
  await sql`alter table publication_state drop constraint publication_state_pkey`.execute(db);
  await sql`alter table publication_state drop column id`.execute(db);
  await sql`alter table publication_state add constraint publication_state_pkey primary key (site_id)`.execute(
    db,
  );
  await sql`alter table publication_snapshots drop constraint publication_snapshots_pkey`.execute(db);
  await sql`alter table publication_snapshots add constraint publication_snapshots_pkey primary key (site_id, seq)`.execute(
    db,
  );
  await sql`drop index publication_log_to_seq_idx`.execute(db);
  await sql`create index publication_log_to_seq_idx on publication_log (site_id, to_seq) where to_seq is not null`.execute(
    db,
  );
  await sql`drop index publication_log_model_seq_idx`.execute(db);
  await sql`create index publication_log_model_seq_idx on publication_log (site_id, model_id, from_seq)`.execute(
    db,
  );

  await sql`create index scheduled_publications_site_idx on scheduled_publications (site_id, run_at)`.execute(
    db,
  );
  await sql`drop index content_health_findings_open_idx`.execute(db);
  await sql`create index content_health_findings_open_idx on content_health_findings
    (site_id, rule, last_seen_at desc, id) where resolved_at is null`.execute(db);
  await sql`drop index change_sets_status_idx`.execute(db);
  await sql`create index change_sets_status_idx on change_sets (site_id, status, created_at desc)`.execute(
    db,
  );
};

const rekeyMedia = async (db: Kysely<unknown>) => {
  await sql`alter table media_folders add constraint media_folders_id_site_uq unique (id, site_id)`.execute(
    db,
  );
  await sql`drop index media_folders_sibling_name_uq`.execute(db);
  await sql`create unique index media_folders_sibling_name_uq on media_folders
    (site_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`.execute(db);
  // A folder's parent and an asset's folder are on the same site.
  await sql`alter table media_folders drop constraint media_folders_parent_id_fkey`.execute(db);
  await sql`alter table media_folders add constraint media_folders_parent_id_fkey
    foreign key (parent_id, site_id) references media_folders(id, site_id) on delete restrict`.execute(db);
  await sql`alter table media_assets drop constraint media_assets_folder_id_fkey`.execute(db);
  await sql`alter table media_assets add constraint media_assets_folder_id_fkey
    foreign key (folder_id, site_id) references media_folders(id, site_id) on delete set null (folder_id)`.execute(
    db,
  );
  await sql`drop index media_assets_created_idx`.execute(db);
  await sql`create index media_assets_created_idx on media_assets (site_id, created_at, id) where deleted_at is null`.execute(
    db,
  );
};

const rekeyAppUsersAndUsage = async (db: Kysely<unknown>) => {
  await sql`drop index app_users_email_uq`.execute(db);
  await sql`create unique index app_users_email_uq on app_users (site_id, lower(email)) where deleted_at is null`.execute(
    db,
  );
  await sql`drop index app_users_created_idx`.execute(db);
  await sql`create index app_users_created_idx on app_users (site_id, created_at desc, id desc)
    where deleted_at is null`.execute(db);
  await sql`alter table app_oauth_accounts drop constraint app_oauth_accounts_identity_uq`.execute(db);
  await sql`alter table app_oauth_accounts add constraint app_oauth_accounts_identity_uq
    unique (site_id, provider, provider_user_id)`.execute(db);

  await sql`alter table field_reads drop constraint field_reads_pkey`.execute(db);
  await sql`alter table field_reads add constraint field_reads_pkey
    primary key (day, site_id, model_id, field_path, principal_key, selection)`.execute(db);
  await sql`alter table token_reads drop constraint token_reads_pkey`.execute(db);
  await sql`alter table token_reads add constraint token_reads_pkey primary key (day, site_id, principal_key)`.execute(
    db,
  );
};

/** A role is assigned on one site or on every site (null). */
const siteRoleAssignments = async (db: Kysely<unknown>) => {
  await sql`alter table admin_user_roles drop constraint admin_user_roles_pk`.execute(db);
  await sql`alter table admin_user_roles add column id uuid not null default gen_random_uuid()`.execute(db);
  await sql`alter table admin_user_roles add constraint admin_user_roles_pk primary key (id)`.execute(db);
  await sql`alter table admin_user_roles add constraint admin_user_roles_assignment_uq
    unique nulls not distinct (admin_user_id, role_id, site_id)`.execute(db);

  await sql`alter table admin_invitations
    add column role_assignments jsonb not null default '[]'::jsonb`.execute(db);
  await sql`
    update admin_invitations set role_assignments = coalesce(
      (select jsonb_agg(jsonb_build_object('roleId', r, 'siteId', null)) from unnest(role_ids) as r), '[]'::jsonb)
  `.execute(db);
  await sql`alter table admin_invitations drop column role_ids`.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await createSites(db);
  await addSiteColumns(db);
  await tieCopiesToEntries(db);
  await rekeyContent(db);
  await rekeyMedia(db);
  await rekeyAppUsersAndUsage(db);
  await siteRoleAssignments(db);
};

const assertSingleSite = async (db: Kysely<unknown>) => {
  const { rows } = await sql<{ count: string }>`select count(*)::text as count from sites`.execute(db);
  if (Number(rows[0]?.count ?? 0) > 1) {
    throw new Error(
      'Cannot roll back sites while more than one site exists: merging them would merge their snapshot ' +
        'ledgers and uniqueness and widen role assignments. Delete the other sites first.',
    );
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await assertSingleSite(db);

  await sql`alter table admin_invitations add column role_ids uuid[] not null default '{}'::uuid[]`.execute(
    db,
  );
  await sql`
    update admin_invitations set role_ids = coalesce(
      (select array_agg(distinct (a->>'roleId')::uuid) from jsonb_array_elements(role_assignments) as a), '{}'::uuid[])
  `.execute(db);
  await sql`alter table admin_invitations drop column role_assignments`.execute(db);
  // With one site, "this site" and "every site" are the same assignment.
  await sql`
    delete from admin_user_roles a using admin_user_roles b
    where a.admin_user_id = b.admin_user_id and a.role_id = b.role_id and a.id > b.id
  `.execute(db);
  await sql`alter table admin_user_roles drop constraint admin_user_roles_assignment_uq`.execute(db);
  await sql`alter table admin_user_roles drop constraint admin_user_roles_pk`.execute(db);
  await sql`alter table admin_user_roles drop column id`.execute(db);
  await sql`alter table admin_user_roles add constraint admin_user_roles_pk primary key (admin_user_id, role_id)`.execute(
    db,
  );

  await sql`alter table token_reads drop constraint token_reads_pkey`.execute(db);
  await sql`alter table token_reads add constraint token_reads_pkey primary key (day, principal_key)`.execute(
    db,
  );
  await sql`alter table field_reads drop constraint field_reads_pkey`.execute(db);
  await sql`alter table field_reads add constraint field_reads_pkey
    primary key (day, model_id, field_path, principal_key, selection)`.execute(db);
  await sql`alter table app_oauth_accounts drop constraint app_oauth_accounts_identity_uq`.execute(db);
  await sql`alter table app_oauth_accounts add constraint app_oauth_accounts_identity_uq
    unique (provider, provider_user_id)`.execute(db);
  await sql`drop index app_users_created_idx`.execute(db);
  await sql`create index app_users_created_idx on app_users (created_at desc, id desc) where deleted_at is null`.execute(
    db,
  );
  await sql`drop index app_users_email_uq`.execute(db);
  await sql`create unique index app_users_email_uq on app_users (lower(email)) where deleted_at is null`.execute(
    db,
  );

  await sql`drop index media_assets_created_idx`.execute(db);
  await sql`create index media_assets_created_idx on media_assets (created_at, id) where deleted_at is null`.execute(
    db,
  );
  await sql`alter table media_assets drop constraint media_assets_folder_id_fkey`.execute(db);
  await sql`alter table media_assets add constraint media_assets_folder_id_fkey
    foreign key (folder_id) references media_folders(id) on delete set null`.execute(db);
  await sql`alter table media_folders drop constraint media_folders_parent_id_fkey`.execute(db);
  await sql`alter table media_folders add constraint media_folders_parent_id_fkey
    foreign key (parent_id) references media_folders(id) on delete restrict`.execute(db);
  await sql`drop index media_folders_sibling_name_uq`.execute(db);
  await sql`create unique index media_folders_sibling_name_uq on media_folders
    (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))`.execute(db);
  await sql`alter table media_folders drop constraint media_folders_id_site_uq`.execute(db);

  await sql`drop index change_sets_status_idx`.execute(db);
  await sql`create index change_sets_status_idx on change_sets (status, created_at desc)`.execute(db);
  await sql`drop index content_health_findings_open_idx`.execute(db);
  await sql`create index content_health_findings_open_idx on content_health_findings (rule, last_seen_at desc, id)
    where resolved_at is null`.execute(db);
  await sql`drop index scheduled_publications_site_idx`.execute(db);
  await sql`drop index publication_log_model_seq_idx`.execute(db);
  await sql`create index publication_log_model_seq_idx on publication_log (model_id, from_seq)`.execute(db);
  await sql`drop index publication_log_to_seq_idx`.execute(db);
  await sql`create index publication_log_to_seq_idx on publication_log (to_seq) where to_seq is not null`.execute(
    db,
  );
  await sql`alter table publication_snapshots drop constraint publication_snapshots_pkey`.execute(db);
  await sql`alter table publication_snapshots add constraint publication_snapshots_pkey primary key (seq)`.execute(
    db,
  );
  await sql`alter table publication_state drop constraint publication_state_pkey`.execute(db);
  await sql`alter table publication_state add column id boolean not null default true check (id)`.execute(db);
  await sql`alter table publication_state add constraint publication_state_pkey primary key (id)`.execute(db);
  await sql`alter table unique_values drop constraint unique_values_pkey`.execute(db);
  await sql`alter table unique_values add constraint unique_values_pkey
    primary key (field_id, locale, state, value_hash)`.execute(db);
  await sql`drop index entry_heads_model_locale_state_idx`.execute(db);
  await sql`create index entry_heads_model_locale_state_idx on entry_heads (model_id, locale, state)`.execute(
    db,
  );
  await sql`drop index entries_model_idx`.execute(db);
  await sql`create index entries_model_idx on entries (model_id, created_at) where deleted_at is null`.execute(
    db,
  );

  for (const [table] of ENTRY_SITE_COPIES) {
    await sql`alter table ${sql.table(table)} drop constraint ${sql.id(`${table}_entry_site_fk`)}`.execute(
      db,
    );
  }
  await sql`alter table entries drop constraint entries_id_site_uq`.execute(db);
  for (const [table] of [...REQUIRED_SITE_TABLES, ...OPTIONAL_SITE_TABLES]) {
    await sql`alter table ${sql.table(table)} drop column site_id`.execute(db);
  }
  await sql`drop table site_app_roles`.execute(db);
  await sql`drop table sites`.execute(db);
};
