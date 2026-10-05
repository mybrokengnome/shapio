import type { Transaction } from 'kysely';
import { db } from '../db/index.js';
import { isUniqueViolation } from '../db/sql/errors.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { FieldVisibilityLookup } from '../permissions/policy.js';
import {
  CONTENT_ACTIONS,
  DELIVERY_ACTIONS,
  GLOBAL_ACTIONS,
  READ_DRAFTS_ACTION,
  type ContentAction,
  type GlobalAction,
  type ModelAction,
  type PermissionExecutor,
  type RowCondition,
} from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import type { AdminRoleRow, PermissionGrantRow } from '../repositories/adminRoles.js';
import * as apiTokensRepository from '../repositories/apiTokens.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

export type RoleKind = 'admin' | 'delivery';

export type PermissionInput = {
  action: ModelAction | GlobalAction;
  /** null = every model. Must be null for global actions. */
  modelId: string | null;
  condition: RowCondition['kind'] | null;
  /** null = every field the principal's audience may see. */
  fieldIds: string[] | null;
};

export type RoleView = {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: RoleKind;
  isSystem: boolean;
  version: number;
  permissions: PermissionInput[];
  createdAt: Date;
  updatedAt: Date;
};

const MODEL_ACTION_SET: ReadonlySet<string> = new Set([...CONTENT_ACTIONS, ...DELIVERY_ACTIONS]);
const DELIVERY_ACTION_SET: ReadonlySet<string> = new Set(DELIVERY_ACTIONS);
const GLOBAL_ACTION_SET: ReadonlySet<string> = new Set(GLOBAL_ACTIONS);
const FIELD_SCOPED_ACTIONS: ReadonlySet<string> = new Set<ContentAction>(['read', 'create', 'update']);

const toPermissionInput = (row: PermissionGrantRow): PermissionInput => ({
  action: row.action as PermissionInput['action'],
  modelId: row.model_id,
  condition: row.condition === 'ownedByPrincipal' ? 'ownedByPrincipal' : null,
  fieldIds: row.field_ids,
});

const toRoleView = (role: AdminRoleRow, grants: readonly PermissionGrantRow[]): RoleView => ({
  id: role.id,
  key: role.key,
  name: role.name,
  description: role.description,
  kind: role.kind === 'delivery' ? 'delivery' : 'admin',
  isSystem: role.is_system,
  version: role.version,
  permissions: grants.filter((grant) => grant.role_id === role.id).map(toPermissionInput),
  createdAt: role.created_at,
  updatedAt: role.updated_at,
});

const invalidPermissions = (message: string, details?: unknown) =>
  new AppError(400, 'INVALID_PERMISSIONS', message, details);

/**
 * `readDrafts` (plan drafts-mode §1): delivery roles only, and always on every model with no condition or
 * field list, so one check per request covers every model a draft read reaches (relation targets too).
 */
const validateReadDrafts = (kind: RoleKind, permission: PermissionInput, at: object): void => {
  if (kind !== 'delivery') {
    throw invalidPermissions('Read drafts is for delivery roles only', at);
  }
  if (permission.modelId !== null || permission.condition !== null || permission.fieldIds !== null) {
    throw invalidPermissions('Read drafts applies to every model, with no condition or field list', at);
  }
};

/**
 * The server-side rules for grants (never only the UI): known actions, global actions only without a
 * model, conditions and field lists only where they mean something, delivery roles read-only (`read`, and
 * `readDrafts` on every model), no duplicate (action, model) pairs.
 */
export const validatePermissions = (kind: RoleKind, permissions: readonly PermissionInput[]): void => {
  const seen = new Set<string>();
  permissions.forEach((permission, index) => {
    const at = { index, action: permission.action };
    const isGlobal = GLOBAL_ACTION_SET.has(permission.action);
    if (!isGlobal && !MODEL_ACTION_SET.has(permission.action)) {
      throw invalidPermissions('Unknown action', at);
    }
    if (
      isGlobal &&
      (permission.modelId !== null || permission.condition !== null || permission.fieldIds !== null)
    ) {
      throw invalidPermissions('Global actions take no model, condition or field list', at);
    }
    if (kind === 'delivery' && !DELIVERY_ACTION_SET.has(permission.action)) {
      throw invalidPermissions('Delivery roles can only read', at);
    }
    if (permission.action === READ_DRAFTS_ACTION) {
      validateReadDrafts(kind, permission, at);
    }
    if (permission.fieldIds !== null && !FIELD_SCOPED_ACTIONS.has(permission.action)) {
      throw invalidPermissions('Field lists apply to read, create and update only', at);
    }
    const key = `${permission.action}\u0000${permission.modelId ?? '*'}`;
    if (seen.has(key)) {
      throw invalidPermissions('Each action may be granted once per model', at);
    }
    seen.add(key);
  });
};

/**
 * Every model a grant names must exist (the registry decides; package D implements the lookup).
 * `executor`: the caller's open transaction, when there is one.
 */
export const assertModelsExist = async (
  permissions: readonly PermissionInput[],
  schema: FieldVisibilityLookup,
  executor?: PermissionExecutor,
) => {
  const modelIds = [...new Set(permissions.flatMap((p) => (p.modelId === null ? [] : [p.modelId])))];
  const exists = await Promise.all(modelIds.map((modelId) => schema.hasModel(modelId, executor)));
  const unknown = modelIds.filter((_modelId, index) => !exists[index]);
  if (unknown.length > 0) {
    throw new AppError(400, 'UNKNOWN_MODEL', 'Grants name models that do not exist', { modelIds: unknown });
  }
};

const toRows = (roleId: string, permissions: readonly PermissionInput[]) =>
  permissions.map((permission) => ({
    role_id: roleId,
    action: permission.action,
    model_id: permission.modelId,
    condition: permission.condition,
    field_ids: permission.fieldIds === null ? null : [...new Set(permission.fieldIds)].sort(),
  }));

const loadRoleView = async (id: string, trx?: Transaction<DB>): Promise<RoleView> => {
  const role = await adminRolesRepository.findById(id, trx);
  if (!role) {
    throw new AppError(404, 'NOT_FOUND', 'Role not found');
  }
  return toRoleView(role, await adminRolesRepository.listPermissionsForRoles([id], trx));
};

export const listRoles = async (): Promise<RoleView[]> => {
  const roles = await adminRolesRepository.listRoles();
  const grants = await adminRolesRepository.listPermissionsForRoles(roles.map((role) => role.id));
  return roles.map((role) => toRoleView(role, grants));
};

export const getRole = (id: string): Promise<RoleView> => loadRoleView(id);

type CreateRoleInput = {
  key: string;
  name: string;
  description: string;
  kind: RoleKind;
  permissions: PermissionInput[];
};

export const createRole = async (
  context: ActorContext,
  input: CreateRoleInput,
  schema: FieldVisibilityLookup,
): Promise<RoleView> => {
  validatePermissions(input.kind, input.permissions);
  await assertModelsExist(input.permissions, schema);
  try {
    return await db.transaction().execute(async (trx) => {
      const role = await adminRolesRepository.insert(
        { key: input.key, name: input.name.trim(), description: input.description.trim(), kind: input.kind },
        trx,
      );
      await adminRolesRepository.insertPermissions(toRows(role.id, input.permissions), trx);
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
      await recordAudit(trx, {
        ...context,
        action: 'role.create',
        target: { type: 'admin_role', id: role.id },
        metadata: { key: role.key, kind: input.kind, permissions: input.permissions },
      });
      return loadRoleView(role.id, trx);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'ROLE_KEY_TAKEN', 'A role with this key already exists', undefined, {
        cause: error,
      });
    }
    throw error;
  }
};

type UpdateRoleInput = {
  expectedVersion: number;
  name?: string;
  description?: string;
  permissions?: PermissionInput[];
};

const loadEditableRole = async (id: string, trx: Transaction<DB>) => {
  const role = await adminRolesRepository.findById(id, trx);
  if (!role) {
    throw new AppError(404, 'NOT_FOUND', 'Role not found');
  }
  if (role.is_system) {
    throw new AppError(409, 'SYSTEM_ROLE', 'Built-in roles cannot be changed; create a custom role instead');
  }
  return role;
};

/** Optimistic: fails with VERSION_CONFLICT when the role changed since `expectedVersion` was read. */
export const updateRole = async (
  context: ActorContext,
  id: string,
  input: UpdateRoleInput,
  schema: FieldVisibilityLookup,
): Promise<RoleView> =>
  db.transaction().execute(async (trx) => {
    const role = await loadEditableRole(id, trx);
    const kind: RoleKind = role.kind === 'delivery' ? 'delivery' : 'admin';
    if (input.permissions) {
      validatePermissions(kind, input.permissions);
      await assertModelsExist(input.permissions, schema, trx);
    }
    const updated = await adminRolesRepository.updateIfVersion(
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
      await adminRolesRepository.deletePermissionsForRole(id, trx);
      await adminRolesRepository.insertPermissions(toRows(id, input.permissions), trx);
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    }
    await recordAudit(trx, {
      ...context,
      action: 'role.update',
      target: { type: 'admin_role', id },
      metadata: {
        fields: Object.keys(input).filter((key) => key !== 'expectedVersion'),
        ...(input.permissions ? { permissions: input.permissions } : {}),
      },
    });
    return loadRoleView(id, trx);
  });

export const deleteRole = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const role = await loadEditableRole(id, trx);
    const holders = await adminRolesRepository.countHolders(id, trx);
    if (holders.users > 0 || holders.tokens > 0) {
      throw new AppError(
        409,
        'ROLE_IN_USE',
        'Remove this role from every admin and API token first',
        holders,
      );
    }
    await apiTokensRepository.deleteRevokedForRole(id, trx);
    await adminRolesRepository.deleteById(id, trx);
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
    await recordAudit(trx, {
      ...context,
      action: 'role.delete',
      target: { type: 'admin_role', id },
      metadata: { key: role.key },
    });
  });
};
