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
  appUser: (overrides: Partial<AppUserPrincipal> = {}): AppUserPrincipal => ({
    kind: 'appUser',
    appUserId: randomUUID(),
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
  anonymous: (): AnonymousPrincipal => ({ kind: 'anonymous' }),
  system: (component = 'test'): SystemPrincipal => ({ kind: 'system', component }),
};
