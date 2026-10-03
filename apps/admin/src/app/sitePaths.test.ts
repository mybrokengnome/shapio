import { describe, expect, it } from 'vitest';
import { isNetworkPath, isSitelessPath, needsSitePrefix, splitSitePath, withSitePrefix } from './sitePaths';

describe('splitSitePath', () => {
  it('reads the site key and the rest of the path', () => {
    expect(splitSitePath('/s/blog/content/posts')).toEqual({ key: 'blog', rest: '/content/posts' });
    expect(splitSitePath('/s/blog/')).toEqual({ key: 'blog', rest: '/' });
    expect(splitSitePath('/s/blog')).toEqual({ key: 'blog', rest: '/' });
  });

  it('leaves paths without a valid site prefix alone', () => {
    expect(splitSitePath('/content')).toEqual({ key: undefined, rest: '/content' });
    expect(splitSitePath('/s/Blog/content')).toEqual({ key: undefined, rest: '/s/Blog/content' });
    expect(splitSitePath('/settings/x')).toEqual({ key: undefined, rest: '/settings/x' });
  });
});

describe('withSitePrefix', () => {
  it('prefixes site pages', () => {
    expect(withSitePrefix('/', 'blog')).toBe('/s/blog/');
    expect(withSitePrefix('/content/posts', 'blog')).toBe('/s/blog/content/posts');
  });

  it('never prefixes network pages and signed-out screens', () => {
    expect(withSitePrefix('/network/sites', 'blog')).toBe('/network/sites');
    expect(withSitePrefix('/network', 'blog')).toBe('/network');
    expect(withSitePrefix('/login', 'blog')).toBe('/login');
    expect(withSitePrefix('/accept-invitation', 'blog')).toBe('/accept-invitation');
  });

  it('leaves the path alone while the site is unknown', () => {
    expect(withSitePrefix('/content', undefined)).toBe('/content');
  });

  it('does not mistake a path that merely starts like a siteless one', () => {
    expect(withSitePrefix('/networking', 'blog')).toBe('/s/blog/networking');
  });
});

describe('needsSitePrefix and the siteless checks', () => {
  it('flags site pages without a site', () => {
    expect(needsSitePrefix('/')).toBe(true);
    expect(needsSitePrefix('/content/posts')).toBe(true);
    expect(needsSitePrefix('/s/blog/content')).toBe(false);
    expect(needsSitePrefix('/network/users')).toBe(false);
    expect(needsSitePrefix('/reset-password')).toBe(false);
  });

  it('tells network pages apart', () => {
    expect(isNetworkPath('/network/sites')).toBe(true);
    expect(isNetworkPath('/content')).toBe(false);
    expect(isSitelessPath('/setup')).toBe(true);
  });
});
