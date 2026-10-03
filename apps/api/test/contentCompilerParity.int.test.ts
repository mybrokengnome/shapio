import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileAuthorCondition, compileStatusCondition } from '../src/content/compiler/compile.js';
import { entryIdIn } from '../src/content/compiler/conditions.js';
import {
  analyzeHeadsStatement,
  createFieldIndexColumnStatement,
  createFieldIndexStatement,
  fieldIndexName,
  type FieldIndexSpec,
} from '../src/content/compiler/expressions.js';
import { compileRowFilter } from '../src/content/compiler/policy.js';
import type { Principal } from '../src/permissions/types.js';
import {
  compileFixtureQuery,
  FIXTURE_FIELDS as F,
  FIXTURE_MODEL_ID as MODEL,
  FIXTURE_SITE_ID as SITE,
  type FixtureQueryOptions,
} from './helpers/compilerFixture.js';
import {
  contentDatabasesOfRun,
  insertRow,
  openMysqlContentDatabase,
  openSqliteContentDatabase,
  type ContentTestDatabase,
} from './helpers/contentDialectDatabases.js';
import { isMysqlRun, withSkipReason } from './helpers/dialect.js';

/**
 * The content compiler gives the same answers on every database (ADR 0001, "D2: as built"): one dataset,
 * one table of querystrings and one expected result per query, run on PostgreSQL or MySQL and on SQLite. Values
 * cover each operator's edge cases: missing values (absent, null, "" and []), numbers stored as strings
 * ("12.5" and "12.50"), case and Unicode in text matches, LIKE wildcards in the text, locale fallback,
 * snapshots, drafts and deleted entries.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const e = {
  e1: id(1),
  e2: id(2),
  e3: id(3),
  e4: id(4),
  e5: id(5),
  e6: id(6),
  e7: id(7),
  e8: id(8),
} as const;
const ADMIN = id(900);
const OTHER_SITE = id(901);

const ENTRIES = [
  { n: 1, created: '2026-01-01T00:00:00.000Z', admin: ADMIN },
  { n: 2, created: '2026-02-01T00:00:00.000Z', admin: ADMIN },
  { n: 3, created: '2026-03-01T00:00:00.000Z' },
  { n: 4, created: '2026-04-01T00:00:00.000Z' },
  { n: 5, created: '2026-05-01T00:00:00.000Z' },
  { n: 6, created: '2026-06-01T00:00:00.000Z' },
  { n: 7, created: '2026-07-01T00:00:00.000Z', admin: ADMIN },
  { n: 8, created: '2026-08-01T00:00:00.000Z' },
  { n: 9, created: '2026-09-01T00:00:00.000Z', deleted: true },
];

type Head = { entry: number; locale: string; state: 'draft' | 'published'; data: Record<string, unknown> };

const HEADS: Head[] = [
  {
    entry: 1,
    locale: 'en',
    state: 'published',
    data: {
      [F.title]: 'Alpha',
      [F.rank]: 3,
      [F.price]: '12.50',
      [F.big]: '12',
      [F.score]: 1.25,
      [F.live]: true,
      [F.day]: '2026-01-15',
      [F.tags]: ['a'],
      [F.author]: id(2),
    },
  },
  {
    entry: 2,
    locale: 'en',
    state: 'published',
    data: {
      [F.title]: 'beta',
      [F.rank]: 10,
      [F.price]: '12.5',
      [F.big]: '9007199254740993',
      [F.score]: 2.5,
      [F.live]: false,
      [F.day]: '2026-03-01',
      [F.tags]: ['a', 'b'],
    },
  },
  {
    entry: 3,
    locale: 'en',
    state: 'published',
    data: {
      [F.title]: 'Été 50%_off',
      [F.rank]: 1,
      [F.price]: '3',
      [F.score]: -1,
      [F.live]: true,
      [F.day]: '2025-12-31',
      [F.tags]: [],
    },
  },
  { entry: 4, locale: 'en', state: 'published', data: { [F.title]: '', [F.rank]: null, [F.tags]: null } },
  {
    entry: 5,
    locale: 'en',
    state: 'published',
    data: {
      [F.title]: 'gamma',
      [F.rank]: 3,
      [F.price]: '100',
      [F.live]: false,
      [F.day]: '2026-01-15',
      [F.tags]: ['b'],
    },
  },
  { entry: 6, locale: 'en', state: 'published', data: { [F.rank]: 7 } },
  { entry: 1, locale: 'fr', state: 'published', data: { [F.title]: 'Alpha FR', [F.rank]: 30 } },
  { entry: 8, locale: 'fr', state: 'published', data: { [F.title]: 'Huit', [F.rank]: 8 } },
  { entry: 7, locale: 'en', state: 'draft', data: { [F.title]: 'Draft only' } },
  { entry: 9, locale: 'en', state: 'published', data: { [F.title]: 'Alpha' } },
];

const revisionId = (index: number) => id(100 + index);
const OLD_REVISION = id(199);

/** Publication log: e1/en had an older revision until sequence 3; e1/fr appeared at 4. */
const PUBLICATIONS = [
  { entry: 1, locale: 'en', revision: OLD_REVISION, from: 1, to: 3 },
  { entry: 1, locale: 'en', revision: revisionId(0), from: 3, to: null },
  { entry: 2, locale: 'en', revision: revisionId(1), from: 2, to: null },
  { entry: 8, locale: 'fr', revision: revisionId(7), from: 2, to: null },
  { entry: 1, locale: 'fr', revision: revisionId(6), from: 4, to: null },
];

const seed = async (database: ContentTestDatabase) => {
  for (const entry of ENTRIES) {
    await database.execute(
      insertRow('entries', {
        id: id(entry.n),
        site_id: SITE,
        model_id: MODEL,
        created_at: entry.created,
        updated_at: entry.created,
        deleted_at: entry.deleted ? entry.created : null,
        created_by_admin_id: entry.admin ?? null,
      }),
    );
  }
  for (const [index, head] of HEADS.entries()) {
    const data = JSON.stringify(head.data);
    await database.execute(
      insertRow('content_revisions', { id: revisionId(index), entry_id: id(head.entry), data }),
    );
    await database.execute(
      insertRow('entry_heads', {
        entry_id: id(head.entry),
        site_id: SITE,
        model_id: MODEL,
        locale: head.locale,
        state: head.state,
        revision_id: revisionId(index),
        data,
        updated_at: `2026-10-0${head.entry}T12:00:00.000Z`,
      }),
    );
  }
  await database.execute(
    insertRow('content_revisions', {
      id: OLD_REVISION,
      entry_id: id(1),
      data: JSON.stringify({ [F.title]: 'Alpha v1', [F.rank]: 2 }),
    }),
  );
  for (const publication of PUBLICATIONS) {
    await database.execute(
      insertRow('publication_log', {
        entry_id: id(publication.entry),
        site_id: SITE,
        model_id: MODEL,
        locale: publication.locale,
        revision_id: publication.revision,
        from_seq: publication.from,
        to_seq: publication.to,
        published_at: '2026-09-30T00:00:00.000Z',
      }),
    );
  }
  // Another site's copy of a matching head must never be read.
  await database.execute(
    insertRow('entries', {
      id: id(50),
      site_id: OTHER_SITE,
      model_id: MODEL,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  );
  await database.execute(insertRow('content_revisions', { id: id(150), entry_id: id(50), data: '{}' }));
  await database.execute(
    insertRow('entry_heads', {
      entry_id: id(50),
      site_id: OTHER_SITE,
      model_id: MODEL,
      locale: 'en',
      state: 'published',
      revision_id: id(150),
      data: JSON.stringify({ [F.title]: 'Alpha', [F.rank]: 3 }),
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  );
};

const EN: FixtureQueryOptions = { locales: { kind: 'chain', chain: ['en'] } };
const FR_EN: FixtureQueryOptions = { locales: { kind: 'chain', chain: ['fr', 'en'] } };

/** [querystring, options, expected entries in order] */
const CASES: ReadonlyArray<readonly [string, FixtureQueryOptions, readonly string[]]> = [
  ['', EN, [e.e1, e.e2, e.e3, e.e4, e.e5, e.e6]],
  // Equality: a missing value is not equal to anything, so $ne and $nin include it.
  ['filters[title][$eq]=Alpha', EN, [e.e1]],
  ['filters[title][$ne]=Alpha', EN, [e.e2, e.e3, e.e4, e.e5, e.e6]],
  ['filters[title][$in][0]=Alpha&filters[title][$in][1]=beta', EN, [e.e1, e.e2]],
  ['filters[title][$nin][0]=Alpha', EN, [e.e2, e.e3, e.e4, e.e5, e.e6]],
  ['filters[rank][$eq]=3', EN, [e.e1, e.e5]],
  ['filters[rank][$ne]=3', EN, [e.e2, e.e3, e.e4, e.e6]],
  ['filters[live][$eq]=true', EN, [e.e1, e.e3]],
  ['filters[live][$eq]=false', EN, [e.e2, e.e5]],
  ['filters[live][$ne]=true', EN, [e.e2, e.e4, e.e5, e.e6]],
  ['filters[author][$eq]=' + id(2), EN, [e.e1]],
  // Numbers stored as strings compare numerically ("12.50" = "12.5"); a missing one compares as unknown.
  ['filters[price][$eq]=12.5', EN, [e.e1, e.e2]],
  ['filters[price][$ne]=12.5', EN, [e.e3, e.e5]],
  ['filters[price][$gt]=12', EN, [e.e1, e.e2, e.e5]],
  ['filters[big][$eq]=12', EN, [e.e1]],
  ['filters[big][$gt]=9007199254740992', EN, [e.e2]],
  // Lists: membership; [] and null are missing.
  ['filters[tags][$eq]=a', EN, [e.e1, e.e2]],
  ['filters[tags][$in][0]=b', EN, [e.e2, e.e5]],
  ['filters[tags][$nin][0]=a', EN, [e.e3, e.e4, e.e5, e.e6]],
  ['filters[tags][$null]=true', EN, [e.e3, e.e4, e.e6]],
  // Missing: absent, null and "".
  ['filters[title][$null]=true', EN, [e.e4, e.e6]],
  ['filters[title][$notNull]=true', EN, [e.e1, e.e2, e.e3, e.e5]],
  ['filters[rank][$null]=true', EN, [e.e4]],
  ['filters[author][$null]=false', EN, [e.e1]],
  // Ranges.
  ['filters[rank][$gt]=3', EN, [e.e2, e.e6]],
  ['filters[rank][$lte]=3', EN, [e.e1, e.e3, e.e5]],
  ['filters[score][$lt]=0', EN, [e.e3]],
  ['filters[day][$gte]=2026-01-15', EN, [e.e1, e.e2, e.e5]],
  ['filters[title][$gte]=b&filters[title][$lt]=c', EN, [e.e2]],
  // Text: case-sensitive matches treat % and _ literally; $containsi folds Unicode.
  ['filters[title][$contains]=50%_', EN, [e.e3]],
  ['filters[title][$contains]=ALPHA', EN, []],
  ['filters[title][$containsi]=ALPHA', EN, [e.e1]],
  ['filters[title][$containsi]=ÉTÉ', EN, [e.e3]],
  ['filters[title][$containsi]=%', EN, [e.e3]],
  ['filters[title][$startsWith]=be', EN, [e.e2]],
  ['filters[title][$startsWith]=Be', EN, []],
  ['filters[title][$endsWith]=ta', EN, [e.e2]],
  ['filters[title][$endsWith]=_off', EN, [e.e3]],
  ['filters[title][$notContains]=a', EN, [e.e3, e.e4, e.e6]],
  ['q=GAMM', EN, [e.e5]],
  // System attributes.
  ['filters[id][$in][0]=' + id(1) + '&filters[id][$in][1]=' + id(3), EN, [e.e1, e.e3]],
  ['filters[id][$nin][0]=' + id(1), EN, [e.e2, e.e3, e.e4, e.e5, e.e6]],
  ['filters[createdAt][$gte]=2026-03-01T01:00:00%2B01:00', EN, [e.e3, e.e4, e.e5, e.e6]],
  ['filters[createdAt][$lt]=2026-02-01T00:00:00Z', EN, [e.e1]],
  ['filters[updatedAt][$eq]=2026-10-02T12:00:00Z', EN, [e.e2]],
  [
    'filters[updatedAt][$in][0]=2026-10-03T12:00:00.000Z&filters[updatedAt][$in][1]=2026-10-05T12:00:00Z',
    EN,
    [e.e3, e.e5],
  ],
  // Logic.
  ['filters[$or][0][rank][$gt]=7&filters[$or][1][title][$eq]=gamma', EN, [e.e2, e.e5]],
  ['filters[$not][rank][$eq]=3', EN, [e.e2, e.e3, e.e4, e.e6]],
  // Sorts: missing values last ascending and first descending; the entry ID breaks ties.
  ['sort=rank:asc', EN, [e.e3, e.e1, e.e5, e.e6, e.e2, e.e4]],
  ['sort=rank:desc', EN, [e.e4, e.e2, e.e6, e.e1, e.e5, e.e3]],
  ['sort=price:asc', EN, [e.e3, e.e1, e.e2, e.e5, e.e4, e.e6]],
  ['sort=day:desc,rank:asc', EN, [e.e6, e.e4, e.e2, e.e1, e.e5, e.e3]],
  ['sort=title:asc&filters[rank][$gte]=3', EN, [e.e1, e.e2, e.e5, e.e6]],
  ['sort=createdAt:desc', EN, [e.e6, e.e5, e.e4, e.e3, e.e2, e.e1]],
  ['sort=rank:asc&pageSize=2&page=2', EN, [e.e5, e.e6]],
  // Locale fallback: the first locale with a head serves the entry, and filters apply to that head.
  ['', FR_EN, [e.e1, e.e2, e.e3, e.e4, e.e5, e.e6, e.e8]],
  ['filters[title][$eq]=Alpha', FR_EN, []],
  ['filters[title][$eq]=Alpha FR', FR_EN, [e.e1]],
  ['sort=rank:desc&filters[rank][$gte]=8', FR_EN, [e.e1, e.e2, e.e8]],
  ['', { locales: { kind: 'any' } }, [e.e1, e.e1, e.e2, e.e3, e.e4, e.e5, e.e6, e.e8]],
  ['', { ...EN, state: 'draft' }, [e.e7]],
  // Snapshots: the published revision as of the sequence number.
  ['snapshot=1', EN, [e.e1]],
  ['snapshot=2&filters[title][$eq]=Alpha v1', EN, [e.e1]],
  ['snapshot=3&filters[title][$eq]=Alpha v1', EN, []],
  ['snapshot=3', EN, [e.e1, e.e2]],
  ['snapshot=3', FR_EN, [e.e1, e.e2, e.e8]],
  ['snapshot=4&filters[title][$eq]=Alpha FR', FR_EN, [e.e1]],
  ['snapshot=4&sort=rank:asc', FR_EN, [e.e8, e.e2, e.e1]],
];

const admin = { kind: 'admin', adminUserId: ADMIN } as Principal;

// A SQLite run has no PostgreSQL server: it checks the SQLite side only.
describe.each(contentDatabasesOfRun())('content compiler on %s', (_name, open) => {
  let database: ContentTestDatabase;
  const entriesOf = async (search: string, options: FixtureQueryOptions) =>
    (await database.rows(compileFixtureQuery(search, database.dialect, options).rows)).map(
      (row) => row.entry_id,
    );

  beforeAll(async () => {
    database = await open();
    await seed(database);
  });
  afterAll(async () => {
    await database.close();
  });

  it.each(CASES)('%s %j', async (search, options, expected) => {
    expect(await entriesOf(search, options)).toEqual(expected);
  });

  it('counts what it lists', async () => {
    const query = compileFixtureQuery('filters[rank][$gte]=3', database.dialect, EN);
    const [row] = await database.rows(query.count);
    expect(Number(row?.total)).toBe(4);
  });

  it('serves the locale that answered and decodes the data', async () => {
    const rows = await database.rows(
      compileFixtureQuery('filters[rank][$gte]=8', database.dialect, FR_EN).rows,
    );
    expect(rows.map((row) => [row.entry_id, row.locale])).toEqual([
      [e.e1, 'fr'],
      [e.e2, 'en'],
      [e.e8, 'fr'],
    ]);
    const data = rows[0]?.data as unknown;
    expect(typeof data === 'string' ? JSON.parse(data) : data).toEqual({
      [F.title]: 'Alpha FR',
      [F.rank]: 30,
    });
  });

  it('applies row filters, entry restrictions and admin list conditions', async () => {
    const owned = compileRowFilter({ kind: 'ownedByPrincipal' }, admin, database.dialect);
    const run = async (
      conditions: FixtureQueryOptions['extraConditions'],
      state: 'draft' | 'published' = 'published',
    ) =>
      (
        await database.rows(
          compileFixtureQuery('', database.dialect, { ...EN, state, extraConditions: conditions }).rows,
        )
      ).map((row) => row.entry_id);
    expect(await run(owned ? [owned] : [])).toEqual([e.e1, e.e2]);
    expect(await run([entryIdIn([id(1), id(3), id(8)], database.dialect)])).toEqual([e.e1, e.e3]);
    expect(await run([entryIdIn([], database.dialect)])).toEqual([]);
    expect(await run([compileAuthorCondition(ADMIN, database.dialect)], 'draft')).toEqual([e.e7]);
    expect(await run([compileStatusCondition('draft')], 'draft')).toEqual([e.e7]);
  });
});

const indexSpec = (fieldId: string, type: FieldIndexSpec['type']): FieldIndexSpec => ({
  modelId: MODEL,
  fieldId,
  type,
});
const INDEXED = {
  title: indexSpec(F.title, 'string'),
  rank: indexSpec(F.rank, 'integer'),
  price: indexSpec(F.price, 'decimal'),
  day: indexSpec(F.day, 'date'),
};

/** 4,000 published heads per locale, so the planner has a reason to choose; then the field indexes. */
const seedIndexedHeads = async (database: ContentTestDatabase) => {
  const entries: Array<Record<string, unknown>> = [];
  const revisions: Array<Record<string, unknown>> = [];
  const heads: Array<Record<string, unknown>> = [];
  for (let n = 1; n <= 4000; n += 1) {
    const entryId = id(10_000 + n);
    entries.push({
      id: entryId,
      site_id: SITE,
      model_id: MODEL,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    for (const locale of ['en', 'fr']) {
      const data = JSON.stringify({
        [F.title]: `title ${n % 997}`,
        [F.rank]: n % 1000,
        [F.price]: `${n % 500}.25`,
        [F.day]: `2026-01-${String((n % 28) + 1).padStart(2, '0')}`,
      });
      const revision = id(1_000_000 + n * 2 + (locale === 'en' ? 0 : 1));
      revisions.push({ id: revision, entry_id: entryId, data });
      heads.push({
        entry_id: entryId,
        site_id: SITE,
        model_id: MODEL,
        locale,
        state: 'published',
        revision_id: revision,
        data,
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    }
  }
  // Batched: 20,000 single-row autocommits made this hook slow and load-sensitive on CI's MySQL.
  await database.insertRows('entries', entries);
  await database.insertRows('content_revisions', revisions);
  await database.insertRows('entry_heads', heads);
  for (const index of Object.values(INDEXED)) {
    const column = createFieldIndexColumnStatement(index, database.dialect);
    if (column) {
      await database.execute(column);
    }
    await database.execute(createFieldIndexStatement(index, database.dialect));
  }
  await database.execute(analyzeHeadsStatement(database.dialect));
};

describe('field indexes serve compiled queries on SQLite', () => {
  let database: ContentTestDatabase;

  beforeAll(async () => {
    database = await openSqliteContentDatabase();
    await seedIndexedHeads(database);
  });
  afterAll(async () => {
    await database.close();
  });

  const planOf = (search: string) => database.plan(compileFixtureQuery(search, database.dialect, EN).rows);

  it.each([
    ['equality on text', 'filters[title][$eq]=title 5', INDEXED.title],
    ['equality on a number', 'filters[rank][$eq]=5', INDEXED.rank],
    ['equality on a decimal string', 'filters[price][$eq]=5.25', INDEXED.price],
    ['a numeric range', 'filters[rank][$gt]=990', INDEXED.rank],
    ['a date range', 'filters[day][$lt]=2026-01-02', INDEXED.day],
  ] as const)('%s uses the field index', async (_what, search, index) => {
    const plan = await planOf(search);
    expect(plan.join('\n')).toContain(
      `USING INDEX ${fieldIndexName(index)} (site_id=? AND locale=? AND state=? AND <expr>`,
    );
  });

  it.each([
    ['sort=rank:asc', INDEXED.rank],
    ['sort=rank:desc', INDEXED.rank],
    ['sort=day:desc', INDEXED.day],
    ['sort=title:asc', INDEXED.title],
  ] as const)('%s reads the field index in order', async (search, index) => {
    const plan = (await planOf(search)).join('\n');
    expect(plan).toContain(`USING INDEX ${fieldIndexName(index)} (site_id=? AND locale=? AND state=?)`);
    // Only the entry-ID tie-breaker is sorted, within equal values.
    expect(plan).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });
});

const mysqlPlanSkip = isMysqlRun() ? undefined : 'checks MySQL query plans (MySQL runs only)';

describe.skipIf(mysqlPlanSkip)(
  withSkipReason('field indexes serve compiled queries on MySQL', mysqlPlanSkip),
  () => {
    let database: ContentTestDatabase;

    beforeAll(async () => {
      database = await openMysqlContentDatabase();
      await seedIndexedHeads(database);
    }, 120_000);
    afterAll(async () => {
      await database.close();
    });

    const planOf = async (search: string) =>
      (await database.plan(compileFixtureQuery(search, database.dialect, EN).rows)).join('\n');

    it.each([
      ['equality on text', 'filters[title][$eq]=title 5', INDEXED.title, 'Index lookup'],
      ['equality on a number', 'filters[rank][$eq]=5', INDEXED.rank, 'Index lookup'],
      ['equality on a decimal string', 'filters[price][$eq]=5.25', INDEXED.price, 'Index lookup'],
      ['a numeric range', 'filters[rank][$gt]=990', INDEXED.rank, 'Index range scan'],
      ['a date range', 'filters[day][$lt]=2026-01-02', INDEXED.day, 'Index range scan'],
    ] as const)('%s uses the field index', async (_what, search, index, access) => {
      expect(await planOf(search)).toContain(`${access} on h using ${fieldIndexName(index)}`);
    });
  },
);
