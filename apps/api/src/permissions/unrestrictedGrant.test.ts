import { describe, expect, it } from 'vitest';
import { ALLOW_ALL_POLICY, buildPolicy, type Grant, type ModelField } from './policy.js';
import { DENIED_POLICY } from './types.js';
import { hasUnrestrictedGrant } from './unrestrictedGrant.js';

const MODEL = 'm';
/** Field A public; B and C made private. */
const FIELDS: readonly ModelField[] = [
  { id: 'a', public: true },
  { id: 'b', public: false },
  { id: 'c', public: false },
];
const grant = (overrides: Partial<Grant>): Grant => ({
  roleId: 'r',
  action: 'read',
  modelId: MODEL,
  condition: null,
  fieldIds: null,
  ...overrides,
});

describe('hasUnrestrictedGrant', () => {
  it('is false for a grant naming fields, even when its mask covers every public field', () => {
    const policy = buildPolicy(
      [grant({ fieldIds: ['a'] })],
      { action: 'read', modelId: MODEL },
      'delivery',
      FIELDS,
    );
    expect(policy.readMask).toEqual({ mode: 'only', fieldIds: ['a'], componentFields: 'public' });
    expect(hasUnrestrictedGrant(policy, 'read')).toBe(false);
  });

  it('is true when any grant names no fields (one role of several is enough), conditions or not', () => {
    const policy = buildPolicy(
      [grant({ fieldIds: ['a'] }), grant({ roleId: 'r2', condition: 'ownedByPrincipal' })],
      { action: 'read', modelId: MODEL },
      'delivery',
      FIELDS,
    );
    expect(hasUnrestrictedGrant(policy, 'read')).toBe(true);
  });

  it('judges writes by the write grants, and never a denied policy', () => {
    const update = buildPolicy(
      [grant({}), grant({ action: 'update', fieldIds: ['a'] })],
      { action: 'update', modelId: MODEL },
      'delivery',
      FIELDS,
    );
    expect(hasUnrestrictedGrant(update, 'read')).toBe(true);
    expect(hasUnrestrictedGrant(update, 'write')).toBe(false);
    expect(hasUnrestrictedGrant(DENIED_POLICY, 'read')).toBe(false);
    expect(hasUnrestrictedGrant(ALLOW_ALL_POLICY, 'write')).toBe(true);
  });
});
