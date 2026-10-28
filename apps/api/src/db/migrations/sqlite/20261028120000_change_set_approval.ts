import { sql, type Kysely } from 'kysely';
import {
  APPROVAL_DECISIONS,
  APPROVAL_EVENTS,
  APPROVAL_MODES,
  APPROVAL_STATUSES,
  APPROVAL_WORKFLOW_SETTING,
} from '../20261028120000_change_set_approval.js';

/**
 * SQLite twin of `../20261028120000_change_set_approval.ts`. SQLite adds and drops one column per statement;
 * the check constraints are column constraints, so dropping the column drops them too. `insert or ignore`
 * stands in for `on conflict do nothing` (the grant's unique index). Webhook events are a JSON array.
 */
const CHANGE_SET_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['approval_note', `text not null default ('')`],
  ['approval_requested_by', 'text_uuid'],
  ['approval_requested_by_token', 'text_uuid'],
  ['approval_requested_at', 'text_timestamptz'],
  ['approval_workflow', 'text_jsonb'],
  ['approval_round', 'integer not null default 0'],
  ['approval_stage', 'integer not null default 0'],
  ['approval_fingerprint', 'text'],
  ['approved_at_ship', 'integer_boolean'],
];

const bumpPermissionsVersion = (db: Kysely<unknown>) =>
  sql`update "system_versions" set permissions_version = permissions_version + 1, updated_at = shapio_now()`.execute(
    db,
  );

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const statuses = sql.join(APPROVAL_STATUSES.map((status) => sql.lit(status)));
  const modes = sql.join(APPROVAL_MODES.map((mode) => sql.lit(mode)));
  const decisions = sql.join(APPROVAL_DECISIONS.map((decision) => sql.lit(decision)));
  await sql`alter table "change_sets" add column "approval_status" text not null default ('none')
    constraint "change_sets_approval_status_check" check (approval_status in (${statuses}))`.execute(db);
  for (const [name, type] of CHANGE_SET_COLUMNS) {
    await sql`alter table "change_sets" add column ${sql.id(name)} ${sql.raw(type)}`.execute(db);
  }
  await sql`alter table "sites" add column "approval_mode" text not null default ('inherit')
    constraint "sites_approval_mode_check" check (approval_mode in (${modes}))`.execute(db);
  await sql`alter table "sites" add column "approval_workflow" text_jsonb`.execute(db);
  await sql`create table "change_set_approvals" (
    "id" text_uuid not null default (gen_random_uuid()),
    "change_set_id" text_uuid not null,
    "site_id" text_uuid not null,
    "round" integer not null,
    "stage_index" integer not null,
    "stage_id" text not null,
    "decision" text not null,
    "note" text not null default (''),
    "admin_user_id" text_uuid,
    "api_token_id" text_uuid,
    "fingerprint" text not null,
    "created_at" text_timestamptz not null default (shapio_now()),
    constraint "change_set_approvals_decision_check" check (decision in (${decisions})),
    constraint "change_set_approvals_set_site_fk" foreign key (change_set_id, site_id)
      references change_sets (id, site_id) on delete cascade,
    constraint "change_set_approvals_pkey" primary key (id)
  )`.execute(db);
  await sql`create index "change_set_approvals_round_idx"
    on "change_set_approvals" ("change_set_id", "round", "stage_index")`.execute(db);
  const granted = await sql`
    insert or ignore into "admin_role_permissions" (role_id, action, model_id, condition, field_ids)
    select role_id, 'changes.approve', null, null, null
    from "admin_role_permissions"
    where action = 'changes.ship' and model_id is null
  `.execute(db);
  if (Number(granted.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const revoked = await sql`delete from "admin_role_permissions" where action = 'changes.approve'`.execute(
    db,
  );
  if (Number(revoked.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
  const events = sql.join(APPROVAL_EVENTS.map((event) => sql.lit(event)));
  await sql`
    update "webhooks" set events = (
      select json_group_array(value) from json_each("webhooks".events) where value not in (${events})
    )
    where exists (select 1 from json_each("webhooks".events) where value in (${events}))
  `.execute(db);
  await sql`delete from "system_settings" where key = ${APPROVAL_WORKFLOW_SETTING}`.execute(db);
  await sql`drop table "change_set_approvals"`.execute(db);
  await sql`alter table "sites" drop column "approval_workflow"`.execute(db);
  await sql`alter table "sites" drop column "approval_mode"`.execute(db);
  for (const [name] of [...CHANGE_SET_COLUMNS].reverse()) {
    await sql`alter table "change_sets" drop column ${sql.id(name)}`.execute(db);
  }
  await sql`alter table "change_sets" drop column "approval_status"`.execute(db);
};
