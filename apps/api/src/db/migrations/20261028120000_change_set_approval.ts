import { sql, type Kysely } from 'kysely';

/**
 * Approval on change sets (plan approval, ADR 0014). A set can be sent for approval, approved, or sent back
 * with a note; a site can require an approved set before anything ships or is scheduled.
 *
 * - `change_sets` gains the approval state: its status, the last note, who asked and when, who decided
 *   (approved or requested changes) and when, the fingerprint of what was approved, and whether the
 *   approval was still current when the set shipped. The actor columns have no foreign keys (like
 *   `ship_requested_by`), so deleting an admin or a token keeps the record.
 * - `sites.require_approval` turns the gate on for a site.
 * - `changes.approve` is a new site action; every role that holds `changes.ship` gets it, so whoever could
 *   ship before can still approve. The permissions version moves only when grants changed.
 *
 * Columns are only added (no table rebuild on any dialect). `down` loses every approval state and the
 * site setting, removes the grant and the approval events from webhook subscriptions.
 */
export const APPROVAL_STATUSES = ['none', 'requested', 'approved', 'changes_requested'] as const;

/** Webhook events this migration's feature adds (removed from subscriptions by `down`). */
export const APPROVAL_EVENTS = [
  'change_set.approval_requested',
  'change_set.approved',
  'change_set.changes_requested',
] as const;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const statuses = sql.join(APPROVAL_STATUSES.map((status) => sql.lit(status)));
  await sql`
    alter table change_sets
      add column approval_status text not null default 'none'
        constraint change_sets_approval_status_check check (approval_status in (${statuses})),
      add column approval_note text not null default '',
      add column approval_requested_by uuid,
      add column approval_requested_by_token uuid,
      add column approval_requested_at timestamptz,
      add column approved_by uuid,
      add column approved_by_token uuid,
      add column approved_at timestamptz,
      add column approved_fingerprint text,
      add column approved_at_ship boolean
  `.execute(db);
  await sql`alter table sites add column require_approval boolean not null default false`.execute(db);
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
  await sql`alter table sites drop column require_approval`.execute(db);
  await sql`
    alter table change_sets
      drop column approval_status,
      drop column approval_note,
      drop column approval_requested_by,
      drop column approval_requested_by_token,
      drop column approval_requested_at,
      drop column approved_by,
      drop column approved_by_token,
      drop column approved_at,
      drop column approved_fingerprint,
      drop column approved_at_ship
  `.execute(db);
};
