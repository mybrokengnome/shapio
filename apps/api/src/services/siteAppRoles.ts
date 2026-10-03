import { db } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import type { AdminPrincipal, TokenPrincipal } from '../permissions/types.js';
import * as appRolesRepository from '../repositories/appRoles.js';
import * as permissionsVersionRepository from '../repositories/permissionsVersion.js';
import * as siteAppRolesRepository from '../repositories/siteAppRoles.js';
import type { AppRoleAudience } from '../repositories/siteAppRoles.js';
import * as sitesRepository from '../repositories/sites.js';
import type { ActorContext } from './actorContext.js';
import { recordAudit } from './audit.js';
import { getSite } from './sites.js';

/**
 * Which app roles apply on a site (sites plan §H): those bound to `public` apply to anonymous callers, those
 * bound to `authenticated` to every signed-in app user of the site, on top of the roles assigned to the
 * account. App roles themselves are instance-wide. A new site binds nothing, so it denies by default.
 */
export type SiteAppRolesView = { siteId: string; public: string[]; authenticated: string[] };

const toView = (
  siteId: string,
  rows: readonly siteAppRolesRepository.SiteAppRoleBinding[],
): SiteAppRolesView => {
  const of = (audience: AppRoleAudience) =>
    rows.filter((row) => row.audience === audience).map((row) => row.role_id);
  return { siteId, public: of('public'), authenticated: of('authenticated') };
};

/** A site's bindings, for an admin who works on the site (another site reads as not found). */
export const getSiteAppRoles = async (
  principal: AdminPrincipal | TokenPrincipal,
  siteId: string,
): Promise<SiteAppRolesView> => {
  await getSite(principal, siteId);
  return toView(siteId, await siteAppRolesRepository.listForSite(siteId));
};

export type SetSiteAppRolesInput = { public: readonly string[]; authenticated: readonly string[] };

/**
 * Replaces a site's bindings. Every role must be an existing app role. The permissions version moves in the
 * same transaction, so every instance's evaluator sees the change at once.
 */
export const setSiteAppRoles = async (
  context: ActorContext,
  siteId: string,
  input: SetSiteAppRolesInput,
): Promise<SiteAppRolesView> =>
  db.transaction().execute(async (trx) => {
    if (!(await sitesRepository.lockById(siteId, trx))) {
      throw new AppError(404, 'SITE_NOT_FOUND', 'Site not found');
    }
    const next = {
      public: [...new Set(input.public)].sort(),
      authenticated: [...new Set(input.authenticated)].sort(),
    };
    const roleIds = [...new Set([...next.public, ...next.authenticated])];
    if ((await appRolesRepository.findByIds(roleIds, trx)).length !== roleIds.length) {
      throw new AppError(400, 'INVALID_ROLES', 'Every role must be an existing app role');
    }
    const before = toView(siteId, await siteAppRolesRepository.listForSite(siteId, trx));
    await siteAppRolesRepository.replaceForAudience(siteId, 'public', next.public, trx);
    await siteAppRolesRepository.replaceForAudience(siteId, 'authenticated', next.authenticated, trx);
    await permissionsVersionRepository.bumpPermissionsVersion(trx);
    await recordAudit(trx, {
      ...context,
      action: 'site.app_roles_update',
      target: { type: 'site', id: siteId },
      metadata: {
        public: { from: before.public, to: next.public },
        authenticated: { from: before.authenticated, to: next.authenticated },
      },
    });
    return { siteId, ...next };
  });
