import type { AdminIdentity, AdminPrincipal, Principal, RoleAssignment, TokenPrincipal } from './types.js';

/**
 * Narrowing principals to one site (sites plan §H). Roles are instance-wide; assignments say where a role
 * applies. On a site, an admin holds the roles assigned on that site plus the roles assigned on every site.
 * Network actions only ever see the roles assigned on every site.
 */

const unique = (ids: readonly string[]) => [...new Set(ids)].sort();

/** Roles assigned on every site. */
export const networkRolesOf = (assignments: readonly RoleAssignment[]): string[] =>
  unique(
    assignments.filter((assignment) => assignment.siteId === null).map((assignment) => assignment.roleId),
  );

/** Roles that apply on `siteId`: those assigned there and those assigned on every site. */
export const siteRolesOf = (assignments: readonly RoleAssignment[], siteId: string | null): string[] =>
  unique(
    assignments
      .filter((assignment) => assignment.siteId === null || assignment.siteId === siteId)
      .map((assignment) => assignment.roleId),
  );

/** Sites the admin holds a role on specifically (not counting roles assigned on every site). */
export const assignedSiteIdsOf = (assignments: readonly RoleAssignment[]): string[] =>
  unique(assignments.flatMap((assignment) => (assignment.siteId === null ? [] : [assignment.siteId])));

/** The admin principal for one site, or for a network route (`siteId` null: network roles only). */
export const narrowToSite = (identity: AdminIdentity, siteId: string | null): AdminPrincipal => ({
  kind: 'admin',
  adminUserId: identity.adminUserId,
  sessionId: identity.sessionId,
  assignments: identity.assignments,
  siteId,
  roleIds: siteId === null ? networkRolesOf(identity.assignments) : siteRolesOf(identity.assignments, siteId),
  networkRoleIds: networkRolesOf(identity.assignments),
});

/** The identity behind an admin principal (to narrow it again to another site). */
export const identityOf = (principal: AdminPrincipal): AdminIdentity => ({
  adminUserId: principal.adminUserId,
  sessionId: principal.sessionId,
  assignments: principal.assignments,
});

/**
 * Re-narrows a principal to the request's site. Admins get that site's roles. Tokens keep theirs: a site
 * token's site is the request's site by resolution, and a network token's role applies on every site.
 * Other principals carry no roles that depend on the site here (app users are per site; G3).
 */
export const principalForSite = (principal: Principal, siteId: string | null): Principal =>
  principal.kind === 'admin' ? narrowToSite(identityOf(principal), siteId) : principal;

/** The roles a token holds for network actions: only a network token's (site tokens never reach the network). */
export const tokenNetworkRoleIds = (token: TokenPrincipal): readonly string[] =>
  token.siteId === null ? [token.roleId] : [];
