import { describe, expect, it } from 'vitest';
import type { PermissionGrantRow } from '../repositories/adminRoles.js';
import { toGrant } from './cache.js';

const row = (overrides: Partial<PermissionGrantRow> = {}): PermissionGrantRow => ({
  role_id: 'role-1',
  action: 'read',
  model_id: 'model-1',
  condition: null,
  field_ids: null,
  ...overrides,
});

describe('toGrant', () => {
  it('reads a known unconditional grant', () => {
    expect(toGrant(row())).toEqual({
      roleId: 'role-1',
      action: 'read',
      modelId: 'model-1',
      condition: null,
      fieldIds: null,
    });
  });

  it('keeps a known row condition', () => {
    expect(toGrant(row({ condition: 'ownedByPrincipal' }))?.condition).toBe('ownedByPrincipal');
  });

  it('drops a grant whose action this build does not know', () => {
    expect(toGrant(row({ action: 'teleport' }))).toBeUndefined();
  });

  it('drops a grant whose row condition this build does not know, never widening it to every row', () => {
    expect(toGrant(row({ condition: 'sameTeamAsPrincipal' }))).toBeUndefined();
  });
});
