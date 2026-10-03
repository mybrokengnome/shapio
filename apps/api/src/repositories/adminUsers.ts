import {
  sql,
  type Insertable,
  type Kysely,
  type Selectable,
  type Transaction,
  type Updateable,
} from 'kysely';
import { db } from '../db/index.js';
import type { AdminUsers, DB } from '../db/types.js';
import type { RoleAssignment } from '../permissions/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AdminUserRow = Selectable<AdminUsers>;
export type NewAdminUser = Insertable<AdminUsers>;

/** Public columns: everything except the password hash. */
const USER_COLUMNS = [
  'admin_users.id',
  'admin_users.email',
  'admin_users.name',
  'admin_users.status',
  'admin_users.last_login_at',
  'admin_users.created_at',
  'admin_users.updated_at',
] as const;

export type AdminUserSummary = Pick<
  AdminUserRow,
  'id' | 'email' | 'name' | 'status' | 'last_login_at' | 'created_at' | 'updated_at'
> & {
  /** Roles assigned on every site (network roles: what owner checks look at). */
  network_role_ids: string[];
  /** Every assignment, on any site (site null = every site). */
  assignments: RoleAssignment[];
};

const withRoleIds = (trx: Executor) =>
  trx
    .selectFrom('admin_users')
    .select(USER_COLUMNS)
    .select((eb) =>
      eb.fn
        .coalesce(
          eb
            .selectFrom('admin_user_roles')
            .select(sql<string[]>`array_agg(role_id order by role_id)`.as('ids'))
            .whereRef('admin_user_roles.admin_user_id', '=', 'admin_users.id')
            .where('admin_user_roles.site_id', 'is', null),
          sql<string[]>`'{}'::uuid[]`,
        )
        .as('network_role_ids'),
    )
    .select((eb) =>
      eb.fn
        .coalesce(
          eb
            .selectFrom('admin_user_roles')
            .select(
              sql<RoleAssignment[]>`jsonb_agg(jsonb_build_object('roleId', role_id, 'siteId', site_id)
                order by role_id, site_id nulls first)`.as('assignments'),
            )
            .whereRef('admin_user_roles.admin_user_id', '=', 'admin_users.id'),
          sql<RoleAssignment[]>`'[]'::jsonb`,
        )
        .as('assignments'),
    );

export const countAll = async (trx: Executor = db): Promise<number> => {
  const row = await trx
    .selectFrom('admin_users')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .executeTakeFirstOrThrow();
  return Number(row.n);
};

export const list = (trx: Executor = db): Promise<AdminUserSummary[]> =>
  withRoleIds(trx).orderBy('admin_users.created_at').execute();

export const findSummaryById = (id: string, trx: Executor = db): Promise<AdminUserSummary | undefined> =>
  withRoleIds(trx).where('admin_users.id', '=', id).executeTakeFirst();

/** Includes the password hash: for credential checks only. */
export const findByEmailWithHash = (email: string, trx: Executor = db) =>
  trx.selectFrom('admin_users').selectAll().where('email', '=', email).executeTakeFirst();

export const findByIdWithHash = (id: string, trx: Executor = db) =>
  trx.selectFrom('admin_users').selectAll().where('id', '=', id).executeTakeFirst();

export const existsByEmail = async (email: string, trx: Executor = db): Promise<boolean> =>
  (await trx.selectFrom('admin_users').select('id').where('email', '=', email).executeTakeFirst()) !==
  undefined;

export const insert = (user: NewAdminUser, trx: Executor = db) =>
  trx.insertInto('admin_users').values(user).returning('id').executeTakeFirstOrThrow();

export const update = (id: string, changes: Updateable<AdminUsers>, trx: Executor = db) =>
  trx
    .updateTable('admin_users')
    .set({ ...changes, updated_at: new Date() })
    .where('id', '=', id)
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('admin_users').where('id', '=', id).executeTakeFirst();

/** Replaces every role assignment of the user (on every site and on single sites). */
export const replaceAssignments = async (
  adminUserId: string,
  assignments: readonly RoleAssignment[],
  trx: Executor = db,
) => {
  await trx.deleteFrom('admin_user_roles').where('admin_user_id', '=', adminUserId).execute();
  if (assignments.length > 0) {
    await trx
      .insertInto('admin_user_roles')
      .values(
        assignments.map(({ roleId, siteId }) => ({
          admin_user_id: adminUserId,
          role_id: roleId,
          site_id: siteId,
        })),
      )
      .execute();
  }
};

/** Active users holding the role with this key, locked so "last owner" checks cannot race. */
export const lockActiveHoldersOfRoleKey = (roleKey: string, trx: Transaction<DB>) =>
  trx
    .selectFrom('admin_users')
    .innerJoin('admin_user_roles', 'admin_user_roles.admin_user_id', 'admin_users.id')
    .innerJoin('admin_roles', 'admin_roles.id', 'admin_user_roles.role_id')
    .select('admin_users.id')
    .where('admin_roles.key', '=', roleKey)
    // Owner (like every network role) counts only where it is assigned on every site.
    .where('admin_user_roles.site_id', 'is', null)
    .where('admin_users.status', '=', 'active')
    .forUpdate('admin_users')
    .execute();

/** Names of admin users by ID (authors in content lists). */
export const findNamesByIds = (ids: readonly string[], executor: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : executor.selectFrom('admin_users').select(['id', 'name']).where('id', 'in', ids).execute();
