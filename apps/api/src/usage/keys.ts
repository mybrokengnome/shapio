import type { Principal } from '../permissions/types.js';

/**
 * How delivery reads are attributed (plan developer-face §5). Delivery tokens are consumers, one key per
 * token; app users are counted together, and so are anonymous callers. Admin reads (admin users and
 * admin-scope API tokens), system work and previews are not consumers and are never counted.
 */
export const APP_USERS_PRINCIPAL_KEY = 'app_users';
export const ANONYMOUS_PRINCIPAL_KEY = 'anonymous';

/** `token:<id>`, `app_users`, `anonymous`, or null for principals whose reads are not counted. */
export const usagePrincipalKey = (principal: Principal): string | null => {
  switch (principal.kind) {
    case 'token':
      return principal.scope === 'delivery' ? `token:${principal.tokenId}` : null;
    case 'appUser':
      return APP_USERS_PRINCIPAL_KEY;
    case 'anonymous':
      return ANONYMOUS_PRINCIPAL_KEY;
    default:
      return null;
  }
};

/** The UTC day a read is bucketed in, `YYYY-MM-DD`. */
export const usageDayOf = (at: Date): string => at.toISOString().slice(0, 10);

/** A populated relation's target field: `<relation field ID>.<target field ID>`. */
export const relationFieldPath = (relationFieldId: string, targetFieldId: string): string =>
  `${relationFieldId}.${targetFieldId}`;
