import { describe, expect, it } from 'vitest';
import { AppError } from '../helpers/appError.js';
import { narrowToSite, principalForSite } from './sites.js';
import type { Principal } from './types.js';

const SITE_A = '00000000-0000-4000-b000-00000000000a';
const SITE_B = '00000000-0000-4000-b000-00000000000b';

const siteMismatchOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? `${error.statusCode} ${error.code}` : String(error);
  }
  return 'no error';
};

describe('principalForSite (sites plan §H)', () => {
  it('narrows admins to the site: roles there plus roles on every site', () => {
    const admin = narrowToSite(
      {
        adminUserId: 'u',
        sessionId: 's',
        assignments: [
          { roleId: 'everywhere', siteId: null },
          { roleId: 'on-a', siteId: SITE_A },
        ],
      },
      null,
    );
    expect(principalForSite(admin, SITE_A)).toMatchObject({
      siteId: SITE_A,
      roleIds: ['everywhere', 'on-a'],
      networkRoleIds: ['everywhere'],
    });
    expect(principalForSite(admin, SITE_B)).toMatchObject({ siteId: SITE_B, roleIds: ['everywhere'] });
  });

  it('puts anonymous callers on the site (its `public` bindings apply there)', () => {
    expect(principalForSite({ kind: 'anonymous', siteId: null }, SITE_A)).toEqual({
      kind: 'anonymous',
      siteId: SITE_A,
    });
  });

  it('keeps app users and site tokens on their own site and refuses any other (403 SITE_MISMATCH)', () => {
    const appUser: Principal = { kind: 'appUser', appUserId: 'a', siteId: SITE_A, roleIds: [] };
    expect(principalForSite(appUser, SITE_A)).toBe(appUser);
    expect(siteMismatchOf(() => principalForSite(appUser, SITE_B))).toBe('403 SITE_MISMATCH');

    const siteToken: Principal = {
      kind: 'token',
      tokenId: 't',
      scope: 'delivery',
      roleId: 'r',
      siteId: SITE_A,
    };
    expect(principalForSite(siteToken, SITE_A)).toBe(siteToken);
    expect(siteMismatchOf(() => principalForSite(siteToken, SITE_B))).toBe('403 SITE_MISMATCH');

    const networkToken: Principal = { ...siteToken, scope: 'admin', siteId: null };
    expect(principalForSite(networkToken, SITE_B)).toBe(networkToken);
  });
});
