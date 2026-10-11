import { describe, expect, it } from 'vitest';
import { isVisible, NETWORK_ITEMS, WORKSPACE_ITEMS, type NavAccess } from './navItems';

const siteSchemaAdmin: NavAccess = {
  globalPermissions: ['schema.create'],
  networkPermissions: [],
  schema: true,
  network: false,
};
const networkSchemaAdmin: NavAccess = {
  globalPermissions: ['schema.create'],
  networkPermissions: ['schema.create'],
  schema: true,
  network: true,
};

const item = (items: typeof NETWORK_ITEMS, key: string) => {
  const found = items.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`no nav item ${key}`);
  }
  return found;
};

describe('isVisible', () => {
  it("doesn't count a site role's schema.create for every-site pages (locales, shared content types)", () => {
    for (const found of [item(WORKSPACE_ITEMS, 'locales'), item(NETWORK_ITEMS, 'contentTypes')]) {
      expect(isVisible(found, siteSchemaAdmin)).toBe(false);
      expect(isVisible(found, networkSchemaAdmin)).toBe(true);
    }
  });
});

describe('workspace items', () => {
  const siteUsersAdmin: NavAccess = {
    globalPermissions: ['users.manage'],
    networkPermissions: [],
    schema: false,
    network: false,
  };
  const networkUsersAdmin: NavAccess = {
    globalPermissions: ['users.manage'],
    networkPermissions: ['users.manage'],
    schema: false,
    network: true,
  };
  const visibleKeys = (access: NavAccess) =>
    WORKSPACE_ITEMS.filter((found) => isVisible(found, access)).map((found) => found.key);

  it('lists Team before App users and Network last, linking into the network view', () => {
    expect(visibleKeys(networkUsersAdmin)).toEqual(['team', 'appUsers', 'settings', 'network']);
    expect(item(WORKSPACE_ITEMS, 'team').to).toBe('/network/users');
    expect(item(WORKSPACE_ITEMS, 'network').to).toBe('/network');
    expect(item(WORKSPACE_ITEMS, 'team').icon).not.toBe(item(WORKSPACE_ITEMS, 'appUsers').icon);
  });

  it('shows Team and Network only to admins who can open the network view', () => {
    expect(visibleKeys(siteUsersAdmin)).toEqual(['appUsers', 'settings']);
    expect(visibleKeys(networkSchemaAdmin)).toEqual(['locales', 'settings', 'network']);
  });
});
