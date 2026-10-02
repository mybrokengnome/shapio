import { randomUUID } from 'node:crypto';
import type {
  AdminPrincipal,
  AnonymousPrincipal,
  AppUserPrincipal,
  SystemPrincipal,
  TokenPrincipal,
} from '../../src/permissions/types.js';

/** Principal values for tests. They are not persisted; package B adds factories that create real users. */
export const principalFactory = {
  admin: (overrides: Partial<AdminPrincipal> = {}): AdminPrincipal => ({
    kind: 'admin',
    adminUserId: randomUUID(),
    sessionId: randomUUID(),
    roleIds: [],
    ...overrides,
  }),
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
    ...overrides,
  }),
  anonymous: (): AnonymousPrincipal => ({ kind: 'anonymous' }),
  system: (component = 'test'): SystemPrincipal => ({ kind: 'system', component }),
};
