import { principalForSite } from '../permissions/sites.js';
import type { GlobalAction, PermissionEvaluator, Principal } from '../permissions/types.js';

/**
 * What a principal may do across every site (sites plan §H): the roles an admin holds on every site, or a
 * network token's role. A role held on one site never reaches other sites, and a site token never leaves
 * its site.
 */

/** Whether the principal works on every site (roles assigned on every site, or a network token). */
export const seesEverySite = (principal: Principal): boolean => {
  switch (principal.kind) {
    case 'admin':
      return principal.networkRoleIds.length > 0;
    case 'token':
      return principal.scope === 'admin' && principal.siteId === null;
    default:
      return false;
  }
};

/**
 * Whether the principal may perform a site action on every site at once (a network webhook): checked
 * against its roles on every site only.
 */
export const canPerformOnEverySite = async (
  permissions: PermissionEvaluator,
  principal: Principal,
  action: GlobalAction,
): Promise<boolean> => {
  if (!seesEverySite(principal)) {
    return false;
  }
  return permissions.canPerform(principalForSite(principal, null), action);
};
