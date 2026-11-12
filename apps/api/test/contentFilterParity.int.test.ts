import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { compileFilter, compileHeadQuery, type HeadSource } from '../src/content/compiler/compile.js';
import { contentDialectFor, type ContentSqlDialect } from '../src/content/compiler/dialect/index.js';
import { FILTER_STRING_MAX_CHARS } from '../src/content/compiler/dialect/postgres.js';
import { parseContentQuery } from '../src/content/compiler/parse.js';
import { parseQueryTree } from '../src/content/compiler/querystring.js';
import { compileOrderBy, defaultSortTerms } from '../src/content/compiler/sort.js';
import type { FilterNode } from '../src/content/compiler/types.js';
import { resolveModel, type ContentModel } from '../src/content/model.js';
import { canonicalDatetime, canonicalTime } from '../src/content/validator/scalars.js';
import { createDefinition, fieldIdOf, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { isMysqlRun, isSqliteRun, withSkipReason } from './helpers/dialect.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Parity for `entry_heads.filter_data` (ADR 0001, "Filter data"): every filter the compiler can emit
 * containment for answers the same rows, in the same order, and the same count, whether containment is emitted
 * against `filter_data` (kept by the trigger; on a snapshot read of older revisions, their `data`) or the whole
 * `data`, on live heads and on a snapshot. The corpus stores what the validator writes and also what it never writes but storage can
 * hold (values of another type, objects, mixed and nested arrays, nulls, empty lists, removed fields).
 */
const skip =
  isSqliteRun() || isMysqlRun() ? 'PostgreSQL only: SQLite and MySQL have no containment index' : undefined;

const ENTRIES = 400;
const UUIDS = [
  '0e0e0e0e-0000-4000-8000-000000000001',
  '0e0e0e0e-0000-4000-8000-000000000002',
  '0e0e0e0e-0000-4000-8000-000000000003',
];

type Pool = { values: readonly unknown[]; query: readonly string[]; list?: boolean };

/**
 * Strings at the long-string limit (`FILTER_STRING_MAX_CHARS` characters) and just past it, in characters of two
 * and four bytes: `filter_data` keeps the first and third and leaves the others out. A REST query value is at
 * most 1,000 code units, so a query names them by placeholder (`@L0`) and the parsed filter gets the string
 * (what GraphQL or an in-process call can send).
 */
const LONG = [
  `${'é'.repeat(FILTER_STRING_MAX_CHARS - 1)}😀`,
  `${'é'.repeat(FILTER_STRING_MAX_CHARS)}😀`,
  '😀'.repeat(FILTER_STRING_MAX_CHARS),
  'a'.repeat(FILTER_STRING_MAX_CHARS + 1),
];
const LONG_PLACEHOLDERS = LONG.map((_, index) => `@L${index}`);

const withLongStrings = (node: FilterNode): FilterNode => {
  const swap = (value: unknown): unknown => {
    const index = typeof value === 'string' ? LONG_PLACEHOLDERS.indexOf(value) : -1;
    return index >= 0 ? LONG[index] : value;
  };
  switch (node.kind) {
    case 'and':
    case 'or':
      return { ...node, nodes: node.nodes.map(withLongStrings) };
    case 'not':
      return { ...node, node: withLongStrings(node.node) };
    default:
      return { ...node, value: Array.isArray(node.value) ? node.value.map(swap) : swap(node.value) };
  }
};

/** Stored values (canonical, as the validator writes them) and the query text that names them. */
const POOLS: Readonly<Record<string, Pool>> = {
  s: { values: ['a', 'b', 'A'], query: ['a', 'b', 'A', 'z'] },
  t: { values: ['a', 'b'], query: ['a', 'b'] },
  sl: { values: ['one', 'two'], query: ['one', 'two'] },
  em: { values: ['a@example.com', 'b@example.com'], query: ['a@example.com'] },
  u: { values: ['https://a.example/', 'https://b.example/'], query: ['https://a.example/'] },
  n: { values: [1, 1.5, 2], query: ['1', '1.5', '2.0'] },
  i: { values: [1, 2, 3], query: ['1', '3'] },
  b: { values: [true, false], query: ['true', 'false'] },
  d: { values: ['2026-10-01', '2026-10-02'], query: ['2026-10-01', '2026-10-02'] },
  dt: {
    values: [canonicalDatetime('2026-10-01T08:00:00Z'), canonicalDatetime('2026-10-02T08:00:00Z')],
    query: ['2026-10-01T10:00:00+02:00', '2026-10-02T08:00:00Z'],
  },
  tm: { values: [canonicalTime('10:00:00'), canonicalTime('11:30:00')], query: ['10:00:00', '11:30:00'] },
  e: { values: ['a', 'b', 'c'], query: ['a', 'c'] },
  es: { values: ['a', 'b', 'c'], query: ['a', 'b'], list: true },
  r: { values: UUIDS, query: UUIDS.slice(0, 2) },
  rs: { values: UUIDS, query: UUIDS.slice(1), list: true },
  m: { values: UUIDS, query: UUIDS.slice(0, 2) },
  ms: { values: UUIDS, query: UUIDS.slice(0, 2), list: true },
  lt: { values: LONG, query: LONG_PLACEHOLDERS },
};

/** Deterministic, so a failure reproduces. */
const random = (() => {
  let state = 20261112;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

/** What storage can hold for a field besides a valid value. */
const oddValue = (pool: Pool): unknown => {
  const value = pick(pool.values);
  return pick([
    null,
    { k: value },
    [{ k: value }, value],
    [[value]],
    [],
    [{ __id: 'i1', k: value }],
    pool.list ? value : [value],
    String(value),
    typeof value === 'number' ? value * 1.0 + 0 : value,
  ]);
};

const valueFor = (pool: Pool): unknown => {
  const roll = random();
  if (roll < 0.15) {
    return undefined;
  }
  if (roll < 0.75) {
    return pool.list
      ? Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pool.values))
      : pick(pool.values);
  }
  return oddValue(pool);
};

const documentFor = (fieldIds: Readonly<Record<string, string>>): Record<string, unknown> => {
  const data: Record<string, unknown> = {};
  for (const [apiKey, pool] of Object.entries(POOLS)) {
    const value = valueFor(pool);
    if (value !== undefined) {
      data[fieldIds[apiKey] ?? apiKey] = value;
    }
  }
  data[fieldIds.idx ?? 'idx'] = pick(['a', 'b']);
  // Component items holding the same values as the top-level fields, with item IDs.
  data[fieldIds.cards ?? 'cards'] = Array.from({ length: Math.floor(random() * 4) }, () => ({
    __id: randomUUID(),
    heading: pick(['a', 'b']),
  }));
  data[fieldIds.blob ?? 'blob'] = pick([{ s: 'a' }, ['a', { s: 'a' }], 'a', null, [1, 2]]);
  // A removed field's value stays in storage.
  data['0f0f0f0f-0000-4000-8000-000000000001'] = { s: 'a' };
  return data;
};

/** Every containment filter on every pool field, alone, negated, and combined. */
const querystrings = (): string[] => {
  const single = Object.entries(POOLS).flatMap(([apiKey, pool]) => {
    const values = pool.query.map(encodeURIComponent);
    return [
      ...values.flatMap((value) => [
        `filters[${apiKey}][$eq]=${value}`,
        `filters[${apiKey}][$ne]=${value}`,
        `filters[$not][${apiKey}][$eq]=${value}`,
      ]),
      // Booleans take no list operators.
      ...(apiKey === 'b'
        ? []
        : [
            `filters[${apiKey}][$in][0]=${values[0]}&filters[${apiKey}][$in][1]=${values.at(-1)}`,
            `filters[${apiKey}][$nin][0]=${values[0]}&filters[${apiKey}][$nin][1]=${values.at(-1)}`,
          ]),
    ];
  });
  const keys = Object.keys(POOLS);
  const combined = keys.map((apiKey, index) => {
    const other = keys[(index + 5) % keys.length] ?? apiKey;
    const value = encodeURIComponent(POOLS[apiKey]?.query[0] ?? '');
    const otherValue = encodeURIComponent(POOLS[other]?.query.at(-1) ?? '');
    return `filters[$or][0][${apiKey}][$eq]=${value}&filters[$or][1][${other}][$ne]=${otherValue}&filters[idx][$eq]=a`;
  });
  return [...single, ...combined];
};

describe.skipIf(skip)(
  withSkipReason('containment answers the same against either index expression', skip),
  () => {
    const database = useTestDatabase();
    let testApp: TestApp;
    let model: ContentModel;

    beforeAll(async () => {
      testApp = await createTestApp(database.current, { schemaListen: false });
      const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'card',
          label: 'Card',
          fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
        },
        'components',
      );
      const target = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'target',
        label: 'Target',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
      const enumSettings = (multiple: boolean) => ({
        values: ['a', 'b', 'c'].map((value) => ({ value, label: value.toUpperCase() })),
        multiple,
      });
      const probe: ModelBody = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'probe',
        label: 'Probe',
        fields: [
          { apiKey: 's', label: 'S', type: 'string' },
          { apiKey: 't', label: 'T', type: 'text' },
          { apiKey: 'sl', label: 'Sl', type: 'slug' },
          { apiKey: 'em', label: 'Em', type: 'email' },
          { apiKey: 'u', label: 'U', type: 'url' },
          { apiKey: 'n', label: 'N', type: 'number' },
          { apiKey: 'i', label: 'I', type: 'integer' },
          { apiKey: 'b', label: 'B', type: 'boolean' },
          { apiKey: 'd', label: 'D', type: 'date' },
          { apiKey: 'dt', label: 'Dt', type: 'datetime' },
          { apiKey: 'tm', label: 'Tm', type: 'time' },
          { apiKey: 'e', label: 'E', type: 'enum', settings: enumSettings(false) },
          { apiKey: 'es', label: 'Es', type: 'enum', settings: enumSettings(true) },
          {
            apiKey: 'r',
            label: 'R',
            type: 'relation',
            settings: { target: target.definition.id, cardinality: 'one' },
          },
          {
            apiKey: 'rs',
            label: 'Rs',
            type: 'relation',
            settings: { target: target.definition.id, cardinality: 'many' },
          },
          { apiKey: 'm', label: 'M', type: 'media', settings: { multiple: false } },
          { apiKey: 'ms', label: 'Ms', type: 'media', settings: { multiple: true } },
          { apiKey: 'lt', label: 'Lt', type: 'text' },
          { apiKey: 'idx', label: 'Idx', type: 'string', filterable: true },
          {
            apiKey: 'cards',
            label: 'Cards',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
          },
          { apiKey: 'blob', label: 'Blob', type: 'json' },
        ],
      });
      await runContentSchemaJobs(database.current.db);
      const snapshot = (await testApp.app.schemaRegistry.getSnapshot()).forSite(PRIMARY_SITE_ID);
      model = resolveModel(snapshot, 'probe');
      const fieldIds = Object.fromEntries(
        [...Object.keys(POOLS), 'idx', 'cards', 'blob'].map((apiKey) => [apiKey, fieldIdOf(probe, apiKey)]),
      );
      const revisionId = snapshot.byId.get(probe.definition.id)?.revisionId;
      await seed(fieldIds, revisionId ?? '');
    });
    afterAll(async () => {
      await testApp.app.close();
    });

    /** Each entry has an older published revision (snapshot 1) and a current one (snapshot 2, the live head). */
    const seed = async (fieldIds: Record<string, string>, schemaRevisionId: string) => {
      const { db } = database.current;
      await db.transaction().execute(async (trx) => {
        const entries = await trx
          .insertInto('entries')
          .values(
            Array.from({ length: ENTRIES }, () => ({
              site_id: PRIMARY_SITE_ID,
              model_id: model.definition.id,
            })),
          )
          .returning(['id', 'created_at'])
          .execute();
        const revisions = entries.flatMap((entry) =>
          ['old', 'current'].map((kind) => ({
            id: randomUUID(),
            kind,
            entry,
            data: documentFor(fieldIds),
          })),
        );
        await trx
          .insertInto('content_revisions')
          .values(
            revisions.map((revision) => ({
              id: revision.id,
              entry_id: revision.entry.id,
              locale: 'en',
              schema_revision_id: schemaRevisionId,
              data: revision.data,
              reason: 'create',
              author_type: 'system',
            })),
          )
          .execute();
        const current = revisions.filter((revision) => revision.kind === 'current');
        await trx
          .insertInto('entry_heads')
          .values(
            current.map((revision) => ({
              entry_id: revision.entry.id,
              site_id: PRIMARY_SITE_ID,
              model_id: model.definition.id,
              locale: 'en',
              state: 'published',
              revision_id: revision.id,
              data: revision.data,
              entry_created_at: revision.entry.created_at,
            })),
          )
          .execute();
        await trx
          .insertInto('publication_log')
          .values(
            revisions.map((revision) => ({
              entry_id: revision.entry.id,
              site_id: PRIMARY_SITE_ID,
              model_id: model.definition.id,
              locale: 'en',
              revision_id: revision.id,
              from_seq: revision.kind === 'old' ? '1' : '2',
              to_seq: revision.kind === 'old' ? '2' : null,
            })),
          )
          .execute();
      });
      await sql`analyze entry_heads`.execute(db);
      // The trigger filled every head's filter data, odd values included.
      const { rows } = await sql<{ wrong: string }>`select count(*)::text as wrong from entry_heads
        where filter_data is distinct from shapio_scalar_fields(data)`.execute(db);
      expect(rows[0]?.wrong).toBe('0');
    };

    /**
     * Planner settings each query also runs under, so the two forms are compared across different plans (bitmap
     * scans of either GIN index, index scans in list order, sequential scans).
     */
    const PLANS: readonly (readonly string[])[] = [
      [],
      ['enable_bitmapscan = off'],
      ['enable_bitmapscan = off', 'enable_indexscan = off'],
    ];

    type Order = 'none' | 'list';

    /**
     * One filter compiled with `dialect`: with no ORDER BY at all (`none`: the rows a filter selects, in whatever
     * order the plan yields them), or in the order every list query has (`list`: `compileOrderBy`, the default
     * newest first and then the entry ID, which is unique per row, so the order is total). The corpus is written
     * in one transaction, so every entry shares its creation time and the entry ID decides the order.
     */
    const run = async (
      search: string,
      source: HeadSource,
      dialect: ContentSqlDialect,
      order: Order,
      settings: readonly string[] = [],
    ) => {
      const query = parseContentQuery(parseQueryTree(search), {
        model: model.definition,
        locales: ['en'],
        isReadable: () => true,
        isQueryable: () => true,
        allowSnapshot: true,
        resolveModel: () => undefined,
      });
      const compiled = compileHeadQuery(
        {
          siteId: PRIMARY_SITE_ID,
          members: [{ modelId: model.definition.id }],
          source,
          locales: { kind: 'any' },
          conditions: query.filter ? [compileFilter(withLongStrings(query.filter), dialect)] : [],
          orderBy:
            order === 'list'
              ? compileOrderBy(
                  defaultSortTerms(model.definition, () => true),
                  dialect,
                )
              : [],
          limit: ENTRIES * 2,
        },
        dialect,
      );
      const { db } = database.current;
      const { rows, total } = await db.transaction().execute(async (trx) => {
        for (const setting of settings) {
          await sql.raw(`set local ${setting}`).execute(trx);
        }
        return {
          rows: (await compiled.rows.execute(trx)).rows.map((row) => row.entry_id),
          total: Number((await compiled.count.execute(trx)).rows[0]?.total),
        };
      });
      return { sql: compiled.rows.compile(db).sql, rows, total };
    };

    it('on live heads and on a snapshot of older revisions, for every filter and plan', async () => {
      const ONLY_LONG = /^filters(\[\$not\])?\[lt\]\[\$(eq|ne)\]=%40L[13]$/;
      const filter = contentDialectFor('postgres', 'filter');
      const document = contentDialectFor('postgres', 'document');
      let matched = 0;
      let compared = 0;
      const longMatches = new Map<string, number>();
      const sources: HeadSource[] = [
        { kind: 'heads', state: 'published' },
        { kind: 'snapshot', seq: 1 },
      ];
      for (const search of querystrings()) {
        for (const source of sources) {
          const label = `${search} (${source.kind})`;
          const expected = await run(search, source, document, 'list');
          expect(expected.sql).not.toContain('"filter_data" @>');
          expect(expected.total).toBe(expected.rows.length);
          for (const settings of PLANS) {
            const plan = `${label} [${settings.join(', ') || 'default plan'}]`;
            for (const dialect of [filter, document]) {
              // In list order: the same rows in the same order, whichever form and plan.
              const listed = await run(search, source, dialect, 'list', settings);
              expect(listed.rows, plan).toEqual(expected.rows);
              expect(listed.total, plan).toBe(expected.total);
              // With no ORDER BY the plan decides the order: the same rows and count, in any order.
              const unordered = await run(search, source, dialect, 'none', settings);
              expect([...unordered.rows].sort(), plan).toEqual([...expected.rows].sort());
              expect(unordered.total, plan).toBe(expected.total);
              // Only a filter whose one containment is a long string has none against filter_data.
              if (dialect === filter && !ONLY_LONG.test(search)) {
                expect(listed.sql).toContain('"filter_data" @>');
              }
            }
          }
          matched += expected.total;
          compared += 1;
          const long = /^filters\[lt\]\[\$eq\]=%40(L\d)$/.exec(search)?.[1];
          if (long && source.kind === 'heads') {
            longMatches.set(`@${long}`, expected.total);
          }
        }
      }
      expect(compared).toBeGreaterThan(300);
      // Every long string, kept or left out, is matched by some head.
      expect(LONG_PLACEHOLDERS.map((placeholder) => (longMatches.get(placeholder) ?? 0) > 0)).toEqual(
        LONG.map(() => true),
      );
      // Not vacuous: filters match a good share of the corpus, and not all of it.
      expect(matched).toBeGreaterThan(compared * 20);
      expect(matched).toBeLessThan(compared * ENTRIES);
    }, 600_000);
  },
);
