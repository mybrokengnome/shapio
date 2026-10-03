import type { Transaction } from 'kysely';
import { db } from '../db/index.js';
import { isUniqueViolation } from '../db/sql/errors.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { SYSTEM_ROLE_KEYS } from '../permissions/seedRoles.js';
import type { Principal, RoleAssignment } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as adminSessionsRepository from '../repositories/adminSessions.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import type { AdminUserSummary } from '../repositories/adminUsers.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';
import {
  assertAssignableAssignments,
  assignmentsOf,
  holdsOwner,
  roleIdsOf,
  sortAssignments,
  type AssignmentsInput,
} from './roleAssignments.js';

export type AdminUserStatus = 'active' | 'disabled';

export type AdminUserView = {
  id: string;
  email: string;
  name: string;
  status: AdminUserStatus;
  /** Where each role applies: on one site, or on every site (`siteId` null). */
  assignments: RoleAssignment[];
  /** Deprecated: the distinct roles of `assignments`, on any site. */
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
  assignments: row.assignments,
  roleIds: roleIdsOf(row.assignments),
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

type NewAdminUserInput = { email: string; name: string; passwordHash: string } & AssignmentsInput;

/**
 * Inserts an admin user with role assignments (`roleIds`: those roles on every site). Shared by setup,
 * invitations and `shapio admin create`; the caller owns the transaction, validation, authorisation and
 * audit.
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
    await adminUsersRepository.replaceAssignments(id, assignmentsOf(input) ?? [], trx);
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

export type UpdateAdminUserInput = { name?: string; status?: AdminUserStatus } & AssignmentsInput;

const sameAssignments = (a: readonly RoleAssignment[], b: readonly RoleAssignment[]) =>
  JSON.stringify(sortAssignments(a)) === JSON.stringify(sortAssignments(b));

/**
 * Changes another admin's name, status or role assignments (`assignments` replaces them all; `roleIds`, the
 * deprecated form, replaces them with those roles on every site). Assignment changes rotate the user's
 * sessions on their next request; disabling revokes them. Owners are protected: only owners change owner
 * accounts, and the last active owner cannot lose the role or be disabled.
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
    const requested = assignmentsOf(input);
    const assignments = requested
      ? await assertAssignableAssignments(requested, ownerRoleId, trx)
      : target.assignments;
    const wasOwner = target.network_role_ids.includes(ownerRoleId);
    const willBeOwner = holdsOwner(assignments, ownerRoleId);
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
    const assignmentsChanged = requested !== undefined && !sameAssignments(assignments, target.assignments);
    if (assignmentsChanged) {
      await adminUsersRepository.replaceAssignments(id, assignments, trx);
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
        ...(assignmentsChanged
          ? { assignments: { from: sortAssignments(target.assignments), to: assignments } }
          : {}),
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
    if (target.network_role_ids.includes(ownerRoleId)) {
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
    if (target.network_role_ids.includes(ownerRoleId) && !isOwnerActor(context.actor, ownerRoleId)) {
      throw new AppError(403, 'OWNER_REQUIRED', 'Only owners can sign owners out');
    }
    await adminSessionsRepository.revokeAllForUser(id, new Date(), {}, trx);
    await recordAudit(trx, { ...context, action: 'session.revoke_all', target: { type: 'admin_user', id } });
  });
};
