import { sql, type Kysely } from 'kysely';

/**
 * Editor experience (plan editor-experience §9):
 *
 * - `editor_presence`: who has an entry open, one row per browser tab, refreshed by a heartbeat and read
 *   with a TTL. UNLOGGED: it is advisory and rebuilt within one heartbeat, so it skips the WAL and is
 *   simply emptied after a crash. Correct across any number of server processes without NOTIFY.
 * - `content_health_findings`: open and recently resolved findings of the health rules per entry and
 *   locale (`*` for the entry as a whole). An evaluation upserts what it found and resolves the rest.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create unlogged table editor_presence (
      entry_id uuid not null,
      model_id uuid not null,
      admin_user_id uuid not null,
      tab_id text not null check (length(tab_id) between 1 and 64),
      locale text,
      started_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      primary key (entry_id, admin_user_id, tab_id)
    )
  `.execute(db);
  await sql`create index editor_presence_model_idx on editor_presence (model_id, last_seen_at)`.execute(db);
  await sql`create index editor_presence_seen_idx on editor_presence (last_seen_at)`.execute(db);

  await sql`
    create table content_health_findings (
      id uuid primary key default gen_random_uuid(),
      entry_id uuid not null references entries(id) on delete cascade,
      model_id uuid not null,
      locale text not null,
      rule text not null,
      subject text not null default '',
      severity text not null check (severity in ('error', 'warning')),
      path text,
      details jsonb not null default '{}'::jsonb,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      resolved_at timestamptz,
      unique (entry_id, locale, rule, subject)
    )
  `.execute(db);
  await sql`create index content_health_findings_open_idx on content_health_findings (rule, last_seen_at desc, id)
    where resolved_at is null`.execute(db);
  await sql`create index content_health_findings_resolved_idx on content_health_findings (resolved_at)
    where resolved_at is not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table content_health_findings`.execute(db);
  await sql`drop table editor_presence`.execute(db);
};
