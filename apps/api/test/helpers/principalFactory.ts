import { randomUUID } from 'node:crypto';
import { PRIMARY_SITE_ID } from '../../src/constants/sites.js';
import type {
  AdminPrincipal,
  AnonymousPrincipal,
  AppUserPrincipal,
  SystemPrincipal,
  TokenPrincipal,
} from '../../src/permissions/types.js';

/** Principal values for tests. They are not persisted; package B adds factories that create real users. */
export const principalFactory = {
  /** An admin on the primary site whose `roleIds` are assigned on every site. */
  admin: (overrides: Partial<AdminPrincipal> = {}): AdminPrincipal => {
    const roleIds = overrides.roleIds ?? [];
    return {
      kind: 'admin',
      adminUserId: randomUUID(),
      sessionId: randomUUID(),
      assignments: roleIds.map((roleId) => ({ roleId, siteId: null })),
      siteId: PRIMARY_SITE_ID,
      roleIds,
      networkRoleIds: roleIds,
      ...overrides,
    };
  },
  /** An app user of the primary site. */
  appUser: (overrides: Partial<AppUserPrincipal> = {}): AppUserPrincipal => ({
    kind: 'appUser',
    appUserId: randomUUID(),
    siteId: PRIMARY_SITE_ID,
    roleIds: [],
    ...overrides,
  }),
  token: (overrides: Partial<TokenPrincipal> = {}): TokenPrincipal => ({
    kind: 'token',
    tokenId: randomUUID(),
    scope: 'delivery',
    roleId: randomUUID(),
    siteId: PRIMARY_SITE_ID,
    ...overrides,
  }),
  /** An anonymous caller on a site (the primary one unless given; null = outside any site). */
  anonymous: (siteId: string | null = PRIMARY_SITE_ID): AnonymousPrincipal => ({ kind: 'anonymous', siteId }),
  system: (component = 'test'): SystemPrincipal => ({ kind: 'system', component }),
};
