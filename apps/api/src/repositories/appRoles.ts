import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import type { AppRolePermissions, AppRoles, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AppRoleRow = Selectable<AppRoles>;
export type NewAppRole = Insertable<AppRoles>;
export type NewAppRolePermission = Insertable<AppRolePermissions>;

const PERMISSION_COLUMNS = ['role_id', 'action', 'model_id', 'condition', 'field_ids'] as const;

/** A grant as stored, without bookkeeping columns (the same shape as admin role grants). */
export type AppPermissionGrantRow = Pick<Selectable<AppRolePermissions>, (typeof PERMISSION_COLUMNS)[number]>;

export const listRoles = (trx: Executor = db) =>
  trx.selectFrom('app_roles').selectAll().orderBy('is_system', 'desc').orderBy('name').execute();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('app_roles').selectAll().where('id', '=', id).executeTakeFirst();

export const findByIds = (ids: readonly string[], trx: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : trx.selectFrom('app_roles').selectAll().where('id', 'in', ids).execute();

export const insert = (role: NewAppRole, trx: Executor = db) =>
  trx.insertInto('app_roles').values(role).returningAll().executeTakeFirstOrThrow();

/** Optimistic update: applies only if the stored version is `expectedVersion`; bumps the version. */
export const updateIfVersion = (
  id: string,
  expectedVersion: number,
  changes: Updateable<AppRoles>,
  trx: Executor = db,
) =>
  trx
    .updateTable('app_roles')
    .set((eb) => ({ ...changes, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('app_roles').where('id', '=', id).executeTakeFirst();

/** Every grant of every app role; the permission cache loads them with the admin grants (small table). */
export const listAllPermissions = (trx: Executor = db) =>
  trx.selectFrom('app_role_permissions').select(PERMISSION_COLUMNS).execute();

export const listPermissionsForRoles = (roleIds: readonly string[], trx: Executor = db) =>
  roleIds.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('app_role_permissions')
        .select(PERMISSION_COLUMNS)
        .where('role_id', 'in', roleIds)
        .orderBy('action')
        .orderBy('model_id')
        .execute();

export const deletePermissionsForRole = (roleId: string, trx: Executor = db) =>
  trx.deleteFrom('app_role_permissions').where('role_id', '=', roleId).execute();

export const insertPermissions = (rows: readonly NewAppRolePermission[], trx: Executor = db) =>
  rows.length === 0
    ? Promise.resolve([])
    : trx
        .insertInto('app_role_permissions')
        .values([...rows])
        .returning('id')
        .execute();

/** How many live app users hold the role (delete protection, list views). */
export const countHolders = async (roleId: string, trx: Executor = db): Promise<number> => {
  const row = await trx
    .selectFrom('app_user_roles')
    .innerJoin('app_users', 'app_users.id', 'app_user_roles.app_user_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('app_user_roles.role_id', '=', roleId)
    .where('app_users.deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
};

/** Live holders per role, for list views (roles nobody holds are absent). */
export const countHoldersByRole = async (trx: Executor = db): Promise<Map<string, number>> => {
  const rows = await trx
    .selectFrom('app_user_roles')
    .innerJoin('app_users', 'app_users.id', 'app_user_roles.app_user_id')
    .select((eb) => ['app_user_roles.role_id', eb.fn.countAll<string>().as('n')])
    .where('app_users.deleted_at', 'is', null)
    .groupBy('app_user_roles.role_id')
    .execute();
  return new Map(rows.map((row) => [row.role_id, Number(row.n)]));
};
