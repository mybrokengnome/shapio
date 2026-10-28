import { sql, type Kysely } from 'kysely';
import { APPROVAL_EVENTS, APPROVAL_STATUSES } from '../20261028120000_change_set_approval.js';

/**
 * SQLite twin of `../20261028120000_change_set_approval.ts`. SQLite adds and drops one column per statement;
 * the status check is a column constraint, so dropping the column drops it too. `insert or ignore` stands in
 * for `on conflict do nothing` (the grant's unique index). Webhook events are a JSON array.
 */
const CHANGE_SET_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['approval_note', `text not null default ('')`],
  ['approval_requested_by', 'text_uuid'],
  ['approval_requested_by_token', 'text_uuid'],
  ['approval_requested_at', 'text_timestamptz'],
  ['approved_by', 'text_uuid'],
  ['approved_by_token', 'text_uuid'],
  ['approved_at', 'text_timestamptz'],
  ['approved_fingerprint', 'text'],
  ['approved_at_ship', 'integer_boolean'],
];

const bumpPermissionsVersion = (db: Kysely<unknown>) =>
  sql`update "system_versions" set permissions_version = permissions_version + 1, updated_at = shapio_now()`.execute(
    db,
  );

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const statuses = sql.join(APPROVAL_STATUSES.map((status) => sql.lit(status)));
  await sql`alter table "change_sets" add column "approval_status" text not null default ('none')
    constraint "change_sets_approval_status_check" check (approval_status in (${statuses}))`.execute(db);
  for (const [name, type] of CHANGE_SET_COLUMNS) {
    await sql`alter table "change_sets" add column ${sql.id(name)} ${sql.raw(type)}`.execute(db);
  }
  await sql`alter table "sites" add column "require_approval" integer_boolean not null default 0`.execute(db);
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
  await sql`alter table "sites" drop column "require_approval"`.execute(db);
  for (const [name] of [...CHANGE_SET_COLUMNS].reverse()) {
    await sql`alter table "change_sets" drop column ${sql.id(name)}`.execute(db);
  }
  await sql`alter table "change_sets" drop column "approval_status"`.execute(db);
};
