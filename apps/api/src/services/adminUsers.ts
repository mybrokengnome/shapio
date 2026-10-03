import type { Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { isUniqueViolation } from '../helpers/pgErrors.js';
import { SYSTEM_ROLE_KEYS } from '../permissions/seedRoles.js';
import type { Principal } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import type { AdminUserSummary } from '../repositories/adminUsers.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';

export type AdminUserStatus = 'active' | 'disabled';

export type AdminUserView = {
  id: string;
  email: string;
  name: string;
  status: AdminUserStatus;
  roleIds: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export const toAdminUserView = (row: AdminUserSummary): AdminUserView => ({
  id: row.id,
  email: row.email,
  name: row.name,
  status: row.status === 'disabled' ? 'disabled' : 'active',
  roleIds: row.role_ids,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Emails are compared and stored trimmed and lower-cased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const notFound = () => new AppError(404, 'NOT_FOUND', 'Admin user not found');

export const getOwnerRoleId = async (trx: Transaction<DB>): Promise<string> => {
  const [owner] = await adminRolesRepository.findByKeys([SYSTEM_ROLE_KEYS.owner], trx);
  if (!owner) {
    throw new Error('The owner role is missing; system roles were not seeded');
  }
  return owner.id;
};

/** Owners (and the CLI) may grant or remove the owner role and change owner accounts; nobody else. */
export const isOwnerActor = (actor: Principal, ownerRoleId: string): boolean =>
  actor.kind === 'system' || (actor.kind === 'admin' && actor.networkRoleIds.includes(ownerRoleId));

/** Every role ID must exist and be an admin role (delivery roles are for tokens only). */
export const assertAssignableRoles = async (roleIds: readonly string[], trx: Transaction<DB>) => {
  const unique = [...new Set(roleIds)];
  const roles = await adminRolesRepository.findByIds(unique, trx);
  if (roles.length !== unique.length || roles.some((role) => role.kind !== 'admin')) {
    throw new AppError(400, 'INVALID_ROLES', 'Every role must exist and be an admin role');
  }
  return unique;
};

type NewAdminUserInput = { email: string; name: string; passwordHash: string; roleIds: readonly string[] };

/**
 * Inserts an admin user with roles. Shared by setup, invitations and `shapio admin create`; the caller
 * owns the transaction, authorisation and audit.
 */
export const insertAdminUser = async (input: NewAdminUserInput, trx: Transaction<DB>): Promise<string> => {
  const email = normalizeEmail(input.email);
  if (await adminUsersRepository.existsByEmail(email, trx)) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An admin with this email already exists');
  }
  try {
    const { id } = await adminUsersRepository.insert(
      { email, name: input.name.trim(), password_hash: input.passwordHash },
      trx,
    );
    await adminUsersRepository.replaceRoles(id, input.roleIds, trx);
    return id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An admin with this email already exists', undefined, {
        cause: error,
      });
    }
    throw error;
  }
};

export const listAdminUsers = async (): Promise<AdminUserView[]> =>
  (await adminUsersRepository.list()).map(toAdminUserView);

export const getAdminUser = async (id: string): Promise<AdminUserView> => {
  const row = await adminUsersRepository.findSummaryById(id);
  if (!row) {
    throw notFound();
  }
  return toAdminUserView(row);
};

/** Fails when no active owner other than `exceptUserId` would remain. Locks owners to serialise checks. */
const assertAnotherOwnerRemains = async (exceptUserId: string, trx: Transaction<DB>) => {
  const owners = await adminUsersRepository.lockActiveHoldersOfRoleKey(SYSTEM_ROLE_KEYS.owner, trx);
  if (!owners.some((owner) => owner.id !== exceptUserId)) {
    throw new AppError(409, 'LAST_OWNER', 'Shapio needs at least one active owner');
  }
};

export type UpdateAdminUserInput = { name?: string; status?: AdminUserStatus; roleIds?: string[] };

/**
 * Changes another admin's name, status or roles. Role changes rotate the user's sessions on their next
 * request; disabling revokes them. Owners are protected: only owners change owner accounts, and the last
 * active owner cannot lose the role or be disabled.
 */
export const updateAdminUser = async (
  context: ActorContext,
  id: string,
  input: UpdateAdminUserInput,
): Promise<AdminUserView> =>
  db.transaction().execute(async (trx) => {
    const target = await adminUsersRepository.findSummaryById(id, trx);
    if (!target) {
      throw notFound();
    }
    const ownerRoleId = await getOwnerRoleId(trx);
    const roleIds = input.roleIds ? await assertAssignableRoles(input.roleIds, trx) : target.role_ids;
    const wasOwner = target.role_ids.includes(ownerRoleId);
    const willBeOwner = roleIds.includes(ownerRoleId);
    if ((wasOwner || willBeOwner) && !isOwnerActor(context.actor, ownerRoleId)) {
      throw new AppError(
        403,
        'OWNER_REQUIRED',
        'Only owners can change owner accounts or grant the owner role',
      );
    }
    const disabling = input.status === 'disabled' && target.status !== 'disabled';
    if (wasOwner && (!willBeOwner || disabling)) {
      await assertAnotherOwnerRemains(id, trx);
    }
    const now = new Date();
    await adminUsersRepository.update(
      id,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      trx,
    );
    const rolesChanged =
      input.roleIds !== undefined &&
      (roleIds.length !== target.role_ids.length ||
        roleIds.some((roleId) => !target.role_ids.includes(roleId)));
    if (rolesChanged) {
      await adminUsersRepository.replaceRoles(id, roleIds, trx);
      await adminSessionsRepository.requireRotationForUser(id, now, trx);
    }
    if (disabling) {
      await adminSessionsRepository.revokeAllForUser(id, now, {}, trx);
    }
    await recordAudit(trx, {
      ...context,
      action: 'admin_user.update',
      target: { type: 'admin_user', id },
      metadata: {
        fields: Object.keys(input),
        ...(rolesChanged ? { roleIds: { from: target.role_ids, to: [...roleIds].sort() } } : {}),
        ...(input.status !== undefined ? { status: { from: target.status, to: input.status } } : {}),
      },
    });
    const updated = await adminUsersRepository.findSummaryById(id, trx);
    if (!updated) {
      throw notFound();
    }
    return toAdminUserView(updated);
  });

export const deleteAdminUser = async (context: ActorContext, id: string): Promise<void> => {
  if (context.actor.kind === 'admin' && context.actor.adminUserId === id) {
    throw new AppError(409, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }
  await db.transaction().execute(async (trx) => {
    const target = await adminUsersRepository.findSummaryById(id, trx);
    if (!target) {
      throw notFound();
    }
    const ownerRoleId = await getOwnerRoleId(trx);
    if (target.role_ids.includes(ownerRoleId)) {
      if (!isOwnerActor(context.actor, ownerRoleId)) {
        throw new AppError(403, 'OWNER_REQUIRED', 'Only owners can delete owners');
      }
      await assertAnotherOwnerRemains(id, trx);
    }
    await adminUsersRepository.deleteById(id, trx);
    await recordAudit(trx, {
      ...context,
      action: 'admin_user.delete',
      target: { type: 'admin_user', id },
      metadata: { email: target.email },
    });
  });
};

/** Signs another admin out everywhere. */
export const revokeAdminUserSessions = async (context: ActorContext, id: string): Promise<void> => {
  await db.transaction().execute(async (trx) => {
    const target = await adminUsersRepository.findSummaryById(id, trx);
    if (!target) {
      throw notFound();
    }
    const ownerRoleId = await getOwnerRoleId(trx);
    if (target.role_ids.includes(ownerRoleId) && !isOwnerActor(context.actor, ownerRoleId)) {
      throw new AppError(403, 'OWNER_REQUIRED', 'Only owners can sign owners out');
    }
    await adminSessionsRepository.revokeAllForUser(id, new Date(), {}, trx);
    await recordAudit(trx, { ...context, action: 'session.revoke_all', target: { type: 'admin_user', id } });
  });
};
