import { describe, expect, it } from 'vitest';
import { matchDeliveryRequest } from './request.js';

describe('matchDeliveryRequest', () => {
  it('matches the delivery reads the client sends', () => {
    expect(matchDeliveryRequest('GET', '/api/content/articles?locale=fr&populate=author')).toEqual({
      route: { kind: 'list', routeKey: 'articles' },
      query: 'locale=fr&populate=author',
      site: undefined,
    });
    expect(matchDeliveryRequest('GET', '/api/content/articles/abc%2Fdef')).toEqual({
      route: { kind: 'item', routeKey: 'articles', id: 'abc/def' },
      query: '',
      site: undefined,
    });
    expect(matchDeliveryRequest('GET', '/api/site')?.route).toEqual({ kind: 'site' });
    expect(matchDeliveryRequest('GET', '/api/snapshots/current')?.route).toEqual({ kind: 'snapshotCurrent' });
    expect(matchDeliveryRequest('GET', '/api/snapshots/changes?from=1')?.route).toEqual({
      kind: 'snapshotChanges',
    });
  });

  it('takes `site` out of the query, as site resolution does over HTTP', () => {
    expect(matchDeliveryRequest('GET', '/api/content/articles?locale=fr&site=blog&page=2')).toMatchObject({
      query: 'locale=fr&page=2',
      site: 'blog',
    });
    expect(matchDeliveryRequest('GET', '/api/site?site=')?.site).toBeUndefined();
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
      ['GET', 'api/site'],
      ['GET', '/api/content/%E0%A4%A'],
    ] as const) {
      expect(matchDeliveryRequest(method, path), `${method} ${path}`).toBeUndefined();
    }
  });
});
