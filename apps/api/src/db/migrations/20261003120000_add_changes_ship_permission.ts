import { sql, type Kysely } from 'kysely';

/**
 * `changes.ship` (agentic plan §I): shipping a change set (and scheduling a ship) becomes its own global
 * action, split from `changes.manage`, so a role can prepare change sets without being able to make them
 * live. Every role that holds `changes.manage` today keeps what it could do: it gets `changes.ship` too.
 * The permissions version moves only when grants changed, so running instances reload exactly then.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    with granted as (
      insert into admin_role_permissions (role_id, action, model_id, condition, field_ids)
      select role_id, 'changes.ship', null, null, null
      from admin_role_permissions
      where action = 'changes.manage' and model_id is null
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
      delete from admin_role_permissions where action = 'changes.ship' returning 1
    )
    update system_versions set permissions_version = permissions_version + 1, updated_at = now()
    where exists (select 1 from revoked)
  `.execute(db);
};
