import { describe, expect, it } from 'vitest';
import { canOnModel, canSeeDevelop, hasSchemaPermission } from './modelPermissions';

describe('canOnModel', () => {
  it('reads the per-model actions', () => {
    expect(
      canOnModel({ globalPermissions: [], modelPermissions: { m1: ['read', 'update'] } }, 'm1', 'update'),
    ).toBe(true);
    expect(canOnModel({ globalPermissions: [], modelPermissions: { m1: ['read'] } }, 'm1', 'create')).toBe(
      false,
    );
    expect(canOnModel({ globalPermissions: [], modelPermissions: {} }, 'm2', 'read')).toBe(false);
  });

  it('is false without a session', () => {
    expect(canOnModel(null, 'm1', 'read')).toBe(false);
  });
});

describe('hasSchemaPermission and canSeeDevelop', () => {
  it('count schema.create or schemaManage on any model', () => {
    expect(hasSchemaPermission({ globalPermissions: ['schema.create'], modelPermissions: {} })).toBe(true);
    expect(hasSchemaPermission({ globalPermissions: [], modelPermissions: { m1: ['schemaManage'] } })).toBe(
      true,
    );
    expect(hasSchemaPermission({ globalPermissions: [], modelPermissions: { m1: ['read'] } })).toBe(false);
  });

  it('shows Develop with tokens or webhooks management too', () => {
    expect(canSeeDevelop({ globalPermissions: ['tokens.manage'], modelPermissions: {} })).toBe(true);
    expect(canSeeDevelop({ globalPermissions: ['webhooks.manage'], modelPermissions: {} })).toBe(true);
    expect(canSeeDevelop({ globalPermissions: ['media.read'], modelPermissions: {} })).toBe(false);
    expect(canSeeDevelop(undefined)).toBe(false);
  });
});
