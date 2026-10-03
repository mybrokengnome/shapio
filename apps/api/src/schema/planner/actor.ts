import { narrowToSite } from '../../permissions/sites.js';
import type { Principal } from '../../permissions/types.js';

/** How schema tables record who made a change (same vocabulary as audit_events.actor_type). */
export const actorColumns = (actor: Principal): { type: string; id: string | null } => {
  switch (actor.kind) {
    case 'admin':
      return { type: 'admin', id: actor.adminUserId };
    case 'token':
      return { type: 'token', id: actor.tokenId };
    case 'appUser':
      return { type: 'app_user', id: actor.appUserId };
    case 'system':
      return { type: 'system', id: actor.component };
    default:
      return { type: 'anonymous', id: null };
  }
};

/**
 * The requester of a planned change, for the audit row written when its job activates it later. Only the
 * identity is known then, not the session or roles; the audit log needs nothing more.
 */
export const principalFromColumns = (type: string, id: string | null): Principal => {
  switch (type) {
    case 'admin':
      return narrowToSite({ adminUserId: id ?? '', sessionId: '', assignments: [] }, null);
    case 'token':
      return { kind: 'token', tokenId: id ?? '', scope: 'admin', roleId: '', siteId: null };
    case 'app_user':
      return { kind: 'appUser', appUserId: id ?? '', roleIds: [] };
    case 'system':
      return { kind: 'system', component: id ?? 'schema' };
    default:
      return { kind: 'anonymous' };
  }
};
