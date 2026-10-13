import { createDefinitionIndex, normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import {
  counterpartOperationId,
  graphqlOperations,
  graphqlQuery,
  parseFilterKey,
  restOperationFor,
} from './graphqlQuery';
import type { DeliveryOperation } from './operations';
import { EMPTY_DRAFT, type RequestDraft } from './request';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const article = normalizeDefinition({
  id: uuid(1),
  kind: 'collection',
  apiKey: 'article',
  pluralApiKey: 'articles',
  label: 'Article',
  fields: [
    { id: uuid(11), apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    { id: uuid(12), apiKey: 'views', label: 'Views', type: 'integer', sortable: true },
    { id: uuid(13), apiKey: 'featured', label: 'Featured', type: 'boolean' },
    { id: uuid(14), apiKey: 'body', label: 'Body', type: 'richtext' },
    { id: uuid(15), apiKey: 'author', label: 'Author', type: 'relation', settings: { target: uuid(1) } },
    { id: uuid(16), apiKey: 'old', label: 'Old', type: 'string', deprecated: true },
  ],
}) as ModelDefinition;

const home = normalizeDefinition({
  id: uuid(2),
  kind: 'singleton',
  apiKey: 'home',
  label: 'Home',
  fields: [{ id: uuid(21), apiKey: 'headline', label: 'Headline', type: 'string' }],
}) as ModelDefinition;

const [listOperation, singleOperation] = graphqlOperations(article) as [
  ReturnType<typeof graphqlOperations>[number],
  ReturnType<typeof graphqlOperations>[number],
];

const draft = (patch: Partial<RequestDraft>): RequestDraft => ({ ...EMPTY_DRAFT, ...patch });
const row = (key: string, value: string, id = key) => ({ id, key, value });

const rest = (patch: Partial<DeliveryOperation>): DeliveryOperation => ({
  id: 'listArticle',
  path: '/api/content/articles',
  summary: '',
  tag: 'Article',
  routeKey: 'articles',
  byId: false,
  list: true,
  parameters: [],
  ...patch,
});

describe('graphqlQuery', () => {
  it('lists every live field with no arguments for an empty draft', () => {
    expect(graphqlQuery(article, listOperation, EMPTY_DRAFT)).toEqual({
      query:
        'query {\n  articles {\n    totalCount\n    nodes {\n      id\n      title\n      views\n      featured\n      body { html }\n      author { id }\n    }\n  }\n}\n',
      skipped: [],
    });
  });

  it('carries the REST filters, sort, search, page, locale and snapshot over as arguments', () => {
    const { query, skipped } = graphqlQuery(
      article,
      listOperation,
      draft({
        filters: [
          row('title][$contains', 'explorer'),
          row('views[$gt]', '3'),
          row('featured', 'true'),
          row('id][$in', 'a,b'),
          row('createdAt.$null', 'false'),
        ],
        sort: 'views:desc,title',
        q: 'hello "world"',
        page: '2',
        pageSize: '5',
        locale: 'fr',
        snapshot: '12',
      }),
    );
    expect(query).toContain(
      'articles(filter: { title: { contains: "explorer" }, views: { gt: 3 }, featured: { eq: true }, id: { in: ["a", "b"] }, createdAt: { null: false } }, sort: [{ views: DESC }, { title: ASC }], search: "hello \\"world\\"", page: 2, pageSize: 5, locale: "fr", snapshot: 12) {',
    );
    expect(skipped).toEqual([]);
  });

  it('collects indexed list values and keeps what it cannot translate aside', () => {
    const { query, skipped } = graphqlQuery(
      article,
      listOperation,
      draft({
        filters: [
          row('views][$in][0', '1', 'a'),
          row('views][$in][1', '2', 'b'),
          row('$or][0][title][$eq', 'x'),
          row('author.name.$eq', 'Ana'),
          row('missing][$eq', 'y'),
          row('old][$eq', 'z'),
        ],
        sort: 'nope:sideways',
        populate: 'author',
      }),
    );
    expect(query).toContain('articles(filter: { views: { in: [1, 2] } }) {');
    expect(skipped).toEqual([
      'populate',
      'filters[$or][0][title][$eq]',
      'filters[author][name][$eq]',
      'filters[missing][$eq]',
      'filters[old][$eq]',
      'sort',
    ]);
  });

  it('reads one entry by the draft ID, or declares $id while it is empty', () => {
    expect(graphqlQuery(article, singleOperation, draft({ fields: 'title' })).query).toBe(
      'query ($id: ID!) {\n  article(id: $id) {\n    id\n    title\n  }\n}\n',
    );
    expect(
      graphqlQuery(article, singleOperation, draft({ id: 'abc', locale: 'de', fields: 'title,nope' })).query,
    ).toBe('query {\n  article(id: "abc", locale: "de") {\n    id\n    title\n  }\n}\n');
  });

  it('reads a singleton without an ID', () => {
    const [operation] = graphqlOperations(home);
    expect(operation && graphqlQuery(home, operation, EMPTY_DRAFT).query).toBe(
      'query {\n  home {\n    id\n    headline\n  }\n}\n',
    );
  });
});

describe('parseFilterKey', () => {
  it('reads field and operator in every spelling and refuses logical or nested keys', () => {
    expect(parseFilterKey('title][$contains')).toEqual({ name: 'title', operator: '$contains' });
    expect(parseFilterKey('filters[title][$eq]')).toEqual({ name: 'title', operator: '$eq' });
    expect(parseFilterKey('title')).toEqual({ name: 'title', operator: '$eq' });
    expect(parseFilterKey('tags][$in][2')).toEqual({ name: 'tags', operator: '$in' });
    expect(parseFilterKey('title][$eq][0')).toBeUndefined();
    expect(parseFilterKey('title][$like')).toBeUndefined();
    expect(parseFilterKey('$or][0][title')).toBeUndefined();
  });
});

describe('restOperationFor', () => {
  const operations = [
    rest({}),
    rest({ id: 'getArticle', path: '/api/content/articles/{id}', byId: true, list: false }),
    rest({ id: 'getHome', path: '/api/content/home', routeKey: 'home', tag: 'Home', list: false }),
  ];

  it('pairs the list, the read by ID and the singleton read with their REST endpoints', () => {
    expect(restOperationFor(article, listOperation, operations)?.id).toBe('listArticle');
    expect(restOperationFor(article, singleOperation, operations)?.id).toBe('getArticle');
    const [homeOperation] = graphqlOperations(home);
    expect(homeOperation && restOperationFor(home, homeOperation, operations)?.id).toBe('getHome');
  });

  it('keeps the endpoint when switching tabs, both ways', () => {
    const models = [article, home];
    expect(counterpartOperationId('graphql', 'listArticle', models, operations)).toBe('graphql:articles');
    expect(counterpartOperationId('graphql', 'getArticle', models, operations)).toBe('graphql:article');
    expect(counterpartOperationId('graphql', 'getHome', models, operations)).toBe('graphql:home');
    expect(counterpartOperationId('rest', 'graphql:articles', models, operations)).toBe('listArticle');
    expect(counterpartOperationId('rest', 'graphql:article', models, operations)).toBe('getArticle');
    expect(counterpartOperationId('rest', 'graphql:nope', models, operations)).toBeUndefined();
    expect(counterpartOperationId('graphql', undefined, models, operations)).toBeUndefined();
  });
});

describe('a type with kinds', () => {
  const product = normalizeDefinition({
    id: uuid(3),
    kind: 'collection',
    apiKey: 'product',
    pluralApiKey: 'products',
    label: 'Product',
    fields: [{ id: uuid(31), apiKey: 'price', label: 'Price', type: 'integer', sortable: true }],
  }) as ModelDefinition;
  const kindOf = (n: number, apiKey: string, pluralApiKey: string, parent: number, field: string) =>
    normalizeDefinition({
      id: uuid(n),
      kind: 'collection',
      apiKey,
      pluralApiKey,
      label: apiKey,
      extends: uuid(parent),
      fields: [{ id: uuid(n * 10 + 1), apiKey: field, label: field, type: 'string' }],
    }) as ModelDefinition;
  const physical = kindOf(4, 'physicalProduct', 'physical', 3, 'weight');
  const apparel = kindOf(5, 'apparel', 'apparels', 4, 'size');
  const digital = kindOf(6, 'digitalProduct', 'digital', 3, 'downloadUrl');
  const index = createDefinitionIndex([product, physical, apparel, digital]);

  it('selects __typename and a fragment per kind, on the interface of a kind that has kinds', () => {
    const [list] = graphqlOperations(product);
    expect(list && graphqlQuery(product, list, EMPTY_DRAFT, index).query).toBe(
      [
        'query {',
        '  products {',
        '    totalCount',
        '    nodes {',
        '      __typename',
        '      id',
        '      price',
        '      ... on PhysicalProductInterface {',
        '        weight',
        '      }',
        '      ... on Apparel {',
        '        size',
        '      }',
        '      ... on DigitalProduct {',
        '        downloadUrl',
        '      }',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('reads a kind with its inherited fields and pairs it with its nested REST path', () => {
    const [list] = graphqlOperations(digital);
    expect(list && graphqlQuery(digital, list, draft({ sort: 'price:desc' }), index).query).toBe(
      'query {\n  digital(sort: [{ price: DESC }]) {\n    totalCount\n    nodes {\n      id\n      price\n      downloadUrl\n    }\n  }\n}\n',
    );
    const operations = [rest({ id: 'listDigital', routeKey: 'products/digital' })];
    expect(list && restOperationFor(digital, list, operations, index)?.id).toBe('listDigital');
    expect(counterpartOperationId('graphql', 'listDigital', [product, digital], operations, index)).toBe(
      'graphql:digital',
    );
  });
});
