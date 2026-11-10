import { describe, expect, it } from 'vitest';
import { matchDeliveryRequest } from './request.js';

describe('matchDeliveryRequest', () => {
  it('matches the delivery reads the client sends', () => {
    expect(matchDeliveryRequest('GET', '/api/content/articles?locale=fr&populate=author')).toEqual({
      route: { kind: 'list', routeKey: 'articles' },
      query: 'locale=fr&populate=author',
      site: undefined,
      schemaVersion: null,
      schemaVersionError: null,
    });
    expect(matchDeliveryRequest('GET', '/api/content/articles/abc%2Fdef')).toEqual({
      route: { kind: 'item', routeKey: 'articles', id: 'abc/def' },
      query: '',
      site: undefined,
      schemaVersion: null,
      schemaVersionError: null,
    });
    expect(matchDeliveryRequest('GET', '/api/workspace')?.route).toEqual({ kind: 'site' });
    expect(matchDeliveryRequest('GET', '/api/site')?.route).toEqual({ kind: 'site' });
    expect(matchDeliveryRequest('GET', '/api/snapshots/current')?.route).toEqual({ kind: 'snapshotCurrent' });
    expect(matchDeliveryRequest('GET', '/api/snapshots/changes?from=1')?.route).toEqual({
      kind: 'snapshotChanges',
    });
  });

  it('matches nested route keys, as the server rewrites them (plan polymorphic-types)', () => {
    const id = '0b2f4c1e-7d3a-4f5b-9c8d-1e2f3a4b5c6d';
    expect(matchDeliveryRequest('GET', '/api/content/products/digital?sort=price')).toMatchObject({
      route: { kind: 'list', routeKey: 'products/digital' },
      query: 'sort=price',
    });
    expect(matchDeliveryRequest('GET', `/api/content/products/physical/apparel/${id}`)?.route).toEqual({
      kind: 'item',
      routeKey: 'products/physical/apparel',
      id,
    });
    expect(matchDeliveryRequest('GET', `/api/content/products%2Fdigital/${id}`)?.route).toEqual({
      kind: 'item',
      routeKey: 'products/digital',
      id,
    });
    expect(matchDeliveryRequest('GET', `/api/content/products/digital/${id}/extra`)).toBeUndefined();
  });

  it('takes `schemaVersion` out of the query on every route, as the schema lens plugin does over HTTP', () => {
    expect(
      matchDeliveryRequest('GET', '/api/content/articles?schemaVersion=abc-1:4&locale=fr'),
    ).toMatchObject({
      query: 'locale=fr',
      schemaVersion: 'abc-1:4',
    });
    expect(matchDeliveryRequest('GET', '/api/snapshots/changes?from=1&schemaVersion=abc:2')).toMatchObject({
      query: 'from=1',
      schemaVersion: 'abc:2',
    });
    // Kept for after authorization, never thrown while matching.
    expect(
      matchDeliveryRequest('GET', '/api/content/articles?schemaVersion=4')?.schemaVersionError,
    ).toMatchObject({
      code: 'SCHEMA_VERSION_INVALID',
    });
    expect(
      matchDeliveryRequest('GET', '/api/content/articles?schemaVersion=a:1&schemaVersion=a:2')
        ?.schemaVersionError,
    ).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('takes `site` out of the query, as site resolution does over HTTP', () => {
    expect(matchDeliveryRequest('GET', '/api/content/articles?locale=fr&site=blog&page=2')).toMatchObject({
      query: 'locale=fr&page=2',
      site: 'blog',
    });
    expect(matchDeliveryRequest('GET', '/api/site?site=')?.site).toBeUndefined();
  });

  it('takes `workspace` out of the query too, and accepts both spellings naming the same workspace', () => {
    expect(matchDeliveryRequest('GET', '/api/content/articles?workspace=blog&locale=fr')).toMatchObject({
      query: 'locale=fr',
      site: 'blog',
    });
    expect(matchDeliveryRequest('GET', '/api/workspace?workspace=blog&site=blog')).toMatchObject({
      query: '',
      site: 'blog',
    });
    expect(matchDeliveryRequest('GET', '/api/workspace?workspace=')?.site).toBeUndefined();
  });

  it('refuses two spellings naming different workspaces (403) and a repeated parameter (400)', () => {
    const failureOf = (path: string) => {
      try {
        matchDeliveryRequest('GET', path);
      } catch (error) {
        const { statusCode, code } = error as { statusCode: number; code: string };
        return `${statusCode} ${code}`;
      }
      return 'matched';
    };
    expect(failureOf('/api/content/articles?workspace=blog&site=shop')).toBe('403 SITE_MISMATCH');
    expect(failureOf('/api/content/articles?site=blog&site=shop')).toBe('400 INVALID_QUERY');
    expect(failureOf('/api/content/articles?workspace=blog&workspace=blog')).toBe('400 INVALID_QUERY');
  });

  it('matches nothing else: writes, previews, the admin API, GraphQL, unknown paths', () => {
    for (const [method, path] of [
      ['POST', '/api/content/articles'],
      ['DELETE', '/api/content/articles/1'],
      ['GET', '/api/preview/content/articles/1'],
      ['GET', '/api/admin/content/article'],
      ['GET', '/api/graphql?query={a}'],
      ['GET', '/api/content'],
      ['GET', '/api/content/articles/1/extra'],
      ['GET', '/api/snapshots'],
      ['GET', '/api/site/extra'],
      ['GET', '/api/workspace/extra'],
      ['GET', '/api/workspaces'],
      ['GET', 'api/site'],
      ['GET', '/api/content/%E0%A4%A'],
    ] as const) {
      expect(matchDeliveryRequest(method, path), `${method} ${path}`).toBeUndefined();
    }
  });
});
