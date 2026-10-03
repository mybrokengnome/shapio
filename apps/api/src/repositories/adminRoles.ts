import type { Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';
import { db } from '../db/index.js';
import type { AdminRolePermissions, AdminRoles, DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type AdminRoleRow = Selectable<AdminRoles>;
export type NewAdminRole = Insertable<AdminRoles>;
export type AdminRolePermissionRow = Selectable<AdminRolePermissions>;
export type NewAdminRolePermission = Insertable<AdminRolePermissions>;

const PERMISSION_COLUMNS = ['role_id', 'action', 'model_id', 'condition', 'field_ids'] as const;

/** A grant as stored, without bookkeeping columns. */
export type PermissionGrantRow = Pick<AdminRolePermissionRow, (typeof PERMISSION_COLUMNS)[number]>;

export const listRoles = (trx: Executor = db) =>
  trx.selectFrom('admin_roles').selectAll().orderBy('is_system', 'desc').orderBy('name').execute();

export const findById = (id: string, trx: Executor = db) =>
  trx.selectFrom('admin_roles').selectAll().where('id', '=', id).executeTakeFirst();

export const findByIds = (ids: readonly string[], trx: Executor = db) =>
  ids.length === 0
    ? Promise.resolve([])
    : trx.selectFrom('admin_roles').selectAll().where('id', 'in', ids).execute();

export const findByKeys = (keys: readonly string[], trx: Executor = db) =>
  keys.length === 0
    ? Promise.resolve([])
    : trx.selectFrom('admin_roles').selectAll().where('key', 'in', keys).execute();

/** Inserts a role unless one with the same key exists; returns the inserted row or undefined. */
export const insertIfAbsent = (role: NewAdminRole, trx: Executor = db) =>
  trx
    .insertInto('admin_roles')
    .values(role)
    .onConflict((oc) => oc.column('key').doNothing())
    .returningAll()
    .executeTakeFirst();

export const insert = (role: NewAdminRole, trx: Executor = db) =>
  trx.insertInto('admin_roles').values(role).returningAll().executeTakeFirstOrThrow();

/** Optimistic update: applies only if the stored version is `expectedVersion`; bumps the version. */
export const updateIfVersion = (
  id: string,
  expectedVersion: number,
  changes: Updateable<AdminRoles>,
  trx: Executor = db,
) =>
  trx
    .updateTable('admin_roles')
    .set((eb) => ({ ...changes, version: eb('version', '+', 1), updated_at: new Date() }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('admin_roles').where('id', '=', id).executeTakeFirst();

/** Every grant of every role; the permission cache loads them all at once (the table is small). */
export const listAllPermissions = (trx: Executor = db) =>
  trx.selectFrom('admin_role_permissions').select(PERMISSION_COLUMNS).execute();

export const listPermissionsForRoles = (roleIds: readonly string[], trx: Executor = db) =>
  roleIds.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('admin_role_permissions')
        .select(PERMISSION_COLUMNS)
        .where('role_id', 'in', roleIds)
        .orderBy('action')
        .orderBy('model_id')
        .execute();

export const insertPermissionsIfAbsent = (rows: readonly NewAdminRolePermission[], trx: Executor = db) =>
  rows.length === 0
    ? Promise.resolve([])
    : trx
        .insertInto('admin_role_permissions')
        .values([...rows])
        .onConflict((oc) => oc.columns(['role_id', 'action', 'model_id']).doNothing())
        .returning('id')
        .execute();

export const deletePermissionsForRole = (roleId: string, trx: Executor = db) =>
  trx.deleteFrom('admin_role_permissions').where('role_id', '=', roleId).execute();

export const insertPermissions = (rows: readonly NewAdminRolePermission[], trx: Executor = db) =>
  rows.length === 0
    ? Promise.resolve([])
    : trx
        .insertInto('admin_role_permissions')
        .values([...rows])
        .returning('id')
        .execute();

/** How many admin users and API tokens hold each role (for delete protection and list views). */
export const countHolders = async (roleId: string, trx: Executor = db) => {
  const row = await trx
    .selectNoFrom((eb) => [
      eb
        .selectFrom('admin_user_roles')
        .select((s) => s.fn.countAll<string>().as('n'))
        .where('role_id', '=', roleId)
        .as('users'),
      eb
        .selectFrom('api_tokens')
        .select((s) => s.fn.countAll<string>().as('n'))
        .where('role_id', '=', roleId)
        .where('revoked_at', 'is', null)
        .as('tokens'),
    ])
    .executeTakeFirstOrThrow();
  return { users: Number(row.users ?? 0), tokens: Number(row.tokens ?? 0) };
};
