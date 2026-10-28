import { sql, type Kysely } from 'kysely';
import { APPROVAL_EVENTS, APPROVAL_STATUSES } from '../20261028120000_change_set_approval.js';

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
  await sql`
    alter table \`change_sets\`
      add column \`approval_status\` varchar(64) not null default 'none',
      add column \`approval_note\` longtext not null default (''),
      add column \`approval_requested_by\` ${UUID},
      add column \`approval_requested_by_token\` ${UUID},
      add column \`approval_requested_at\` datetime(6),
      add column \`approved_by\` ${UUID},
      add column \`approved_by_token\` ${UUID},
      add column \`approved_at\` datetime(6),
      add column \`approved_fingerprint\` longtext,
      add column \`approved_at_ship\` tinyint(1),
      add constraint \`change_sets_approval_status_check\` check ((\`approval_status\` in (${statuses})))
  `.execute(db);
  await sql`alter table \`sites\` add column \`require_approval\` tinyint(1) not null default 0`.execute(db);
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
  await sql`alter table \`sites\` drop column \`require_approval\``.execute(db);
  await sql`alter table \`change_sets\` drop check \`change_sets_approval_status_check\``.execute(db);
  await sql`
    alter table \`change_sets\`
      drop column \`approval_status\`,
      drop column \`approval_note\`,
      drop column \`approval_requested_by\`,
      drop column \`approval_requested_by_token\`,
      drop column \`approval_requested_at\`,
      drop column \`approved_by\`,
      drop column \`approved_by_token\`,
      drop column \`approved_at\`,
      drop column \`approved_fingerprint\`,
      drop column \`approved_at_ship\`
  `.execute(db);
};
