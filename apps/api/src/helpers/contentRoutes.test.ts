import { describe, expect, it } from 'vitest';
import { MAX_ROUTE_PARAM_LENGTH, rewriteContentUrl } from './contentRoutes.js';

const ID = '0b2f4c1e-7d3a-4f5b-9c8d-1e2f3a4b5c6d';

describe('rewriteContentUrl', () => {
  it.each([
    // A root's key and its entries stay as they are.
    ['/api/content/products', '/api/content/products'],
    [`/api/content/products/${ID}`, `/api/content/products/${ID}`],
    ['/api/content/products?sort=price&page=2', '/api/content/products?sort=price&page=2'],
    // A nested key becomes one encoded segment; the ID and the query stay.
    ['/api/content/products/digital', '/api/content/products%2Fdigital'],
    [`/api/content/products/digital/${ID}`, `/api/content/products%2Fdigital/${ID}`],
    [
      `/api/content/products/physical/apparel/${ID}?locale=fr`,
      `/api/content/products%2Fphysical%2Fapparel/${ID}?locale=fr`,
    ],
    [
      '/api/content/products/digital?filters[price][$gte]=10',
      '/api/content/products%2Fdigital?filters[price][$gte]=10',
    ],
    // Keys that look like actions are keys like any other: the route resolver answers 404 for them.
    ['/api/content/products/publish', '/api/content/products%2Fpublish'],
    [`/api/content/posts/revisions/${ID}`, `/api/content/posts%2Frevisions/${ID}`],
    // Already encoded: left alone.
    ['/api/content/products%2Fdigital', '/api/content/products%2Fdigital'],
    [`/api/content/products%2Fdigital/${ID}`, `/api/content/products%2Fdigital/${ID}`],
    // Previews take route keys too.
    [`/api/preview/content/products/digital/${ID}`, `/api/preview/content/products%2Fdigital/${ID}`],
  ])('%s → %s', (url, expected) => {
    expect(rewriteContentUrl(url, '')).toBe(expected);
  });

  it('leaves every other path alone, admin content routes included', () => {
    for (const url of [
      `/api/admin/content/product/${ID}/publish`,
      `/api/admin/content/product/${ID}/revisions`,
      '/api/admin/models/products/digital',
      '/api/contents/products/digital',
      '/api/graphql',
      '/products/digital',
      '/',
    ]) {
      expect(rewriteContentUrl(url, '')).toBe(url);
    }
  });

  it('strips BASE_PATH before matching, and keeps it', () => {
    expect(rewriteContentUrl(`/cms/api/content/products/digital/${ID}`, '/cms')).toBe(
      `/cms/api/content/products%2Fdigital/${ID}`,
    );
    // Without the base path the URL is not a content route of this server.
    expect(rewriteContentUrl('/api/content/products/digital', '/cms')).toBe('/api/content/products/digital');
  });

  it('leaves a path whose segments do not decode to Fastify', () => {
    expect(rewriteContentUrl('/api/content/products/%E0%A4%A', '')).toBe('/api/content/products/%E0%A4%A');
  });

  it('takes at most eight levels as the key', () => {
    const levels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect(rewriteContentUrl(`/api/content/${levels.join('/')}`, '')).toBe(
      `/api/content/${levels.slice(0, 8).join('%2F')}/i`,
    );
  });

  it('allows the longest encoded key as a route param', () => {
    const longest = Array.from({ length: 8 }, () => 'x'.repeat(64)).join('/');
    expect(encodeURIComponent(longest).length).toBeLessThanOrEqual(MAX_ROUTE_PARAM_LENGTH);
  });
});
