import { describe, expect, it } from 'vitest';
import { canSeeNetwork, hasSiteRole, withSiteParameter } from './sites';

const site = (id: string) => ({ id, key: id, name: id, isPrimary: id === 'a' });

describe('hasSiteRole', () => {
  it('is true only when the answered site is one the admin works on', () => {
    expect(hasSiteRole({ site: site('a'), sites: [site('a'), site('b')] })).toBe(true);
    expect(hasSiteRole({ site: site('a'), sites: [site('b')] })).toBe(false);
    expect(hasSiteRole({ site: site('a'), sites: [] })).toBe(false);
  });
});

describe('canSeeNetwork', () => {
  it('needs a network action', () => {
    expect(canSeeNetwork({ networkPermissions: ['audit.read'] })).toBe(true);
    expect(canSeeNetwork({ networkPermissions: [] })).toBe(false);
    expect(canSeeNetwork(undefined)).toBe(false);
  });
});

describe('withSiteParameter', () => {
  it('adds ?site= for a site other than the primary one', () => {
    expect(withSiteParameter('/api/content/posts', 'blog')).toBe('/api/content/posts?site=blog');
    expect(withSiteParameter('/api/content/posts?locale=en', 'blog')).toBe(
      '/api/content/posts?locale=en&site=blog',
    );
    expect(withSiteParameter('/api/content/posts', undefined)).toBe('/api/content/posts');
  });
});
