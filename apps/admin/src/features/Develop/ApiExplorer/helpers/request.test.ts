import { describe, expect, it } from 'vitest';
import type { DeliveryOperation } from './operations';
import { curlSnippet, EMPTY_DRAFT, fetchSnippet, filterParamName, isSendable, requestPath } from './request';

const list: DeliveryOperation = {
  id: 'listArticle',
  path: '/api/content/articles',
  summary: '',
  tag: 'Article',
  routeKey: 'articles',
  byId: false,
  list: true,
  parameters: ['filters', 'sort', 'page', 'pageSize', 'q', 'fields', 'populate', 'locale', 'snapshot'].map(
    (name) => ({ name, in: 'query' as const }),
  ),
};
const byId: DeliveryOperation = {
  ...list,
  id: 'getArticle',
  path: '/api/content/articles/{id}',
  byId: true,
  list: false,
  parameters: ['fields', 'locale'].map((name) => ({ name, in: 'query' as const })),
};

describe('request building', () => {
  it('spells filter keys as deep objects', () => {
    expect(filterParamName('title[$contains]')).toBe('filters[title][$contains]');
    expect(filterParamName('author.name.$eq')).toBe('filters[author][name][$eq]');
    expect(filterParamName('filters[title][$eq]')).toBe('filters[title][$eq]');
  });

  it('adds only the parameters the operation takes', () => {
    const draft = {
      ...EMPTY_DRAFT,
      locale: 'de',
      snapshot: '41',
      sort: 'title:asc',
      filters: [{ id: '1', key: 'title[$contains]', value: 'hello world' }],
    };
    expect(requestPath(list, draft)).toBe(
      '/api/content/articles?locale=de&snapshot=41&sort=title%3Aasc&filters%5Btitle%5D%5B%24contains%5D=hello+world',
    );
    expect(requestPath(byId, { ...draft, id: 'abc' })).toBe('/api/content/articles/abc?locale=de');
  });

  it('needs the ID before a by-ID request can be sent', () => {
    expect(isSendable(byId, EMPTY_DRAFT)).toBe(false);
    expect(requestPath(byId, EMPTY_DRAFT)).toBe('/api/content/articles/{id}');
    expect(isSendable(byId, { ...EMPTY_DRAFT, id: 'abc' })).toBe(true);
  });

  it('never puts the token itself in a snippet', () => {
    const url = 'https://cms.test/api/content/articles';
    expect(curlSnippet(url, true)).toContain('Bearer $SHAPIO_TOKEN');
    expect(curlSnippet(url, false)).not.toContain('authorization');
    expect(fetchSnippet(url, true)).toContain('process.env.SHAPIO_TOKEN');
  });
});
