import { describe, expect, it } from 'vitest';
import type { OpenApiDocument } from '@/api/apiDocs';
import { deliveryOperations, groupOperations } from './operations';

const DOCUMENT: OpenApiDocument = {
  info: { title: 'Shapio content API', version: '1.0.0+schema.4' },
  tags: [{ name: 'Article' }, { name: 'Home' }],
  paths: {
    '/api/content/homepage': {
      get: {
        operationId: 'listHomepage',
        summary: 'Read the published Home',
        tags: ['Home'],
        parameters: [],
      },
    },
    '/api/content/articles': {
      get: {
        operationId: 'listArticle',
        summary: 'List published Article entries',
        tags: ['Article'],
        parameters: [
          { name: 'filters', in: 'query' },
          { name: 'locale', in: 'query' },
        ],
      },
    },
    '/api/content/articles/{id}': {
      get: {
        operationId: 'getArticle',
        summary: 'Read one',
        tags: ['Article'],
        parameters: [{ name: 'id', in: 'path' }],
      },
    },
    '/api/admin/content/article': { get: { operationId: 'adminListArticle', tags: ['Article'] } },
  },
};

describe('delivery operations from OpenAPI', () => {
  it('keeps the delivery GETs only, with their route key and kind', () => {
    const operations = deliveryOperations(DOCUMENT);
    expect(operations.map((operation) => operation.id)).toEqual([
      'listHomepage',
      'listArticle',
      'getArticle',
    ]);
    expect(operations[1]).toMatchObject({ routeKey: 'articles', list: true, byId: false });
    expect(operations[2]).toMatchObject({ routeKey: 'articles', list: false, byId: true });
  });

  it('groups them by place in the document’s tag order', () => {
    const groups = groupOperations(DOCUMENT, deliveryOperations(DOCUMENT));
    expect(groups.map((group) => [group.tag, group.operations.length])).toEqual([
      ['Article', 2],
      ['Home', 1],
    ]);
  });
});
