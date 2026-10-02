import type { AppRolePermission } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { ALL_MODELS } from '../constants';
import {
  columnState,
  hasOptions,
  setColumn,
  setGranted,
  toMatrix,
  toPermissions,
  updateGrant,
} from './permissionMatrix';

const permissions: AppRolePermission[] = [
  { action: 'read', modelId: null, condition: null, fieldIds: null },
  { action: 'update', modelId: 'm-post', condition: 'ownedByPrincipal', fieldIds: ['f-title', 'f-body'] },
  { action: 'create', modelId: 'm-post', condition: null, fieldIds: ['f-title'] },
];

describe('permission matrix', () => {
  it('round-trips grants in a stable order', () => {
    expect(toPermissions(toMatrix(permissions))).toEqual([
      { action: 'read', modelId: null, condition: null, fieldIds: null },
      { action: 'create', modelId: 'm-post', condition: null, fieldIds: ['f-title'] },
      { action: 'update', modelId: 'm-post', condition: 'ownedByPrincipal', fieldIds: ['f-body', 'f-title'] },
    ]);
  });

  it('grants and revokes cells, keeping options while granted', () => {
    let matrix = toMatrix(permissions);
    matrix = setGranted(matrix, 'm-post', 'delete', true);
    matrix = updateGrant(matrix, 'm-post', 'delete', { ownOnly: true });
    expect(toPermissions(matrix)).toContainEqual({
      action: 'delete',
      modelId: 'm-post',
      condition: 'ownedByPrincipal',
      fieldIds: null,
    });
    matrix = setGranted(matrix, 'm-post', 'update', false);
    expect(toPermissions(matrix).some((p) => p.action === 'update')).toBe(false);
    // Updating a cell that is not granted changes nothing.
    expect(updateGrant(matrix, 'm-other', 'read', { ownOnly: true })).toBe(matrix);
  });

  it('drops options that mean nothing for the action', () => {
    const matrix = {
      'm-post': { create: { ownOnly: true, fieldIds: null }, delete: { ownOnly: false, fieldIds: ['x'] } },
    };
    expect(toPermissions(matrix)).toEqual([
      { action: 'create', modelId: 'm-post', condition: null, fieldIds: null },
      { action: 'delete', modelId: 'm-post', condition: null, fieldIds: null },
    ]);
  });

  it('offers options only where they apply', () => {
    expect(hasOptions(ALL_MODELS, { create: { ownOnly: false, fieldIds: null } })).toBe(false);
    expect(hasOptions(ALL_MODELS, { update: { ownOnly: false, fieldIds: null } })).toBe(true);
    expect(hasOptions('m-post', { create: { ownOnly: false, fieldIds: null } })).toBe(true);
    expect(hasOptions('m-post', {})).toBe(false);
  });

  it('grants and revokes a whole column, keeping the options of rows that already had the action', () => {
    const matrix = toMatrix(permissions);
    const keys = [ALL_MODELS, 'm-post', 'm-page'];
    expect(columnState(matrix, keys, 'update')).toBe('indeterminate');
    const granted = setColumn(matrix, keys, 'update', true);
    expect(columnState(granted, keys, 'update')).toBe(true);
    expect(granted['m-post']?.update).toEqual({ ownOnly: true, fieldIds: ['f-body', 'f-title'] });
    expect(granted['m-page']?.update).toEqual({ ownOnly: false, fieldIds: null });
    expect(columnState(setColumn(granted, keys, 'update', false), keys, 'update')).toBe(false);
  });
});
