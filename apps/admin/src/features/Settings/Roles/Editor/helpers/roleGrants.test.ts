import type { RolePermission } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { setGranted, updateGrant } from '../../PermissionMatrix/helpers/permissionMatrix';
import { joinGrants, splitGrants } from './roleGrants';

const grant = (
  action: RolePermission['action'],
  modelId: string | null = null,
  extra: Partial<RolePermission> = {},
): RolePermission => ({ action, modelId, condition: null, fieldIds: null, ...extra });

describe('role grants', () => {
  it('shows every grant of an admin role: per model, per field, every model, instance actions', () => {
    const permissions = [
      grant('read', 'm-article'),
      grant('update', 'm-article', { fieldIds: ['f-title'] }),
      grant('delete', 'm-article', { condition: 'ownedByPrincipal' }),
      grant('schemaManage', 'm-article'),
      grant('read', 'm-gone'),
      grant('read'),
      grant('media.read'),
    ];
    const split = splitGrants('admin', permissions);
    expect(split.matrix).toEqual({
      '*': { read: { ownOnly: false, fieldIds: null } },
      'm-article': {
        read: { ownOnly: false, fieldIds: null },
        update: { ownOnly: false, fieldIds: ['f-title'] },
        delete: { ownOnly: true, fieldIds: null },
        schemaManage: { ownOnly: false, fieldIds: null },
      },
      'm-gone': { read: { ownOnly: false, fieldIds: null } },
    });
    expect(split.actions).toEqual(['media.read']);
    expect(split.others).toEqual([]);
    // Saved unchanged, the same grants go back (stable order: every model first, then by model and action).
    expect(new Set(joinGrants('admin', split).map((p) => JSON.stringify(p)))).toEqual(
      new Set(permissions.map((p) => JSON.stringify(p))),
    );
  });

  it('builds the grant list from the matrix and the checkboxes', () => {
    let { matrix } = splitGrants('admin', []);
    matrix = setGranted(matrix, 'm-article', 'read', true);
    matrix = setGranted(matrix, 'm-article', 'update', true);
    matrix = updateGrant(matrix, 'm-article', 'update', { fieldIds: ['f-body', 'f-title'] });
    expect(joinGrants('admin', { matrix, actions: ['audit.read'], others: [] })).toEqual([
      grant('read', 'm-article'),
      grant('update', 'm-article', { fieldIds: ['f-body', 'f-title'] }),
      grant('audit.read'),
    ]);
  });

  it('gives delivery roles a read column and the read drafts checkbox', () => {
    const permissions = [grant('read', 'm-article', { fieldIds: ['f-title'] }), grant('readDrafts')];
    const split = splitGrants('delivery', permissions);
    expect(split.matrix).toEqual({ 'm-article': { read: { ownOnly: false, fieldIds: ['f-title'] } } });
    expect(split.actions).toEqual(['readDrafts']);
    expect(joinGrants('delivery', split)).toEqual(permissions);
  });

  it('keeps grants it has no place for', () => {
    const odd = grant('update', 'm-article');
    const split = splitGrants('delivery', [odd]);
    expect(split.others).toEqual([odd]);
    expect(joinGrants('delivery', split)).toEqual([odd]);
  });
});
