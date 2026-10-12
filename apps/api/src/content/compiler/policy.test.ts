import { describe, expect, it } from 'vitest';
import type { Policy, Principal } from '../../permissions/types.js';
import { everyRowReadMask, rowReadMask } from './policy.js';

const policy: Policy = {
  allowed: true,
  rowFilter: null,
  readMask: { mode: 'only', fieldIds: ['f-name', 'f-email'], componentFields: 'public' },
  rowReadMasks: {
    everyRow: { mode: 'only', fieldIds: ['f-name'], componentFields: 'public' },
    when: [
      {
        condition: { kind: 'ownedByPrincipal' },
        mask: { mode: 'only', fieldIds: ['f-name', 'f-email'], componentFields: 'public' },
      },
    ],
  },
  writeMask: { mode: 'only', fieldIds: [], componentFields: 'public' },
};

const appUser: Principal = { kind: 'appUser', appUserId: 'u-1', siteId: 's', roleIds: [] };
const anonymous: Principal = { kind: 'anonymous', siteId: 's' };
const own = { created_by_admin_id: null, owner_app_user_id: 'u-1' };
const others = { created_by_admin_id: null, owner_app_user_id: 'u-2' };

describe('read masks on one loaded entry', () => {
  it('adds a conditioned mask only on rows matching its condition', () => {
    expect(rowReadMask(policy, appUser, own)).toEqual({
      mode: 'only',
      fieldIds: ['f-email', 'f-name'],
      componentFields: 'public',
    });
    expect(rowReadMask(policy, appUser, others)).toEqual({
      mode: 'only',
      fieldIds: ['f-name'],
      componentFields: 'public',
    });
    // Anonymous callers own nothing.
    expect(rowReadMask(policy, anonymous, own)).toEqual({
      mode: 'only',
      fieldIds: ['f-name'],
      componentFields: 'public',
    });
  });

  it('uses the read mask when it applies to every row', () => {
    const uniform: Policy = { ...policy, rowReadMasks: null };
    expect(rowReadMask(uniform, appUser, others)).toBe(uniform.readMask);
    expect(everyRowReadMask(uniform)).toBe(uniform.readMask);
    expect(everyRowReadMask(policy)).toEqual({
      mode: 'only',
      fieldIds: ['f-name'],
      componentFields: 'public',
    });
  });
});
