import { describe, expect, it } from 'vitest';
import { createSiteRewrite } from './siteRewrite';

const run = (fn: ReturnType<typeof createSiteRewrite>['input'], href: string) => {
  const result = fn?.({ url: new URL(href, 'http://admin.test') });
  return result instanceof URL ? `${result.pathname}${result.search}` : String(result);
};

describe('createSiteRewrite', () => {
  it('reads site URLs as site-free router paths, keeping the query', () => {
    const rewrite = createSiteRewrite(() => 'blog');
    expect(run(rewrite.input, '/s/blog/content/posts?tab=api')).toBe('/content/posts?tab=api');
    expect(run(rewrite.input, '/s/blog')).toBe('/');
    expect(run(rewrite.input, '/network/sites')).toBe('/network/sites');
  });

  it('writes router paths back with the current site', () => {
    const rewrite = createSiteRewrite(() => 'blog');
    expect(run(rewrite.output, '/content/posts?tab=api')).toBe('/s/blog/content/posts?tab=api');
    expect(run(rewrite.output, '/')).toBe('/s/blog/');
    expect(run(rewrite.output, '/network/users')).toBe('/network/users');
    expect(run(rewrite.output, '/login?redirect=%2Fcontent')).toBe('/login?redirect=%2Fcontent');
  });

  it('follows the site once it is known', () => {
    const site: { key: string | undefined } = { key: undefined };
    const rewrite = createSiteRewrite(() => site.key);
    expect(run(rewrite.output, '/content')).toBe('/content');
    site.key = 'default';
    expect(run(rewrite.output, '/content')).toBe('/s/default/content');
  });
});
