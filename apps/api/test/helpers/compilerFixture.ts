import { normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import type { RawBuilder } from 'kysely';
import {
  compileFilter,
  compileHeadQuery,
  compileSearch,
  type HeadSource,
  type LocaleScope,
} from '../../src/content/compiler/compile.js';
import type { ContentSqlDialect } from '../../src/content/compiler/dialect/types.js';
import { parseContentQuery } from '../../src/content/compiler/parse.js';
import { parseQueryTree } from '../../src/content/compiler/querystring.js';
import { compileOrderBy } from '../../src/content/compiler/sort.js';

/**
 * One content model and its compiled queries, shared by the dialect unit tests
 * (`content/compiler/compile.*.test.ts`) and the cross-database parity test, so every dialect is checked
 * against the same field types and the same querystrings.
 */
export const FIXTURE_MODEL_ID = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01';
export const FIXTURE_SITE_ID = '9c9c9c9c-9999-4999-8999-999999999999';

export const FIXTURE_FIELDS = {
  title: '1a1a1a1a-1111-4111-8111-111111111111',
  rank: '2b2b2b2b-2222-4222-8222-222222222222',
  price: '3c3c3c3c-3333-4333-8333-333333333333',
  big: '9d9d9d9d-9999-4999-8999-999999999990',
  score: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  live: '4d4d4d4d-4444-4444-8444-444444444444',
  day: '5e5e5e5e-5555-4555-8555-555555555555',
  tags: '6f6f6f6f-6666-4666-8666-666666666666',
  author: '8b8b8b8b-8888-4888-8888-888888888888',
} as const;

const ids = FIXTURE_FIELDS;

export const fixtureModel = normalizeDefinition({
  id: FIXTURE_MODEL_ID,
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: ids.title, apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    { id: ids.rank, apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true, sortable: true },
    { id: ids.price, apiKey: 'price', label: 'Price', type: 'decimal', filterable: true, sortable: true },
    { id: ids.big, apiKey: 'big', label: 'Big', type: 'biginteger', filterable: true },
    { id: ids.score, apiKey: 'score', label: 'Score', type: 'number', filterable: true },
    { id: ids.live, apiKey: 'live', label: 'Live', type: 'boolean', filterable: true },
    { id: ids.day, apiKey: 'day', label: 'Day', type: 'date', filterable: true, sortable: true },
    {
      id: ids.tags,
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: {
        values: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        multiple: true,
      },
    },
    {
      id: ids.author,
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: FIXTURE_MODEL_ID, cardinality: 'one' },
    },
  ],
  display: { titleFieldId: ids.title },
}) as ModelDefinition;

const parseContext = {
  model: fixtureModel,
  locales: ['en', 'fr', 'de'],
  isReadable: () => true,
  allowSnapshot: true,
  resolveModel: () => fixtureModel,
};

export const parseFixtureQuery = (search: string) => parseContentQuery(parseQueryTree(search), parseContext);

/** The filter (and search) of a querystring as one condition, or null. */
export const compileFixtureFilter = (
  search: string,
  dialect: ContentSqlDialect,
): RawBuilder<unknown> | null => {
  const query = parseFixtureQuery(search);
  if (query.filter) {
    return compileFilter(query.filter, dialect);
  }
  return query.search ? compileSearch(query.search.field.id, query.search.text, dialect) : null;
};

export type FixtureQueryOptions = {
  locales?: LocaleScope;
  /** Live published heads unless the querystring names a snapshot. */
  state?: 'draft' | 'published';
  extraConditions?: readonly RawBuilder<unknown>[];
};

/** A querystring compiled to the head query (rows and count) the delivery API would run. */
export const compileFixtureQuery = (
  search: string,
  dialect: ContentSqlDialect,
  {
    locales = { kind: 'chain', chain: ['fr', 'en'] },
    state = 'published',
    extraConditions = [],
  }: FixtureQueryOptions = {},
) => {
  const query = parseFixtureQuery(search);
  const filter = compileFixtureFilter(search, dialect);
  const source: HeadSource = query.snapshot
    ? { kind: 'snapshot', seq: query.snapshot }
    : { kind: 'heads', state };
  return compileHeadQuery(
    {
      siteId: FIXTURE_SITE_ID,
      modelId: FIXTURE_MODEL_ID,
      source,
      locales,
      conditions: [...(filter ? [filter] : []), ...extraConditions],
      orderBy: compileOrderBy(query.sort, dialect),
      limit: query.pageSize,
      ...(query.page > 1 ? { offset: (query.page - 1) * query.pageSize } : {}),
    },
    dialect,
  );
};
