import type { Transaction } from 'kysely';
import { db } from '../db/index.js';
import { isUniqueViolation } from '../db/sql/errors.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { APP_CONTENT_ACTIONS, type AppContentAction } from '../permissions/appRoles.js';
import type { FieldVisibilityLookup } from '../permissions/policy.js';
import * as appRolesRepository from '../repositories/appRoles.js';
import type { AppPermissionGrantRow, AppRoleRow } from '../repositories/appRoles.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';
import { assertModelsExist, validatePermissions, type PermissionInput } from './roles.js';

/**
 * App roles (Settings → Roles → App roles): the built-in `public` (anonymous callers) and `authenticated`
 * (every signed-in app user) roles, whose grants are editable, plus custom roles assigned to app users.
 * Grants have the admin-role shape (action × model, `ownedByPrincipal`, field IDs) limited to content
 * actions. Field masks follow delivery semantics: a wildcard grant covers `public` fields only.
 */

/** An app-role grant: the admin-role grant shape with content actions only. */
export type AppPermissionInput = Omit<PermissionInput, 'action'> & { action: AppContentAction };

export type AppRoleView = {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  version: number;
  permissions: AppPermissionInput[];
  /** Live app users holding the role (always 0 for built-in roles, which apply implicitly). */
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
};

const APP_ACTION_SET: ReadonlySet<string> = new Set(APP_CONTENT_ACTIONS);

const toPermissionInput = (row: AppPermissionGrantRow): AppPermissionInput => ({
  action: row.action as AppContentAction,
  modelId: row.model_id,
  condition: row.condition === 'ownedByPrincipal' ? 'ownedByPrincipal' : null,
  fieldIds: row.field_ids,
});

const toView = (
  role: AppRoleRow,
  grants: readonly AppPermissionGrantRow[],
  userCount: number,
): AppRoleView => ({
  id: role.id,
  key: role.key,
  name: role.name,
  description: role.description,
  isSystem: role.is_system,
  version: role.version,
  permissions: grants.filter((grant) => grant.role_id === role.id).map(toPermissionInput),
  userCount,
  createdAt: role.created_at,
  updatedAt: role.updated_at,
});

/** The admin-role rules (known actions, field lists only where meaningful, one grant per action and model) plus content actions only. */
const validateAppPermissions = (permissions: readonly AppPermissionInput[]) => {
  validatePermissions('admin', permissions);
  const index = permissions.findIndex((permission) => !APP_ACTION_SET.has(permission.action));
  if (index !== -1) {
    throw new AppError(400, 'INVALID_PERMISSIONS', 'App roles grant content actions only', {
      index,
      action: permissions[index]?.action,
      allowed: APP_CONTENT_ACTIONS,
    });
  }
};

const toRows = (roleId: string, permissions: readonly AppPermissionInput[]) =>
  permissions.map((permission) => ({
    role_id: roleId,
    action: permission.action,
    model_id: permission.modelId,
    condition: permission.condition,
    field_ids: permission.fieldIds === null ? null : [...new Set(permission.fieldIds)].sort(),
  }));

const notFound = () => new AppError(404, 'NOT_FOUND', 'App role not found');

const loadView = async (id: string, trx?: Transaction<DB>): Promise<AppRoleView> => {
  const role = await appRolesRepository.findById(id, trx);
  if (!role) {
    throw notFound();
  }
  return toView(
    role,
    await appRolesRepository.listPermissionsForRoles([id], trx),
    await appRolesRepository.countHolders(id, trx),
  );
};

export const listAppRoles = async (): Promise<AppRoleView[]> => {
  const roles = await appRolesRepository.listRoles();
  const grants = await appRolesRepository.listPermissionsForRoles(roles.map((role) => role.id));
  const counts = await appRolesRepository.countHoldersByRole();
  return roles.map((role) => toView(role, grants, counts.get(role.id) ?? 0));
};

export const getAppRole = (id: string): Promise<AppRoleView> => loadView(id);

export type CreateAppRoleInput = {
  key: string;
  name: string;
  description: string;
  permissions: AppPermissionInput[];
};

export const createAppRole = async (
  context: ActorContext,
  input: CreateAppRoleInput,
  schema: FieldVisibilityLookup,
): Promise<AppRoleView> => {
  validateAppPermissions(input.permissions);
  await assertModelsExist(input.permissions, schema);
  try {
    return await db.transaction().execute(async (trx) => {
      const role = await appRolesRepository.insert(
        { key: input.key, name: input.name.trim(), description: input.description.trim() },
        trx,
      );
      await appRolesRepository.insertPermissions(toRows(role.id, input.permissions), trx);
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
      await recordAudit(trx, {
        ...context,
        action: 'app_role.create',
        target: { type: 'app_role', id: role.id },
        metadata: { key: role.key, permissions: input.permissions },
      });
      return loadView(role.id, trx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'ROLE_KEY_TAKEN', 'An app role with this key already exists', undefined, {
        cause: error,
      });
    }
    throw error;
  }
};

export type UpdateAppRoleInput = {
  expectedVersion: number;
  name?: string;
  description?: string;
  permissions?: AppPermissionInput[];
};

/**
 * Optimistic: VERSION_CONFLICT when the role changed since `expectedVersion`. Built-in roles keep their name
 * and description; only their grants change.
 */
export const updateAppRole = async (
  context: ActorContext,
  id: string,
  input: UpdateAppRoleInput,
  schema: FieldVisibilityLookup,
): Promise<AppRoleView> =>
  db.transaction().execute(async (trx) => {
    const role = await appRolesRepository.findById(id, trx);
    if (!role) {
      throw notFound();
    }
    if (role.is_system && (input.name !== undefined || input.description !== undefined)) {
      throw new AppError(
        409,
        'SYSTEM_ROLE',
        'Built-in app roles keep their name; only their permissions change',
      );
    }
    if (input.permissions) {
      validateAppPermissions(input.permissions);
      await assertModelsExist(input.permissions, schema, trx);
    }
    const updated = await appRolesRepository.updateIfVersion(
      id,
      input.expectedVersion,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      },
      trx,
    );
    if (!updated) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The role changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: role.version,
      });
    }
    if (input.permissions) {
      await appRolesRepository.deletePermissionsForRole(id, trx);
      await appRolesRepository.insertPermissions(toRows(id, input.permissions), trx);
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    }
    await recordAudit(trx, {
      ...context,
      action: 'app_role.update',
      target: { type: 'app_role', id },
      metadata: {
        key: role.key,
        fields: Object.keys(input).filter((key) => key !== 'expectedVersion'),
        ...(input.permissions ? { permissions: input.permissions } : {}),
      },
    });
    return loadView(id, trx);
  });

export const deleteAppRole = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const role = await appRolesRepository.findById(id, trx);
    if (!role) {
      throw notFound();
    }
    if (role.is_system) {
      throw new AppError(409, 'SYSTEM_ROLE', 'Built-in app roles cannot be deleted');
    }
    const holders = await appRolesRepository.countHolders(id, trx);
    if (holders > 0) {
      throw new AppError(409, 'ROLE_IN_USE', 'Remove this role from every app user first', {
        users: holders,
      });
    }
    await appRolesRepository.deleteById(id, trx);
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
    await recordAudit(trx, {
      ...context,
      action: 'app_role.delete',
      target: { type: 'app_role', id },
      metadata: { key: role.key },
    });
  });
};
