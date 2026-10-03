import { describe, expect, it } from 'vitest';
import { AppError } from '../helpers/appError.js';
import { assignmentsOf, holdsOwner, roleIdsOf, sortAssignments } from './roleAssignments.js';

describe('role assignments', () => {
  it('reads either form: assignments as given, deprecated roleIds as those roles on every site', () => {
    expect(assignmentsOf({ assignments: [{ roleId: 'r', siteId: 's' }] })).toEqual([
      { roleId: 'r', siteId: 's' },
    ]);
    expect(assignmentsOf({ roleIds: ['r1', 'r2'] })).toEqual([
      { roleId: 'r1', siteId: null },
      { roleId: 'r2', siteId: null },
    ]);
    expect(assignmentsOf({})).toBeUndefined();
    expect(() => assignmentsOf({ assignments: [], roleIds: [] })).toThrow(AppError);
  });

  it('sorts by role, every site first, then by site; lists distinct roles', () => {
    const sorted = sortAssignments([
      { roleId: 'b', siteId: 's2' },
      { roleId: 'a', siteId: 's1' },
      { roleId: 'b', siteId: null },
      { roleId: 'b', siteId: 's1' },
    ]);
    expect(sorted).toEqual([
      { roleId: 'a', siteId: 's1' },
      { roleId: 'b', siteId: null },
      { roleId: 'b', siteId: 's1' },
      { roleId: 'b', siteId: 's2' },
    ]);
    expect(roleIdsOf(sorted)).toEqual(['a', 'b']);
  });

  it('counts the owner role only where it is held on every site', () => {
    expect(holdsOwner([{ roleId: 'owner', siteId: null }], 'owner')).toBe(true);
    expect(holdsOwner([{ roleId: 'owner', siteId: 's' }], 'owner')).toBe(false);
  });
});
