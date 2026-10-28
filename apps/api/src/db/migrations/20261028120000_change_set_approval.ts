import { sql, type Kysely } from 'kysely';

/**
 * Approval workflows on change sets (plans approval and approval-workflows, ADR 0014). A site's change sets
 * go through an ordered list of stages, each saying which roles may sign off and how many sign-offs it
 * needs; the instance holds a default every site inherits unless it switches approval off or defines its own.
 *
 * - `change_sets` gains the approval state: its status, the last note, who asked and when, the workflow
 *   frozen when review started, the round and the stage it is at, the fingerprint the round's sign-offs
 *   (and, once approved, the approval) are pinned to, and whether the approval was still current when the
 *   set shipped. The actor columns have no foreign keys (like `ship_requested_by`), so deleting an admin or
 *   a token keeps the record.
 * - `change_set_approvals` holds one row per sign-off (approve or request changes) with its round, stage
 *   and fingerprint: the record of who signed what.
 * - `sites.approval_mode` (`inherit`, `off`, `custom`) and `sites.approval_workflow` (the custom workflow).
 *   The instance default is a `system_settings` row, written by the app (no row: approval off).
 * - `changes.approve` is a new site action; every role that holds `changes.ship` gets it, so whoever could
 *   ship before can still approve. The permissions version moves only when grants changed.
 *
 * Columns are only added (no table rebuild on any dialect). `down` loses every approval state, sign-off and
 * workflow, removes the grant and the approval events from webhook subscriptions.
 */
export const APPROVAL_STATUSES = ['none', 'requested', 'approved', 'changes_requested'] as const;

export const APPROVAL_MODES = ['inherit', 'off', 'custom'] as const;

export const APPROVAL_DECISIONS = ['approve', 'request_changes'] as const;

/** Webhook events this migration's feature adds (removed from subscriptions by `down`). */
export const APPROVAL_EVENTS = [
  'change_set.approval_requested',
  'change_set.approval_stage_completed',
  'change_set.approved',
  'change_set.changes_requested',
] as const;

/** The `system_settings` key of the instance's default workflow (removed by `down`). */
export const APPROVAL_WORKFLOW_SETTING = 'approval.workflow';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const statuses = sql.join(APPROVAL_STATUSES.map((status) => sql.lit(status)));
  const modes = sql.join(APPROVAL_MODES.map((mode) => sql.lit(mode)));
  const decisions = sql.join(APPROVAL_DECISIONS.map((decision) => sql.lit(decision)));
  await sql`
    alter table change_sets
      add column approval_status text not null default 'none'
        constraint change_sets_approval_status_check check (approval_status in (${statuses})),
      add column approval_note text not null default '',
      add column approval_requested_by uuid,
      add column approval_requested_by_token uuid,
      add column approval_requested_at timestamptz,
      add column approval_workflow jsonb,
      add column approval_round integer not null default 0,
      add column approval_stage integer not null default 0,
      add column approval_fingerprint text,
      add column approved_at_ship boolean
  `.execute(db);
  await sql`
    alter table sites
      add column approval_mode text not null default 'inherit'
        constraint sites_approval_mode_check check (approval_mode in (${modes})),
      add column approval_workflow jsonb
  `.execute(db);
  await sql`
    create table change_set_approvals (
      id uuid not null default gen_random_uuid() constraint change_set_approvals_pkey primary key,
      change_set_id uuid not null,
      site_id uuid not null,
      round integer not null,
      stage_index integer not null,
      stage_id text not null,
      decision text not null constraint change_set_approvals_decision_check check (decision in (${decisions})),
      note text not null default '',
      admin_user_id uuid,
      api_token_id uuid,
      fingerprint text not null,
      created_at timestamptz not null default now(),
      constraint change_set_approvals_set_site_fk foreign key (change_set_id, site_id)
        references change_sets (id, site_id) on delete cascade
    )
  `.execute(db);
  await sql`
    create index change_set_approvals_round_idx on change_set_approvals (change_set_id, round, stage_index)
  `.execute(db);
  await sql`
    with granted as (
      insert into admin_role_permissions (role_id, action, model_id, condition, field_ids)
      select role_id, 'changes.approve', null, null, null
      from admin_role_permissions
      where action = 'changes.ship' and model_id is null
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
      delete from admin_role_permissions where action = 'changes.approve' returning 1
    )
    update system_versions set permissions_version = permissions_version + 1, updated_at = now()
    where exists (select 1 from revoked)
  `.execute(db);
  const events = sql`array[${sql.join(APPROVAL_EVENTS.map((event) => sql.lit(event)))}]::text[]`;
  await sql`
    update webhooks set events = array(select e from unnest(events) as e where e <> all(${events}))
    where events && ${events}
  `.execute(db);
  await sql`delete from system_settings where key = ${APPROVAL_WORKFLOW_SETTING}`.execute(db);
  await sql`drop table change_set_approvals`.execute(db);
  await sql`alter table sites drop column approval_mode, drop column approval_workflow`.execute(db);
  await sql`
    alter table change_sets
      drop column approval_status,
      drop column approval_note,
      drop column approval_requested_by,
      drop column approval_requested_by_token,
      drop column approval_requested_at,
      drop column approval_workflow,
      drop column approval_round,
      drop column approval_stage,
      drop column approval_fingerprint,
      drop column approved_at_ship
  `.execute(db);
};
