import { normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import fc from 'fast-check';
import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../helpers/appError.js';
import { compileFilter, compileHeadPage, compileHeadQuery, compileSearch } from './compile.js';
import { parseContentQuery } from './parse.js';
import { parseQueryTree } from './querystring.js';
import { compileOrderBy } from './sort.js';

// Compiles SQL without a connection.
const compiler = new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: {} as never }) });

const MODEL_ID = '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01';
const SITE_ID = '9c9c9c9c-9999-4999-8999-999999999999';
const ids = {
  title: '1a1a1a1a-1111-4111-8111-111111111111',
  rank: '2b2b2b2b-2222-4222-8222-222222222222',
  price: '3c3c3c3c-3333-4333-8333-333333333333',
  live: '4d4d4d4d-4444-4444-8444-444444444444',
  day: '5e5e5e5e-5555-4555-8555-555555555555',
  tags: '6f6f6f6f-6666-4666-8666-666666666666',
  secret: '7a7a7a7a-7777-4777-8777-777777777777',
  author: '8b8b8b8b-8888-4888-8888-888888888888',
};

const model = normalizeDefinition({
  id: MODEL_ID,
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: ids.title, apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    { id: ids.rank, apiKey: 'rank', label: 'Rank', type: 'integer', sortable: true },
    { id: ids.price, apiKey: 'price', label: 'Price', type: 'decimal', filterable: true },
    { id: ids.live, apiKey: 'live', label: 'Live', type: 'boolean' },
    { id: ids.day, apiKey: 'day', label: 'Day', type: 'date', filterable: true },
    {
      id: ids.tags,
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: { values: [{ value: 'a', label: 'A' }], multiple: true },
    },
    { id: ids.secret, apiKey: 'secret', label: 'Secret', type: 'string', filterable: true, public: false },
    {
      id: ids.author,
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: MODEL_ID, cardinality: 'one' },
    },
  ],
  display: { titleFieldId: ids.title },
}) as ModelDefinition;

const context = {
  model,
  locales: ['en', 'fr'],
  isReadable: (field: { id: string }) => field.id !== ids.secret,
  allowSnapshot: true,
  resolveModel: () => model,
};

const compileQuery = (search: string) => {
  const query = parseContentQuery(parseQueryTree(search), context);
  const conditions = [
    ...(query.filter ? [compileFilter(query.filter)] : []),
    ...(query.search ? [compileSearch(query.search.field.id, query.search.text)] : []),
  ];
  return compileHeadQuery({
    siteId: SITE_ID,
    modelId: MODEL_ID,
    source: query.snapshot
      ? { kind: 'snapshot', seq: query.snapshot }
      : { kind: 'heads', state: 'published' },
    locales: { kind: 'chain', chain: ['fr', 'en'] },
    conditions,
    orderBy: compileOrderBy(query.sort),
    limit: query.pageSize,
  }).rows.compile(compiler);
};

const status = (run: () => unknown) => {
  try {
    run();
    return 200;
  } catch (error) {
    return error instanceof AppError ? error.statusCode : 500;
  }
};

describe('content query compiler', () => {
  it('always scopes heads to the site, as a parameter, whatever the filter', () => {
    for (const search of [
      '',
      'filters[title][$eq]=x',
      'filters[$or][0][title][$eq]=x&filters[$or][1][rank][$gt]=1',
    ]) {
      const { sql, parameters } = compileQuery(search);
      expect(sql).toContain('h.site_id = $1::uuid');
      expect(parameters[0]).toBe(SITE_ID);
      expect(sql).not.toContain(SITE_ID);
    }
  });

  it('scopes a snapshot read to the site in the publication log', () => {
    const { sql, parameters } = compileQuery('snapshot=3');
    expect(sql).toMatch(/where pl\.site_id = \$1::uuid and pl\.model_id = /);
    expect(sql).toContain('h.site_id = $');
    expect(parameters.filter((value) => value === SITE_ID)).toHaveLength(2);
  });

  it('compiles equality to containment with the value as a parameter', () => {
    const { sql, parameters } = compileQuery('filters[title][$eq]=x');
    expect(sql).toContain(`"data" @> $`);
    expect(parameters).toContain(JSON.stringify({ [ids.title]: 'x' }));
  });

  it('compares numbers stored as strings numerically and lists by containment', () => {
    expect(compileQuery('filters[price][$eq]=12.50').sql).toContain(
      `(("data" ->> '${ids.price}')::numeric) = $`,
    );
    expect(compileQuery('filters[tags][$eq]=a').parameters).toContain(JSON.stringify({ [ids.tags]: ['a'] }));
  });

  it('canonicalizes values like stored ones', () => {
    expect(compileQuery('filters[day][$gte]=2026-02-01').parameters).toContain('2026-02-01');
    expect(status(() => compileQuery('filters[day][$gte]=2026-02-30'))).toBe(400);
    expect(status(() => compileQuery('filters[rank][$gt]=abc'))).toBe(400);
  });

  it('rejects unknown fields, operators and parameters with 400 and hidden fields with 403', () => {
    expect(status(() => compileQuery('filters[nope][$eq]=1'))).toBe(400);
    expect(status(() => compileQuery('filters[title][$regex]=1'))).toBe(400);
    expect(status(() => compileQuery('filter[title]=1'))).toBe(400);
    expect(status(() => compileQuery('filters[live][$gt]=true'))).toBe(400);
    expect(status(() => compileQuery('filters[rank][$contains]=1'))).toBe(400);
    expect(status(() => compileQuery('sort=live:asc'))).toBe(400);
    expect(status(() => compileQuery('filters[secret][$eq]=x'))).toBe(403);
    expect(status(() => compileQuery('filters[$or][0][secret][$null]=true'))).toBe(403);
    expect(status(() => compileQuery('sort=secret:desc'))).toBe(403);
    expect(status(() => compileQuery('fields=secret'))).toBe(403);
    expect(status(() => compileQuery('filters[__proto__][x]=1'))).toBe(400);
  });

  it('escapes LIKE wildcards in text matches', () => {
    const { parameters } = compileQuery('filters[title][$containsi]=50%_off');
    expect(parameters).toContain('%50\\%\\_off%');
  });

  it('searches the first text field when no title field is configured, and refuses without one', () => {
    const untitled = (fields: ModelDefinition['fields']) => ({
      ...context,
      model: { ...model, fields, display: {} },
    });
    const parse = (fields: ModelDefinition['fields']) =>
      parseContentQuery(parseQueryTree('q=hello'), untitled(fields)).search;
    expect(parse(model.fields)?.field.id).toBe(ids.title);
    const numeric = model.fields.filter((field) => field.type !== 'string');
    expect(status(() => parse(numeric))).toBe(400);
  });

  // The property behind brief §4: any querystring either fails validation or becomes parameterised SQL in
  // which nothing from the request appears as SQL text.
  const token = fc.stringMatching(/^zq[a-z0-9'";\\ ().*=-]{2,12}$/);
  const key = fc.oneof(
    fc.constantFrom(
      'title',
      'rank',
      'price',
      'live',
      'day',
      'tags',
      'secret',
      'author',
      'id',
      'createdAt',
      '$or',
      '$and',
      '$not',
    ),
    token,
  );
  const operator = fc.oneof(
    fc.constantFrom(
      '$eq',
      '$ne',
      '$in',
      '$nin',
      '$lt',
      '$lte',
      '$gt',
      '$gte',
      '$contains',
      '$containsi',
      '$null',
      '$notNull',
    ),
    token,
  );
  const value = fc.oneof(
    token,
    fc.constantFrom(
      '1',
      '12.5',
      'true',
      '2026-10-01',
      '2026-10-01T10:00:00Z',
      MODEL_ID,
      "'; drop table entries; --",
    ),
  );
  const parameter = fc.oneof(
    fc.tuple(key, operator, value).map(([k, o, v]) => [`filters[${k}][${o}]`, v] as const),
    fc
      .tuple(key, fc.nat(3), key, operator, value)
      .map(([g, i, k, o, v]) => [`filters[${g}][${i}][${k}][${o}]`, v] as const),
    fc.tuple(key, value).map(([k, v]) => [`filters[${k}]`, v] as const),
    fc
      .tuple(
        fc.constantFrom('sort', 'fields', 'populate', 'q', 'page', 'pageSize', 'locale', 'snapshot'),
        fc.oneof(key, value),
      )
      .map(([k, v]) => [k, v] as const),
    fc.tuple(token, value).map(([k, v]) => [k, v] as const),
  );

  it('property: arbitrary queries give a 400/403 or parameterised SQL, never raw request text', () => {
    let compiledCount = 0;
    fc.assert(
      fc.property(fc.array(parameter, { maxLength: 8 }), (parameters) => {
        const search = new URLSearchParams(parameters.map(([k, v]): [string, string] => [k, v])).toString();
        let compiled: { sql: string; parameters: readonly unknown[] };
        try {
          compiled = compileQuery(search);
        } catch (error) {
          expect(error).toBeInstanceOf(AppError);
          expect([400, 403]).toContain((error as AppError).statusCode);
          return;
        }
        compiledCount += 1;
        const tokens = parameters.flat().flatMap((part) => part.match(/zq[^\][]*/g) ?? []);
        for (const text of tokens) {
          expect(compiled.sql).not.toContain(text);
        }
        expect(compiled.sql).not.toContain('drop table');
        for (const parameter of compiled.parameters) {
          expect(['string', 'number', 'boolean', 'object']).toContain(typeof parameter);
        }
      }),
      { numRuns: 2000 },
    );
    // The generator must reach the compiler often enough for the property to mean something.
    expect(compiledCount).toBeGreaterThan(200);
  });

  it('reads richText on delivery and preview reads only, defaulting to json', () => {
    const delivery = { ...context, allowRichText: true };
    const richText = (search: string, ctx: Parameters<typeof parseContentQuery>[1] = delivery) =>
      parseContentQuery(parseQueryTree(search), ctx).richText;
    expect(richText('')).toBe('json');
    expect(richText('richText=html')).toBe('html');
    expect(richText('richText=both')).toBe('both');
    expect(status(() => richText('richText=xml'))).toBe(400);
    expect(status(() => richText('richText=html&richText=json'))).toBe(400);
    expect(richText('', context)).toBeUndefined();
    expect(status(() => richText('richText=html', context))).toBe(400);
  });

  it('reads a page, its total and the site sequence in one statement', () => {
    const plan = {
      siteId: SITE_ID,
      modelId: MODEL_ID,
      source: { kind: 'heads', state: 'published' } as const,
      locales: { kind: 'any' } as const,
      conditions: [],
      orderBy: [],
      limit: 20,
    };
    const seq = 'select ps.last_seq from publication_state ps where ps.site_id = $';
    const page = compileHeadPage(plan, { total: true });
    const { sql: rows, parameters } = page.rows.compile(compiler);
    expect(rows).toContain('(select count(*) from "entry_heads" h where h.site_id = $');
    expect(rows).toContain(seq);
    expect(rows).toMatch(
      /as page_total, \(select ps\.last_seq .*\) as page_seq\s+from "entry_heads" h join entries e/s,
    );
    expect(parameters.filter((value) => value === SITE_ID).length).toBeGreaterThanOrEqual(3);
    expect(page.meta.compile(compiler).sql).not.toContain(' join entries e');
    expect(compileHeadPage(plan, { total: false }).rows.compile(compiler).sql).toContain(
      'null as page_total',
    );
  });
});
