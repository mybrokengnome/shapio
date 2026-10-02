import { normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { parseContentQuery, type ParseContext } from '../../../content/compiler/parse.js';
import { parseQueryTree } from '../../../content/compiler/querystring.js';
import { AppError } from '../../../helpers/appError.js';
import { filterParams, scalarParams, sortParams, toRawQuery } from './queryArgs.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const model = normalizeDefinition({
  id: uuid(1),
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: uuid(2), apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    { id: uuid(3), apiKey: 'views', label: 'Views', type: 'integer', sortable: true },
    { id: uuid(4), apiKey: 'live', label: 'Live', type: 'boolean' },
    { id: uuid(5), apiKey: 'price', label: 'Price', type: 'decimal', filterable: true },
  ],
}) as ModelDefinition;

const context: ParseContext = {
  model,
  locales: ['en', 'fr'],
  isReadable: () => true,
  allowSnapshot: true,
  resolveModel: () => undefined,
};

const parse = (raw: string) => parseContentQuery(parseQueryTree(raw), context);

describe('GraphQL arguments → the REST querystring', () => {
  it.each([
    [{ title: { eq: 'Hello, world' } }, 'filters[title][$eq]=Hello, world'],
    [{ views: { gte: 3, lt: 10 } }, 'filters[views][$gte]=3&filters[views][$lt]=10'],
    [{ live: { eq: false } }, 'filters[live][$eq]=false'],
    [{ price: { in: ['1.50', '2'] } }, 'filters[price][$in][0]=1.50&filters[price][$in][1]=2'],
    [{ title: { null: true } }, 'filters[title][$null]=true'],
    [
      { or: [{ title: { startsWith: 'A' } }, { not: { views: { gt: 5 } } }] },
      'filters[$or][0][title][$startsWith]=A&filters[$or][1][$not][views][$gt]=5',
    ],
    [
      { and: [{ title: { containsi: 'x' } }], id: { eq: uuid(9) } },
      `filters[$and][0][title][$containsi]=x&filters[id][$eq]=${uuid(9)}`,
    ],
  ])('compiles %j exactly like its REST twin', (filter, rest) => {
    const viaGraphql = parse(toRawQuery(filterParams(filter)));
    const viaRest = parse(new URLSearchParams(rest).toString());
    expect(viaGraphql.filter).toEqual(viaRest.filter);
    expect(viaGraphql.filter).not.toBeNull();
  });

  it('keeps commas inside list values (REST would split them)', () => {
    const query = parse(toRawQuery(filterParams({ title: { in: ['a,b'] } })));
    expect(query.filter).toMatchObject({ operator: '$in', value: ['a,b'] });
  });

  it('rejects empty lists instead of silently dropping the condition', () => {
    expect(() => filterParams({ title: { in: [] } })).toThrow(AppError);
    expect(() => filterParams({ or: [] })).toThrow(AppError);
  });

  it('skips null operands and absent filters', () => {
    expect(filterParams({ title: { eq: null } })).toEqual([]);
    expect(filterParams(null)).toEqual([]);
  });

  it('translates sort items, one key each', () => {
    const params = sortParams([{ title: 'desc' }, { createdAt: 'asc' }]);
    expect(parse(toRawQuery(params)).sort).toEqual(parse('sort=title:desc,createdAt:asc').sort);
    expect(() => sortParams([{ title: 'asc', views: 'desc' }])).toThrow(AppError);
    expect(() => sortParams([{}])).toThrow(AppError);
  });

  it('passes page, size, search, locale and snapshot through the same limits', () => {
    const query = parse(
      toRawQuery(scalarParams({ page: 2, pageSize: 5, q: undefined, locale: 'fr', snapshot: 3 })),
    );
    expect(query).toMatchObject({ page: 2, pageSize: 5, locale: 'fr', snapshot: 3 });
    expect(() => parse(toRawQuery(scalarParams({ pageSize: 1000 })))).toThrow(AppError);
  });
});
