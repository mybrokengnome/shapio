import { describe, expect, it } from 'vitest';
import type { Policy, Principal } from '../../permissions/types.js';
import { everyRowReadMask, ownershipOfNewEntry, pickMasked, rowReadMask, rowWriteMask } from './policy.js';

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
  writeMask: { mode: 'only', fieldIds: ['f-name', 'f-bio'], componentFields: 'public' },
  rowWriteMasks: {
    everyRow: { mode: 'only', fieldIds: ['f-bio'], componentFields: 'public' },
    when: [
      {
        condition: { kind: 'ownedByPrincipal' },
        mask: { mode: 'only', fieldIds: ['f-name'], componentFields: 'public' },
      },
    ],
  },
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

describe('write masks on one entry (issue #80)', () => {
  it('adds a conditioned write mask only on rows matching its condition', () => {
    expect(rowWriteMask(policy, appUser, own)).toEqual({
      mode: 'only',
      fieldIds: ['f-bio', 'f-name'],
      componentFields: 'public',
    });
    expect(rowWriteMask(policy, appUser, others)).toEqual({
      mode: 'only',
      fieldIds: ['f-bio'],
      componentFields: 'public',
    });
    expect(rowWriteMask(policy, anonymous, own)).toEqual({
      mode: 'only',
      fieldIds: ['f-bio'],
      componentFields: 'public',
    });
  });

  it('uses the write mask when it applies to every row', () => {
    const uniform: Policy = { ...policy, rowWriteMasks: null };
    expect(rowWriteMask(uniform, appUser, others)).toBe(uniform.writeMask);
  });

  it('treats a new entry as owned by the app user or admin creating it', () => {
    expect(rowWriteMask(policy, appUser, ownershipOfNewEntry(appUser))).toEqual({
      mode: 'only',
      fieldIds: ['f-bio', 'f-name'],
      componentFields: 'public',
    });
    const admin: Principal = {
      kind: 'admin',
      adminUserId: 'a-1',
      sessionId: 'x',
      assignments: [],
      siteId: 's',
      roleIds: [],
      networkRoleIds: [],
    };
    expect(ownershipOfNewEntry(admin)).toEqual({ created_by_admin_id: 'a-1', owner_app_user_id: null });
    // Tokens and anonymous callers own nothing, so only the every-row mask applies.
    expect(rowWriteMask(policy, anonymous, ownershipOfNewEntry(anonymous))).toEqual({
      mode: 'only',
      fieldIds: ['f-bio'],
      componentFields: 'public',
    });
  });
});

describe('values a mask covers', () => {
  const data = { 'f-name': 'Ada', 'f-email': 'ada@example.com', 'f-old': 'kept' };

  it('keeps only the fields a narrowed mask names', () => {
    expect(pickMasked({ mode: 'only', fieldIds: ['f-name'], componentFields: 'public' }, data)).toEqual({
      'f-name': 'Ada',
    });
    expect(pickMasked({ mode: 'only', fieldIds: [], componentFields: 'public' }, data)).toEqual({});
  });

  it('keeps every value under a wildcard mask, deprecated fields included', () => {
    const picked = pickMasked({ mode: 'all' }, data);
    expect(picked).toEqual(data);
    expect(picked).not.toBe(data);
  });
});
