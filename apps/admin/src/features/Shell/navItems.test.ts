import { describe, expect, it } from 'vitest';
import { isVisible, NETWORK_ITEMS, WORKSPACE_ITEMS, type NavAccess } from './navItems';

const siteSchemaAdmin: NavAccess = {
  globalPermissions: ['schema.create'],
  networkPermissions: [],
  schema: true,
};
const networkSchemaAdmin: NavAccess = {
  globalPermissions: ['schema.create'],
  networkPermissions: ['schema.create'],
  schema: true,
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
