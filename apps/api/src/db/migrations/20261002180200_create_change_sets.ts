import { sql, type Kysely } from 'kysely';

/**
 * Change sets (developer-face plan §5, ADR 0010): schema drafts and entry publications that ship as ONE
 * publication snapshot. Replaces releases (a clean rename: rows, permission strings, webhook event patterns,
 * deployment trigger policy and pending jobs move over; nothing keeps the old names).
 *
 * - `change_sets` / `change_set_items`: the set and its items (entry publications or schema drafts).
 * - `schema_drafts`: mutable proposed definitions; real (immutable) schema revisions are written at ship.
 * - `publication_snapshots`: one ledger row per publication sequence number (who, why, schema version),
 *   backfilled for existing numbers as `legacy`.
 * - `schema_change_jobs.change_set_id` and `deployment_runs.change_set_id` link execution records to a set.
 */

const RELEASE_EVENT_RENAMES: ReadonlyArray<[string, string]> = [
  ['release.*', 'change_set.*'],
  ['release.scheduled', 'change_set.scheduled'],
  ['release.published', 'change_set.shipped'],
  ['release.failed', 'change_set.failed'],
];

const createTables = async (db: Kysely<unknown>) => {
  await sql`
    create table change_sets (
      id uuid primary key default gen_random_uuid(),
      title text not null check (length(title) between 1 and 200),
      description text not null default '',
      status text not null default 'open'
        check (status in ('open', 'scheduled', 'shipping', 'shipped', 'failed', 'discarded')),
      ship_phase text check (ship_phase in ('preparing', 'activating')),
      source text not null default 'manual' check (source in ('manual', 'release', 'restore', 'builder')),
      restore_of_seq bigint,
      scheduled_for timestamptz,
      schedule_job_id uuid,
      scheduled_by uuid references admin_users(id) on delete set null,
      scheduled_by_token uuid references api_tokens(id) on delete set null,
      ship_job_id uuid,
      ship_mode text check (ship_mode in ('interactive', 'scheduled')),
      ship_requested_by uuid references admin_users(id) on delete set null,
      ship_requested_by_token uuid references api_tokens(id) on delete set null,
      acknowledge_breaking boolean not null default false,
      acknowledge_destructive boolean not null default false,
      deployment_connection_id uuid references deployment_connections(id) on delete set null,
      deployment_run_id uuid references deployment_runs(id) on delete set null,
      shipped_at timestamptz,
      shipped_seq bigint,
      schema_version_after integer,
      error jsonb,
      restore_report jsonb not null default '[]'::jsonb,
      created_by uuid references admin_users(id) on delete set null,
      created_by_token uuid references api_tokens(id) on delete set null,
      version integer not null default 1,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index change_sets_status_idx on change_sets (status, created_at desc)`.execute(db);

  await sql`
    create table schema_drafts (
      id uuid primary key default gen_random_uuid(),
      change_set_id uuid not null references change_sets(id) on delete cascade,
      definition_id uuid not null,
      kind text not null check (kind in ('collection', 'singleton', 'component')),
      api_key text not null,
      base_version integer,
      definition jsonb,
      version integer not null default 1,
      updated_by_type text not null,
      updated_by_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint schema_drafts_set_definition_uq unique (change_set_id, definition_id)
    )
  `.execute(db);
  await sql`create index schema_drafts_definition_idx on schema_drafts (definition_id)`.execute(db);

  await sql`
    create table change_set_items (
      id uuid primary key default gen_random_uuid(),
      change_set_id uuid not null references change_sets(id) on delete cascade,
      kind text not null check (kind in ('entry', 'schema')),
      position integer not null,
      entry_id uuid references entries(id) on delete cascade,
      model_id uuid,
      locale text,
      action text check (action in ('publish', 'unpublish')),
      source_revision_id uuid references content_revisions(id),
      schema_draft_id uuid references schema_drafts(id) on delete cascade,
      status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
      error text,
      ship_state jsonb,
      created_at timestamptz not null default now(),
      constraint change_set_items_shape_check check (
        (kind = 'entry' and entry_id is not null and model_id is not null and locale is not null
          and action is not null and schema_draft_id is null)
        or (kind = 'schema' and schema_draft_id is not null and entry_id is null and source_revision_id is null)
      )
    )
  `.execute(db);
  await sql`
    create unique index change_set_items_entry_uq on change_set_items (change_set_id, entry_id, locale)
    where kind = 'entry'
  `.execute(db);
  await sql`create unique index change_set_items_draft_uq on change_set_items (schema_draft_id)`.execute(db);
  await sql`create index change_set_items_set_idx on change_set_items (change_set_id, position)`.execute(db);
  await sql`create index change_set_items_entry_idx on change_set_items (entry_id) where entry_id is not null`.execute(
    db,
  );

  await sql`
    create table publication_snapshots (
      seq bigint primary key,
      schema_version integer,
      source text not null,
      change_set_id uuid references change_sets(id) on delete set null,
      actor_type text,
      actor_id text,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index publication_snapshots_change_set_idx on publication_snapshots (change_set_id)
    where change_set_id is not null`.execute(db);
};

const linkExecutionRecords = async (db: Kysely<unknown>) => {
  await sql`alter table schema_change_jobs
    add column change_set_id uuid references change_sets(id) on delete set null`.execute(db);
  await sql`create index schema_change_jobs_change_set_idx on schema_change_jobs (change_set_id)
    where change_set_id is not null`.execute(db);
  await sql`alter table deployment_runs
    add column change_set_id uuid references change_sets(id) on delete set null`.execute(db);
  await sql`alter table deployment_runs drop constraint deployment_runs_trigger_check`.execute(db);
  await sql`update deployment_runs set trigger = 'change_set' where trigger = 'release'`.execute(db);
  await sql`alter table deployment_runs add constraint deployment_runs_trigger_check
    check (trigger in ('publish', 'change_set', 'schema', 'manual', 'retry'))`.execute(db);
  await sql`update deployment_connections
    set trigger_policy = array_replace(trigger_policy, 'release', 'change_set')`.execute(db);
};

/** Revisions written by activation-time value conversions (published heads roll to them in the log). */
const allowConversionRevisions = async (db: Kysely<unknown>) => {
  await sql`alter table content_revisions drop constraint content_revisions_reason_check`.execute(db);
  await sql`alter table content_revisions add constraint content_revisions_reason_check
    check (reason in ('create', 'save', 'publish', 'restore', 'duplicate', 'localize', 'conversion'))`.execute(
    db,
  );
};

const backfillSnapshots = async (db: Kysely<unknown>) => {
  await sql`
    insert into publication_snapshots (seq, schema_version, source, created_at)
    select s, null, 'legacy',
      coalesce((select min(published_at) from publication_log where from_seq = s), now())
    from generate_series(1::bigint, (select last_seq from publication_state)) as s
  `.execute(db);
};

const migrateReleases = async (db: Kysely<unknown>) => {
  await sql`
    insert into change_sets (id, title, description, status, source, scheduled_for, schedule_job_id,
      scheduled_by, scheduled_by_token, shipped_at, shipped_seq, error, created_by, version, created_at,
      updated_at)
    select id, name, description,
      case status when 'draft' then 'open' when 'published' then 'shipped' when 'cancelled' then 'discarded'
        else status end,
      'release', scheduled_at, schedule_job_id, scheduled_by, scheduled_by_token, executed_at, snapshot_seq,
      case when error is null then null
        else jsonb_build_object('code', 'PUBLICATION_FAILED', 'message', error, 'itemId',
          (select ri.id from release_items ri where ri.release_id = releases.id and ri.status = 'failed' limit 1))
      end,
      created_by, version, created_at, updated_at
    from releases
  `.execute(db);
  await sql`
    insert into change_set_items (id, change_set_id, kind, position, entry_id, model_id, locale, action, status,
      error, created_at)
    select id, release_id, 'entry',
      row_number() over (partition by release_id order by created_at, id) - 1,
      entry_id, model_id, locale, action, status, error, created_at
    from release_items
  `.execute(db);
  // A scheduled release's pending job becomes the change set's ship job (same job ID, same schedule).
  await sql`
    update jobs set type = 'changeSet.ship',
      payload = jsonb_build_object('changeSetId', payload->>'releaseId', 'mode', 'scheduled')
    where type = 'publishing.release' and status in ('pending', 'running')
  `.execute(db);
  await sql`update admin_role_permissions set action = 'changes.manage' where action = 'releases.manage'`.execute(
    db,
  );
  for (const [from, to] of RELEASE_EVENT_RENAMES) {
    await sql`update webhooks set events = array_replace(events, ${from}, ${to})`.execute(db);
  }
  await sql`drop table release_items`.execute(db);
  await sql`drop table releases`.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await createTables(db);
  await linkExecutionRecords(db);
  await allowConversionRevisions(db);
  await backfillSnapshots(db);
  await migrateReleases(db);
};

/** Recreates releases from the change sets that hold only entry items; schema drafts and the ledger go. */
const restoreReleases = async (db: Kysely<unknown>) => {
  await sql`
    create table releases (
      id uuid primary key default gen_random_uuid(),
      name text not null check (length(name) between 1 and 200),
      description text not null default '',
      status text not null default 'draft'
        check (status in ('draft', 'scheduled', 'published', 'failed', 'cancelled')),
      scheduled_at timestamptz,
      schedule_job_id uuid,
      scheduled_by uuid references admin_users(id) on delete set null,
      scheduled_by_token uuid references api_tokens(id) on delete set null,
      executed_at timestamptz,
      snapshot_seq bigint,
      error text,
      version integer not null default 1,
      created_by uuid references admin_users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index releases_status_idx on releases (status, created_at)`.execute(db);
  await sql`
    create table release_items (
      id uuid primary key default gen_random_uuid(),
      release_id uuid not null references releases(id) on delete cascade,
      entry_id uuid not null references entries(id) on delete cascade,
      model_id uuid not null,
      locale text not null,
      action text not null check (action in ('publish', 'unpublish')),
      status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
      error text,
      created_at timestamptz not null default now(),
      constraint release_items_entry_locale_uq unique (release_id, entry_id, locale)
    )
  `.execute(db);
  await sql`
    insert into releases (id, name, description, status, scheduled_at, schedule_job_id, scheduled_by,
      scheduled_by_token, executed_at, snapshot_seq, error, version, created_by, created_at, updated_at)
    select id, title, description,
      case status when 'open' then 'draft' when 'shipped' then 'published' when 'discarded' then 'cancelled'
        when 'shipping' then 'draft' else status end,
      scheduled_for, schedule_job_id, scheduled_by, scheduled_by_token, shipped_at, shipped_seq,
      error->>'message', version, created_by, created_at, updated_at
    from change_sets cs
    where not exists (select 1 from change_set_items i where i.change_set_id = cs.id and i.kind = 'schema')
  `.execute(db);
  await sql`
    insert into release_items (id, release_id, entry_id, model_id, locale, action, status, error, created_at)
    select i.id, i.change_set_id, i.entry_id, i.model_id, i.locale, i.action, i.status, i.error, i.created_at
    from change_set_items i join releases r on r.id = i.change_set_id
    where i.kind = 'entry'
  `.execute(db);
  await sql`
    update jobs set type = 'publishing.release', payload = jsonb_build_object('releaseId', payload->>'changeSetId')
    where type = 'changeSet.ship' and status in ('pending', 'running')
      and (payload->>'changeSetId')::uuid in (select id from releases)
  `.execute(db);
  await sql`delete from jobs where type like 'changeSet.%' and status in ('pending', 'running')`.execute(db);
  await sql`update admin_role_permissions set action = 'releases.manage' where action = 'changes.manage'`.execute(
    db,
  );
  for (const [from, to] of RELEASE_EVENT_RENAMES) {
    await sql`update webhooks set events = array_replace(events, ${to}, ${from})`.execute(db);
  }
  // Events without a release equivalent are dropped from subscriptions.
  await sql`update webhooks set events = array_remove(array_remove(events, 'change_set.shipping'),
    'change_set.discarded')`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await restoreReleases(db);
  // Revisions are immutable, so conversion revisions stay; the old check applies to new rows only.
  await sql`alter table content_revisions drop constraint content_revisions_reason_check`.execute(db);
  await sql`alter table content_revisions add constraint content_revisions_reason_check
    check (reason in ('create', 'save', 'publish', 'restore', 'duplicate', 'localize')) not valid`.execute(
    db,
  );
  await sql`update deployment_connections
    set trigger_policy = array_replace(trigger_policy, 'change_set', 'release')`.execute(db);
  await sql`alter table deployment_runs drop constraint deployment_runs_trigger_check`.execute(db);
  await sql`update deployment_runs set trigger = 'release' where trigger = 'change_set'`.execute(db);
  await sql`alter table deployment_runs add constraint deployment_runs_trigger_check
    check (trigger in ('publish', 'release', 'schema', 'manual', 'retry'))`.execute(db);
  await sql`alter table deployment_runs drop column change_set_id`.execute(db);
  await sql`alter table schema_change_jobs drop column change_set_id`.execute(db);
  await sql`drop table publication_snapshots`.execute(db);
  await sql`drop table change_set_items`.execute(db);
  await sql`drop table schema_drafts`.execute(db);
  await sql`drop table change_sets`.execute(db);
};
