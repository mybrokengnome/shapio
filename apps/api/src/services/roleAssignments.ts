import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import type { RoleAssignment } from '../permissions/types.js';
import * as adminRolesRepository from '../repositories/adminRoles.js';
import * as sitesRepository from '../repositories/sites.js';

/**
 * Admin role assignments (sites plan §H, ADR 0011): a role held on one site, or on every site (`siteId`
 * null). Roles and sites are instance-wide rows; an assignment only says where a role applies.
 */

/** How the API names assignments: the full list, or (deprecated) role IDs meaning "these roles on every site". */
export type AssignmentsInput = { assignments?: readonly RoleAssignment[]; roleIds?: readonly string[] };

const assignmentKey = (assignment: RoleAssignment) => `${assignment.roleId}:${assignment.siteId ?? '*'}`;

/** Every site sorts before any one site. */
const compareSites = (a: string | null, b: string | null): number => {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  return b === null ? 1 : a.localeCompare(b);
};

/** Stable order: by role, then every site first, then by site. */
export const sortAssignments = (assignments: readonly RoleAssignment[]): RoleAssignment[] =>
  [...assignments].sort((a, b) => a.roleId.localeCompare(b.roleId) || compareSites(a.siteId, b.siteId));

/** The assignments an input names; undefined when it names none. Both forms at once are refused. */
export const assignmentsOf = (input: AssignmentsInput): RoleAssignment[] | undefined => {
  if (input.assignments !== undefined && input.roleIds !== undefined) {
    throw new AppError(400, 'INVALID_ASSIGNMENTS', 'Send either assignments or roleIds, not both');
  }
  if (input.assignments !== undefined) {
    return input.assignments.map(({ roleId, siteId }) => ({ roleId, siteId }));
  }
  return input.roleIds?.map((roleId) => ({ roleId, siteId: null }));
};

/** Whether assignments hold the owner role (on every site: the only place it can be held). */
export const holdsOwner = (assignments: readonly RoleAssignment[], ownerRoleId: string): boolean =>
  assignments.some((assignment) => assignment.roleId === ownerRoleId && assignment.siteId === null);

/** Distinct role IDs across assignments (on any site). */
export const roleIdsOf = (assignments: readonly RoleAssignment[]): string[] =>
  [...new Set(assignments.map((assignment) => assignment.roleId))].sort();

/**
 * Validates assignments before they are stored: every role exists and is an admin role (delivery roles are
 * for tokens only), every site exists, no assignment is repeated, and the owner role is held on every site
 * only (owners are network admins). Returns them sorted.
 */
export const assertAssignableAssignments = async (
  assignments: readonly RoleAssignment[],
  ownerRoleId: string,
  trx: Transaction<DB>,
): Promise<RoleAssignment[]> => {
  const keys = new Set(assignments.map(assignmentKey));
  if (keys.size !== assignments.length) {
    throw new AppError(400, 'DUPLICATE_ASSIGNMENT', 'A role is assigned twice on the same site');
  }
  const roleIds = roleIdsOf(assignments);
  const roles = await adminRolesRepository.findByIds(roleIds, trx);
  if (roles.length !== roleIds.length || roles.some((role) => role.kind !== 'admin')) {
    throw new AppError(400, 'INVALID_ROLES', 'Every role must exist and be an admin role');
  }
  const siteIds = [...new Set(assignments.flatMap((assignment) => assignment.siteId ?? []))];
  if (siteIds.length > 0 && (await sitesRepository.findByIds(siteIds, trx)).length !== siteIds.length) {
    throw new AppError(400, 'INVALID_SITES', 'Every site must exist');
  }
  if (assignments.some((assignment) => assignment.roleId === ownerRoleId && assignment.siteId !== null)) {
    throw new AppError(400, 'OWNER_ALL_SITES', 'The owner role is held on every site, never on one site');
  }
  return sortAssignments(assignments);
};
