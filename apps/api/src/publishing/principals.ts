import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { narrowToSite } from '../permissions/sites.js';
import type { AdminPrincipal, Principal, TokenPrincipal } from '../permissions/types.js';
import * as adminUsersRepository from '../repositories/adminUsers.js';
import * as apiTokensRepository from '../repositories/apiTokens.js';

/**
 * Work done later on an admin's behalf (a scheduled publication, a scheduled release, a preview read) is
 * evaluated with that admin's CURRENT roles, so revoking a role or disabling the account also stops what
 * they scheduled or shared. `label` stands in for the session ID (there is no session).
 */
export const loadAdminPrincipal = async (
  database: Database,
  adminUserId: string | null,
  label: string,
  /** The site the deferred work is about: the principal holds that site's roles (null: network roles). */
  siteId: string | null,
): Promise<AdminPrincipal> => {
  const user = adminUserId ? await adminUsersRepository.findSummaryById(adminUserId, database) : undefined;
  if (!user || user.status !== 'active') {
    throw new AppError(
      403,
      'ACTOR_UNAVAILABLE',
      'The admin who set this up no longer exists or is disabled; set it up again with an active account',
    );
  }
  return narrowToSite({ adminUserId: user.id, sessionId: label, assignments: user.assignments }, siteId);
};

/** The admin user ID of a principal, for `created_by` columns (null for tokens and system work). */
export const adminIdOf = (principal: Principal): string | null =>
  principal.kind === 'admin' ? principal.adminUserId : null;

/** The admin API token of a principal, for `created_by_token` columns. */
export const tokenIdOf = (principal: Principal): string | null =>
  principal.kind === 'token' && principal.scope === 'admin' ? principal.tokenId : null;

/** The token principal as it is now: undefined when the token was revoked or expired. */
const loadTokenPrincipal = async (
  database: Database,
  tokenId: string,
  now: Date,
): Promise<TokenPrincipal | undefined> => {
  const row = await apiTokensRepository.findById(tokenId, database);
  if (
    !row ||
    row.revoked_at !== null ||
    (row.expires_at !== null && row.expires_at <= now) ||
    row.role_kind === 'delivery'
  ) {
    return undefined;
  }
  return { kind: 'token', tokenId: row.id, scope: 'admin', roleId: row.role_id, siteId: row.site_id };
};

/** Whoever set up deferred work: the admin user, else the admin token (both re-checked as they are now). */
export const loadActor = async (
  database: Database,
  actor: { adminUserId: string | null; tokenId: string | null },
  label: string,
  /** The site the work is about; an admin is evaluated with that site's roles. */
  siteId: string,
  now = new Date(),
): Promise<Principal> => {
  if (actor.adminUserId || !actor.tokenId) {
    return loadAdminPrincipal(database, actor.adminUserId, label, siteId);
  }
  const token = await loadTokenPrincipal(database, actor.tokenId, now);
  if (!token) {
    throw new AppError(
      403,
      'ACTOR_UNAVAILABLE',
      'The API token that set this up was revoked or has expired; set it up again',
    );
  }
  return token;
};
