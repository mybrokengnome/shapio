import { sql, type Kysely } from 'kysely';
import {
  APPROVAL_DECISIONS,
  APPROVAL_EVENTS,
  APPROVAL_MODES,
  APPROVAL_STATUSES,
  APPROVAL_WORKFLOW_SETTING,
} from '../20261028120000_change_set_approval.js';

/**
 * MySQL twin of `../20261028120000_change_set_approval.ts`. MySQL drops a check constraint with `drop check`
 * before its column can go; `insert ignore` stands in for `on conflict do nothing` (the grant's unique key).
 * Webhook events are a JSON array.
 */
const UUID = sql.raw('char(36) character set ascii collate ascii_general_ci');

const bumpPermissionsVersion = (db: Kysely<unknown>) =>
  sql`update \`system_versions\` set \`permissions_version\` = \`permissions_version\` + 1,
    \`updated_at\` = current_timestamp(6)`.execute(db);

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const statuses = sql.join(APPROVAL_STATUSES.map((status) => sql.lit(status)));
  const modes = sql.join(APPROVAL_MODES.map((mode) => sql.lit(mode)));
  const decisions = sql.join(APPROVAL_DECISIONS.map((decision) => sql.lit(decision)));
  await sql`
    alter table \`change_sets\`
      add column \`approval_status\` varchar(64) not null default 'none',
      add column \`approval_note\` longtext not null default (''),
      add column \`approval_requested_by\` ${UUID},
      add column \`approval_requested_by_token\` ${UUID},
      add column \`approval_requested_at\` datetime(6),
      add column \`approval_workflow\` json,
      add column \`approval_round\` int not null default 0,
      add column \`approval_stage\` int not null default 0,
      add column \`approval_fingerprint\` longtext,
      add column \`approved_at_ship\` tinyint(1),
      add constraint \`change_sets_approval_status_check\` check ((\`approval_status\` in (${statuses})))
  `.execute(db);
  await sql`
    alter table \`sites\`
      add column \`approval_mode\` varchar(64) not null default 'inherit',
      add column \`approval_workflow\` json,
      add constraint \`sites_approval_mode_check\` check ((\`approval_mode\` in (${modes})))
  `.execute(db);
  await sql`
    create table \`change_set_approvals\` (
      \`id\` ${UUID} not null default (uuid()),
      \`change_set_id\` ${UUID} not null,
      \`site_id\` ${UUID} not null,
      \`round\` int not null,
      \`stage_index\` int not null,
      \`stage_id\` longtext not null,
      \`decision\` varchar(64) not null,
      \`note\` longtext not null default (''),
      \`admin_user_id\` ${UUID},
      \`api_token_id\` ${UUID},
      \`fingerprint\` longtext not null,
      \`created_at\` datetime(6) not null default current_timestamp(6),
      constraint \`change_set_approvals_pkey\` primary key (\`id\`),
      constraint \`change_set_approvals_decision_check\` check ((\`decision\` in (${decisions}))),
      constraint \`change_set_approvals_set_site_fk\` foreign key (\`change_set_id\`, \`site_id\`)
        references \`change_sets\` (\`id\`, \`site_id\`) on delete cascade
    )
  `.execute(db);
  await sql`
    create index \`change_set_approvals_round_idx\`
      on \`change_set_approvals\` (\`change_set_id\`, \`round\`, \`stage_index\`)
  `.execute(db);
  const granted = await sql`
    insert ignore into \`admin_role_permissions\` (\`id\`, \`role_id\`, \`action\`, \`model_id\`, \`condition\`, \`field_ids\`)
    select uuid(), \`role_id\`, 'changes.approve', null, null, null
    from \`admin_role_permissions\`
    where \`action\` = 'changes.ship' and \`model_id\` is null
  `.execute(db);
  if (Number(granted.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  const revoked =
    await sql`delete from \`admin_role_permissions\` where \`action\` = 'changes.approve'`.execute(db);
  if (Number(revoked.numAffectedRows ?? 0) > 0) {
    await bumpPermissionsVersion(db);
  }
  const events = sql.join(APPROVAL_EVENTS.map((event) => sql.lit(event)));
  await sql`
    update \`webhooks\` set \`events\` = (
      select coalesce(json_arrayagg(j.e), json_array())
      from json_table(\`webhooks\`.\`events\`, '$[*]' columns (e varchar(255) path '$')) as j
      where j.e not in (${events})
    )
    where json_overlaps(\`events\`, json_array(${events}))
  `.execute(db);
  await sql`delete from \`system_settings\` where \`key\` = ${APPROVAL_WORKFLOW_SETTING}`.execute(db);
  await sql`drop table \`change_set_approvals\``.execute(db);
  await sql`alter table \`sites\` drop check \`sites_approval_mode_check\``.execute(db);
  await sql`alter table \`sites\` drop column \`approval_mode\`, drop column \`approval_workflow\``.execute(
    db,
  );
  await sql`alter table \`change_sets\` drop check \`change_sets_approval_status_check\``.execute(db);
  await sql`
    alter table \`change_sets\`
      drop column \`approval_status\`,
      drop column \`approval_note\`,
      drop column \`approval_requested_by\`,
      drop column \`approval_requested_by_token\`,
      drop column \`approval_requested_at\`,
      drop column \`approval_workflow\`,
      drop column \`approval_round\`,
      drop column \`approval_stage\`,
      drop column \`approval_fingerprint\`,
      drop column \`approved_at_ship\`
  `.execute(db);
};
