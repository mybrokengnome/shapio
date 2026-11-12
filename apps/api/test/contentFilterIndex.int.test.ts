import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOB_PRIORITY } from '../src/constants/jobPriorities.js';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { contentDialect } from '../src/content/compiler/currentDialect.js';
import { contentDialectFor } from '../src/content/compiler/dialect/index.js';
import { FILTER_STRING_MAX_CHARS, isLongFilterString } from '../src/content/compiler/dialect/postgres.js';
import {
  addFilterCheckNotValid,
  addFilterDataColumn,
  CONTENT_INDEX_RECHECK_MS,
  contentIndexForm,
  EntryHeadsLockBusyError,
  DOCUMENT_INDEX,
  DRAFT_SCALARS_INDEX,
  FILTER_CHECK,
  FILTER_INDEX,
  filterCheckState,
  readContentIndexForm,
  resetContentIndexForm,
  watchContentIndexForm,
  type ContentIndexWatch,
} from '../src/db/contentFilterIndex.js';
import { createDb, type Database } from '../src/db/index.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import * as filterMigration from '../src/db/migrations/20261112120000_entry_heads_scalars_gin.js';
import { createMigrator } from '../src/db/migrator.js';
import type { DB } from '../src/db/types.js';
import { createDeliveryRuntime, type DeliveryRuntime } from '../src/delivery/index.js';
import { RescheduleJobError, type JobContext } from '../src/jobs/types.js';
import * as entryHeadsRepository from '../src/repositories/entryHeads.js';
import * as transferImportRepository from '../src/repositories/transferImport.js';
import {
  buildContentFilterIndex,
  CONTENT_DOCUMENT_INDEX_DROP_JOB,
  CONTENT_DOCUMENT_INDEX_DROP_KEY,
  CONTENT_FILTER_INDEX_JOB,
  CONTENT_FILTER_INDEX_KEY,
  createContentFilterIndexHandlers,
  DOCUMENT_INDEX_DROP_DELAY_MS,
  dropContentDocumentIndex,
  ensureContentDocumentIndexDropJob,
  ensureContentFilterIndexJob,
  keepContentIndexJobsQueued,
  fillFilterData,
  requeueDeadContentFilterIndexJobs,
} from '../src/schema/planner/contentFilterIndex.js';
import { isMysqlRun, isSqliteRun, withSkipReason } from './helpers/dialect.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

/**
 * `entry_heads.filter_data` (ADR 0001, "Filter data"): `shapio_scalar_fields(data)` contains what `data`
 * contains for every document the compiler emits; the trigger keeps the column for every writer; a new install
 * has the column, check and index; an upgraded one fills, proves and indexes the column while writes continue,
 * and no query in the filter form ever misses a row the document form returns.
 */
const skip =
  isSqliteRun() || isMysqlRun() ? 'PostgreSQL only: SQLite and MySQL have no containment index' : undefined;

const PREVIOUS = '20261111120000_item_id_key';
const FILTER = '20261112120000_entry_heads_scalars_gin';
const MODEL_ID = '0d0d0d0d-0000-4000-8000-00000000000a';
const OTHER_MODEL_ID = '0d0d0d0d-0000-4000-8000-00000000000c';
const REVISION_ID = '0d0d0d0d-0000-4000-8000-00000000000b';
const FIELD = 'f';

const jobContext = { log: silentLogger, signal: new AbortController().signal } as unknown as JobContext;

const indexDefinition = async (db: Database, name: string) => {
  const { rows } = await sql<{ definition: string | null }>`
    select pg_get_indexdef(to_regclass(${name})) as definition`.execute(db);
  return rows[0]?.definition ?? null;
};

const exists = async (db: Database | Transaction<DB>, what: 'function' | 'trigger' | 'column') => {
  const query = {
    function: sql<{
      present: boolean;
    }>`select to_regprocedure('shapio_scalar_fields(jsonb)') is not null as present`,
    trigger: sql<{ present: boolean }>`select exists (select 1 from pg_trigger
      where tgrelid = 'entry_heads'::regclass and tgname = 'entry_heads_filter_data') as present`,
    column: sql<{ present: boolean }>`select exists (select 1 from pg_attribute
      where attrelid = 'entry_heads'::regclass and attname = 'filter_data' and not attisdropped) as present`,
  }[what];
  return (await query.execute(db)).rows[0]?.present ?? false;
};

const jobsOf = (db: Database) =>
  db
    .selectFrom('jobs')
    .select(['type', 'idempotency_key', 'status', 'run_at', 'priority', 'attempts', 'last_error'])
    .where('type', 'in', [CONTENT_FILTER_INDEX_JOB, CONTENT_DOCUMENT_INDEX_DROP_JOB])
    .orderBy('type')
    .execute();

/** Heads whose filter data is not what the trigger computes (null included). */
const wrongFilterData = async (db: Database) =>
  Number(
    (
      await sql<{ n: string }>`select count(*)::text as n from entry_heads
        where filter_data is distinct from shapio_scalar_fields(data)`.execute(db)
    ).rows[0]?.n,
  );

const ensureModels = async (db: Database) => {
  for (const [id, key] of [
    [MODEL_ID, 'probe'],
    [OTHER_MODEL_ID, 'other'],
  ] as const) {
    await sql`insert into models (id, kind, api_key) values (${id}, 'collection', ${key})
      on conflict do nothing`.execute(db);
  }
  await sql`insert into schema_revisions (id, model_id, version, hash, definition, created_by_type)
    values (${REVISION_ID}, ${MODEL_ID}, 1, 'fixture', '{}', 'system') on conflict do nothing`.execute(db);
};

/** Heads written straight into the tables, `f` cycling over x0, x1, x2 (the write path is tested elsewhere). */
const insertHeads = async (db: Database, count: number, offset = 0) => {
  await sql`
    with e as (
      insert into entries (site_id, model_id)
      select ${PRIMARY_SITE_ID}::uuid, ${MODEL_ID}::uuid from generate_series(1, ${count}::int)
      returning id, created_at
    ), r as (
      insert into content_revisions (entry_id, locale, schema_revision_id, data, reason, author_type)
      select e.id, 'en', ${REVISION_ID}::uuid,
        jsonb_build_object('dup', 'same', ${FIELD}::text, 'x' || ((row_number() over () + ${offset}::int) % 3),
          'card', jsonb_build_array(jsonb_build_object('__id', md5(e.id::text), ${FIELD}::text, 'x1'))),
        'create', 'system'
      from e
      returning id, entry_id, data
    )
    insert into entry_heads (entry_id, site_id, model_id, locale, state, revision_id, data, entry_created_at)
    select r.entry_id, ${PRIMARY_SITE_ID}::uuid, ${MODEL_ID}::uuid, 'en', 'published', r.id, r.data, e.created_at
    from r join e on e.id = r.entry_id
  `.execute(db);
};

/** Moves `f` of some heads to another value (as a save would), straight in SQL. */
const updateHeads = async (db: Database, count: number, value: string) => {
  await sql`update entry_heads set data = jsonb_set(data, ${`{${FIELD}}`}::text[], to_jsonb(${value}::text))
    where (entry_id, locale, state) in (
      select entry_id, locale, state from entry_heads order by random() limit ${count}::int)`.execute(db);
};

const QUERIES = ['x0', 'x1', 'x2', 'x9'];

/**
 * Counts of each containment, in one snapshot, with the form the catalog says is live then: the truth (the
 * stored value), the document form, and the filter form (null while the column does not exist yet).
 */
const observe = (db: Database) =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const form = await readContentIndexForm(trx);
      const column = await exists(trx, 'column');
      const counts = [];
      for (const value of QUERIES) {
        const target = {
          fieldId: FIELD,
          cast: 'text' as const,
          list: false,
          numericString: false,
          indexed: false,
        };
        const count = async (form: 'document' | 'filter') =>
          Number(
            (
              await sql<{ n: string }>`select count(*)::text as n from entry_heads
                where ${contentDialectFor('postgres', form).fieldEquals(target, value)}`.execute(trx)
            ).rows[0]?.n,
          );
        const truth = Number(
          (
            await sql<{ n: string }>`select count(*)::text as n from entry_heads
              where data ->> ${FIELD} = ${value}`.execute(trx)
          ).rows[0]?.n,
        );
        counts.push({
          value,
          truth,
          document: await count('document'),
          filter: column ? await count('filter') : null,
        });
      }
      return { form, counts };
    });

describe.skipIf(skip)(withSkipReason('shapio_scalar_fields contains what data contains', skip), () => {
  const database = useTestDatabase();

  /**
   * Strings around the long-string limit, in characters that take one to four bytes and one or two UTF-16 code
   * units: `n` code points alternating two characters, so byte or code-unit counting would disagree.
   */
  const aroundLimit = fc
    .tuple(
      fc.integer({ min: FILTER_STRING_MAX_CHARS - 3, max: FILTER_STRING_MAX_CHARS + 3 }),
      fc.constantFrom('a', 'é', '€', '😀'),
      fc.constantFrom('a', '😀'),
    )
    .map(([length, even, odd]) => Array.from({ length }, (_, index) => (index % 2 ? odd : even)).join(''));
  const scalar = fc.oneof(
    { arbitrary: fc.constantFrom('a', 'b', '', 'A', 'true', '1'), weight: 6 },
    { arbitrary: fc.constantFrom(0, 1, 1.5, -2, 1e21), weight: 4 },
    { arbitrary: fc.boolean(), weight: 2 },
    { arbitrary: aroundLimit, weight: 1 },
  );
  const leaf = fc.oneof(scalar, fc.constant(null));
  const value: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' },
      leaf,
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(fc.constantFrom('a', 'k', '__id', '__component'), tie('node'), { maxKeys: 3 }),
    ),
  })).node;
  const keys = fc.constantFrom('f1', 'f2', 'f3', '__id');
  /** Mostly objects, as stored; also what a stray row could hold (an array, a scalar, JSON null). */
  const documents = fc.oneof(
    { arbitrary: fc.dictionary(keys, value, { maxKeys: 4 }), weight: 12 },
    { arbitrary: fc.array(value, { maxLength: 3 }), weight: 1 },
    { arbitrary: scalar, weight: 1 },
    { arbitrary: fc.constant(null), weight: 1 },
  );
  /** Exactly the shapes `fieldEquals` binds: `{fieldId: scalar}` or `{fieldId: [scalar]}`. */
  const queries = fc
    .tuple(keys, scalar, fc.boolean())
    .map(([key, item, list]) => ({ [key]: list ? [item] : item }));
  const isScalar = (item: unknown) => item !== null && typeof item !== 'object';
  /** Half the queries name a scalar the document holds (at the top or in a top-level array), so many match. */
  const cases = fc.tuple(documents, queries, fc.boolean(), fc.nat()).map(([d, random, aimed, pick]) => {
    const fields = d !== null && typeof d === 'object' && !Array.isArray(d) ? d : {};
    const candidates = Object.entries(fields).flatMap(([key, held]) => [
      ...(isScalar(held) ? [{ [key]: held }] : []),
      ...(Array.isArray(held) ? held.filter(isScalar).map((item) => ({ [key]: [item] })) : []),
      // The same scalar in the other shape: an array never contains a bare scalar, and the reverse.
      ...(isScalar(held) ? [{ [key]: [held] }] : []),
    ]);
    return { d, q: aimed && candidates.length > 0 ? candidates[pick % candidates.length] : random };
  });

  it('for every containment document the compiler can emit, on arbitrary stored data', async () => {
    const sample = fc.sample(cases, { numRuns: 5000, seed: 20261112 }).map((pair) => {
      const [queried] = Object.values(pair.q ?? {});
      // What the compiler decides: a long string is matched against the whole document in either form.
      const long = isLongFilterString(Array.isArray(queried) ? queried[0] : queried);
      return { ...pair, long };
    });
    const { rows } = await sql<{ i: string; d: unknown; q: unknown; full: boolean; scalars: boolean }>`
      select c.i::text as i, c.pair -> 'd' as d, c.pair -> 'q' as q,
        (c.pair -> 'd') @> (c.pair -> 'q') as full,
        case when (c.pair ->> 'long')::boolean then (c.pair -> 'd')
          else shapio_scalar_fields(c.pair -> 'd') end @> (c.pair -> 'q') as scalars
      from jsonb_array_elements(${JSON.stringify(sample)}::jsonb) with ordinality as c(pair, i)
    `.execute(database.current.db);
    expect(rows).toHaveLength(sample.length);
    expect(rows.filter((row) => row.full !== row.scalars)).toEqual([]);
    // Not vacuous: both answers occur often, also for strings at the limit (kept) and past it (left out).
    expect(rows.filter((row) => row.full).length).toBeGreaterThan(500);
    expect(rows.filter((row) => !row.full).length).toBeGreaterThan(500);
    const atLimit = sample.filter((pair, index) => {
      const [queried] = Object.values(pair.q ?? {});
      const text: unknown = Array.isArray(queried) ? (queried[0] as unknown) : queried;
      return typeof text === 'string' && text.length >= FILTER_STRING_MAX_CHARS - 3 && rows[index]?.full;
    });
    expect(atLimit.filter((pair) => pair.long).length).toBeGreaterThan(5);
    expect(atLimit.filter((pair) => !pair.long).length).toBeGreaterThan(5);
    // Not vacuous: some documents are not objects.
    expect(
      sample.filter((pair) => pair.d === null || typeof pair.d !== 'object' || Array.isArray(pair.d)).length,
    ).toBeGreaterThan(200);
  });

  it('counts characters, not bytes or UTF-16 code units, exactly as the compiler does', async () => {
    const strings = [
      'a'.repeat(FILTER_STRING_MAX_CHARS),
      'a'.repeat(FILTER_STRING_MAX_CHARS + 1),
      '😀'.repeat(FILTER_STRING_MAX_CHARS),
      '😀'.repeat(FILTER_STRING_MAX_CHARS + 1),
      '€'.repeat(FILTER_STRING_MAX_CHARS),
      `${'é'.repeat(FILTER_STRING_MAX_CHARS - 1)}😀`,
      `${'é'.repeat(FILTER_STRING_MAX_CHARS)}😀`,
    ];
    const { rows } = await sql<{ kept: boolean }>`
      select shapio_scalar_fields(jsonb_build_object('s', s, 'l', jsonb_build_array(s, 'x'))) = jsonb_build_object('s', s, 'l', jsonb_build_array(s, 'x')) as kept
      from unnest(${strings}::text[]) with ordinality as t(s, i) order by i`.execute(database.current.db);
    expect(rows.map((row) => row.kept)).toEqual(strings.map((text) => !isLongFilterString(text)));
    expect(rows.map((row) => row.kept)).toEqual([true, false, true, false, true, true, false]);
  });

  it('keeps scalars and the scalar elements of arrays, drops nulls, objects, long strings and empty arrays', async () => {
    const long = 'x'.repeat(FILTER_STRING_MAX_CHARS + 1);
    const { rows } = await sql<{ kept: unknown }>`select shapio_scalar_fields(${JSON.stringify({
      s: 'x',
      n: 1,
      b: false,
      tags: ['a', 'b'],
      mixed: [{ k: 1 }, 'x', ['y'], null, long],
      empty: [],
      items: [{ __id: 'i1', f: 'x' }],
      nested: [['x']],
      card: { f: 'x' },
      nothing: null,
      long,
      longs: [long],
    })}::jsonb) as kept`.execute(database.current.db);
    expect(rows[0]?.kept).toEqual({ s: 'x', n: 1, b: false, tags: ['a', 'b'], mixed: ['x', null] });
    // Data that is not an object (no write stores it, but a stray row must not make writes or the fill fail).
    const { rows: others } = await sql<{ kept: unknown }>`
      select shapio_scalar_fields(d) as kept from unnest(array['[1, "x"]', '"x"', '1', 'null', 'true']::jsonb[]) as d`.execute(
      database.current.db,
    );
    expect(others.map((row) => row.kept)).toEqual([{}, {}, {}, {}, {}]);
    const { rows: definition } = await sql<{ volatility: string; parallel: string; strict: boolean }>`
      select provolatile as volatility, proparallel as parallel, proisstrict as strict
      from pg_proc where oid = to_regprocedure('shapio_scalar_fields(jsonb)')`.execute(database.current.db);
    expect(definition).toEqual([{ volatility: 'i', parallel: 's', strict: true }]);
  });
});

describe.skipIf(skip)(withSkipReason('filter data on a new install', skip), () => {
  const database = useTestDatabase();

  it('has the column, trigger, validated check and index, no job, and the filter form', async () => {
    const { db } = database.current;
    for (const what of ['function', 'trigger', 'column'] as const) {
      expect(await exists(db, what), what).toBe(true);
    }
    expect(await filterCheckState(db)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('valid');
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('missing');
    expect(await jobsOf(db)).toEqual([]);
    expect(await readContentIndexForm(db)).toBe('filter');
    // The index covers the column the compiler emits containment against.
    expect(await indexDefinition(db, FILTER_INDEX)).toMatch(/USING gin \(filter_data jsonb_path_ops\)$/);
    const target = {
      fieldId: FIELD,
      cast: 'text' as const,
      list: false,
      numericString: false,
      indexed: false,
    };
    // A process emits the document form until its first catalog read confirms the filter form.
    expect(contentIndexForm()).toBe('document');
    expect(sql`${contentDialect().fieldEquals(target, 'x')}`.compile(db).sql).toBe('("data" @> $1::jsonb)');
    const watch = watchContentIndexForm(db, silentLogger);
    try {
      await watch.ready;
      expect(contentIndexForm()).toBe('filter');
      expect(sql`${contentDialect().fieldEquals(target, 'x')}`.compile(db).sql).toBe(
        '("filter_data" @> $1::jsonb)',
      );
      // A string `filter_data` leaves out is matched against the whole document, in either form.
      const long = '😀'.repeat(FILTER_STRING_MAX_CHARS + 1);
      expect(sql`${contentDialect().fieldEquals(target, long)}`.compile(db).sql).toBe(
        '("data" @> $1::jsonb)',
      );
    } finally {
      watch.stop();
      resetContentIndexForm();
    }
  });

  it('down restores the whole-document index and removes the rest; up again rebuilds the install', async () => {
    const { db } = database.current;
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('missing');
    expect(await filterCheckState(db)).toBe('missing');
    for (const what of ['function', 'trigger', 'column'] as const) {
      expect(await exists(db, what), what).toBe(false);
    }
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
    expect(await readContentIndexForm(db)).toBe('filter');
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('missing');
    expect(await jobsOf(db)).toEqual([]);
  });
});

describe.skipIf(skip)(withSkipReason('every writer keeps filter data right', skip), () => {
  const database = useTestDatabase();

  beforeAll(async () => {
    await ensureModels(database.current.db);
  });

  it('insert, update, rewriteData, changeModel, import, locale moves and raw SQL', async () => {
    const { db } = database.current;
    const now = new Date();
    const filterOf = async (entryId: string, state = 'draft') =>
      (
        await sql<{ filter: unknown }>`select filter_data as filter from entry_heads
          where entry_id = ${entryId}::uuid and state = ${state}`.execute(db)
      ).rows[0]?.filter;
    const newEntry = async () => {
      const [entry] = (
        await sql<{ id: string }>`insert into entries (site_id, model_id)
          values (${PRIMARY_SITE_ID}::uuid, ${MODEL_ID}::uuid) returning id`.execute(db)
      ).rows;
      const revision = randomUUID();
      await sql`insert into content_revisions (id, entry_id, locale, schema_revision_id, data, reason, author_type)
        values (${revision}::uuid, ${entry?.id}::uuid, 'en', ${REVISION_ID}::uuid, '{}', 'create', 'system')`.execute(
        db,
      );
      return { entryId: entry?.id ?? '', revisionId: revision };
    };
    const card = { __id: 'i1', heading: 'h' };
    const write = (entry: { entryId: string; revisionId: string }, data: Record<string, unknown>) => ({
      ...entry,
      modelId: MODEL_ID,
      locale: 'en',
      state: 'draft' as const,
      data,
      autosavedAt: null,
      now,
    });

    const first = await newEntry();
    await entryHeadsRepository.insert(write(first, { [FIELD]: 'a', cards: [card] }), db);
    expect(await filterOf(first.entryId)).toEqual({ [FIELD]: 'a' });
    await entryHeadsRepository.update(write(first, { [FIELD]: 'b', tags: ['t'], cards: [card] }), db);
    expect(await filterOf(first.entryId)).toEqual({ [FIELD]: 'b', tags: ['t'] });
    const [head] = await entryHeadsRepository.findForEntry(first.entryId, db);
    expect(
      await entryHeadsRepository.rewriteData(
        { entryId: first.entryId, locale: 'en', state: 'draft', changeSeq: String(head?.change_seq) },
        { [FIELD]: 'c', rich: { type: 'doc' } },
        db,
      ),
    ).toBe(true);
    expect(await filterOf(first.entryId)).toEqual({ [FIELD]: 'c' });
    await sql`insert into schema_revisions (id, model_id, version, hash, definition, created_by_type)
      values (${randomUUID()}::uuid, ${OTHER_MODEL_ID}::uuid, 1, 'fixture', '{}', 'system')`.execute(db);
    await sql`update entries set model_id = ${OTHER_MODEL_ID}::uuid where id = ${first.entryId}::uuid`.execute(
      db,
    );
    await entryHeadsRepository.changeModel(
      { entryId: first.entryId, locale: 'en', state: 'draft' },
      {
        modelId: OTHER_MODEL_ID,
        data: { [FIELD]: 'd' },
        revisionId: first.revisionId,
        autosavedAt: null,
        now,
      },
      db,
    );
    expect(await filterOf(first.entryId)).toEqual({ [FIELD]: 'd' });

    const imported = await newEntry();
    const importedHead = {
      entryId: imported.entryId,
      modelId: MODEL_ID,
      locale: 'en',
      state: 'published' as const,
      revisionId: imported.revisionId,
      autosavedAt: null,
      version: 3,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await transferImportRepository.insertHead({ ...importedHead, data: { [FIELD]: 'e', n: 1 } }, db);
    expect(await filterOf(imported.entryId, 'published')).toEqual({ [FIELD]: 'e', n: 1 });
    await transferImportRepository.moveHead({ ...importedHead, data: { [FIELD]: 'f', cards: [card] } }, db);
    expect(await filterOf(imported.entryId, 'published')).toEqual({ [FIELD]: 'f' });

    // A locale move leaves data, and so filter data, as it was.
    await sql`update entry_heads set locale = 'fr' where entry_id = ${imported.entryId}::uuid`.execute(db);
    expect(await filterOf(imported.entryId, 'published')).toEqual({ [FIELD]: 'f' });

    // Raw SQL: whatever a statement writes into filter_data, the trigger replaces it with the computed value.
    const raw = await newEntry();
    await sql`insert into entry_heads (entry_id, site_id, model_id, locale, state, revision_id, data, filter_data)
      values (${raw.entryId}::uuid, ${PRIMARY_SITE_ID}::uuid, ${MODEL_ID}::uuid, 'en', 'draft',
        ${raw.revisionId}::uuid, ${JSON.stringify({ [FIELD]: 'g', cards: [card] })}::jsonb,
        '{"forged": true}'::jsonb)`.execute(db);
    expect(await filterOf(raw.entryId)).toEqual({ [FIELD]: 'g' });
    await sql`update entry_heads set data = data || '{"h": "i"}' where entry_id = ${raw.entryId}::uuid`.execute(
      db,
    );
    expect(await filterOf(raw.entryId)).toEqual({ [FIELD]: 'g', h: 'i' });
    await sql`update entry_heads set filter_data = '{"forged": true}' where entry_id = ${raw.entryId}::uuid`.execute(
      db,
    );
    expect(await filterOf(raw.entryId)).toEqual({ [FIELD]: 'g', h: 'i' });
    await sql`update entry_heads set filter_data = null where entry_id = ${raw.entryId}::uuid`.execute(db);
    expect(await filterOf(raw.entryId)).toEqual({ [FIELD]: 'g', h: 'i' });

    expect(await wrongFilterData(db)).toBe(0);
  });

  it("the trigger finds the function whatever the writer's search_path, and stray data does not fail writes", async () => {
    const { db } = database.current;
    await insertHeads(db, 2);
    const { rows } = await sql<{ schema: string }>`select current_schema() as schema`.execute(db);
    const heads = sql.id(rows[0]?.schema ?? 'public', 'entry_heads');
    await db.transaction().execute(async (trx) => {
      await sql`set local search_path = pg_catalog`.execute(trx);
      await sql`update ${heads} set data = data || '{"moved": "yes"}'::jsonb`.execute(trx);
    });
    expect(await wrongFilterData(db)).toBe(0);
    // A head whose data is not an object (no write path stores one) gets empty filter data, no error.
    await sql`update entry_heads set data = '[1, "x"]'::jsonb
      where entry_id = (select entry_id from entry_heads limit 1)`.execute(db);
    const { rows: stray } = await sql<{ filter: unknown }>`
      select filter_data as filter from entry_heads where jsonb_typeof(data) = 'array'`.execute(db);
    expect(stray).toEqual([{ filter: {} }]);
  });
});

describe.skipIf(skip)(withSkipReason('filter data on an upgraded instance', skip), () => {
  const database = useTestDatabase({ empty: true });
  const template = useTestDatabase();
  let watch: ContentIndexWatch | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    watch?.stop();
    vi.useRealTimers();
    resetContentIndexForm();
  });
  afterAll(() => {
    resetContentIndexForm();
  });

  it('fills, proves and indexes the column while writes continue, switches, drops the old index later, rolls back', async () => {
    const { db } = database.current;
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    await ensureModels(db);
    await insertHeads(db, 1200);

    // On a table with heads the migration creates the functions and enqueues the job: no column, no trigger.
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
    expect(await exists(db, 'function')).toBe(true);
    expect(await exists(db, 'column')).toBe(false);
    expect(await exists(db, 'trigger')).toBe(false);
    expect(await filterCheckState(db)).toBe('missing');
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('missing');
    expect(await jobsOf(db)).toMatchObject([
      { type: CONTENT_FILTER_INDEX_JOB, idempotency_key: CONTENT_FILTER_INDEX_KEY, status: 'pending' },
    ]);
    expect([filterMigration.CONTENT_FILTER_INDEX_JOB, filterMigration.CONTENT_FILTER_INDEX_KEY]).toEqual([
      CONTENT_FILTER_INDEX_JOB,
      CONTENT_FILTER_INDEX_KEY,
    ]);
    expect([
      filterMigration.CONTENT_DOCUMENT_INDEX_DROP_JOB,
      filterMigration.CONTENT_DOCUMENT_INDEX_DROP_KEY,
    ]).toEqual([CONTENT_DOCUMENT_INDEX_DROP_JOB, CONTENT_DOCUMENT_INDEX_DROP_KEY]);
    // Rows written after the migration, before the column exists.
    await insertHeads(db, 30, 1);

    watch = watchContentIndexForm(db, silentLogger);
    await watch.ready;
    expect(contentIndexForm()).toBe('document');
    // Served right without the column: the document form never names it.
    const early = await observe(db);
    expect(early.form).toBe('document');
    for (const count of early.counts) {
      expect(count.filter).toBe(null);
      expect(count.document).toBe(count.truth);
    }
    expect(early.counts.find((count) => count.value === 'x1')?.truth).toBeGreaterThan(300);

    // The job's first step adds the column under a polite lock: while a transaction holds a read lock, reads
    // keep passing, and the job reschedules itself instead of failing.
    const handlers = new Map(createContentFilterIndexHandlers(db));
    const build = handlers.get(CONTENT_FILTER_INDEX_JOB);
    const drop = handlers.get(CONTENT_DOCUMENT_INDEX_DROP_JOB);
    const reader = await holdReadLock(db);
    try {
      const attempt = (build?.(jobContext) ?? Promise.resolve()).then(
        () => undefined,
        (error: unknown) => error,
      );
      await readsPassTheWait(db);
      const failure = await attempt;
      expect(failure).toBeInstanceOf(RescheduleJobError);
      expect(await exists(db, 'column')).toBe(false);
    } finally {
      await reader.release();
    }

    // An interrupted build left an INVALID index under the name: it does not count.
    await expect(
      sql`create unique index concurrently ${sql.id(FILTER_INDEX)} on entry_heads ((data ->> 'dup'))`.execute(
        db,
      ),
    ).rejects.toThrow();
    expect(await getIndexState(db, FILTER_INDEX)).toBe('invalid');

    // While the job runs: a writer inserts and updates heads, and an observer checks, in one snapshot at a time,
    // that whenever the catalog says the filter form is live, it answers exactly what the document form does.
    let running = true;
    const observations: Awaited<ReturnType<typeof observe>>[] = [];
    const writer = (async () => {
      for (let round = 0; running; round += 1) {
        await insertHeads(db, 5, round);
        await updateHeads(db, 5, `x${round % 3}`);
      }
    })();
    const observer = (async () => {
      while (running) {
        observations.push(await observe(db));
      }
    })();
    let batches = 0;
    const startedAt = Date.now();
    try {
      // Rows written between the trigger and the fill, between batches of the fill, and an update to a row the
      // fill already filled.
      await buildContentFilterIndex(db, silentLogger, {
        afterColumn: async () => {
          expect(await exists(db, 'trigger')).toBe(true);
          await insertHeads(db, 11, 2);
        },
        afterBatch: async () => {
          batches += 1;
          await insertHeads(db, 7, batches);
          await updateHeads(db, 7, 'x2');
        },
      });
      await expect(build?.(jobContext)).resolves.toEqual({ outcome: 'exists' });
      // A few more observations with the filter form live, writes still going.
      const seen = observations.length;
      await waitFor(async () => observations.length >= seen + 5, { description: 'more observations' });
    } finally {
      running = false;
      await Promise.all([writer, observer]);
    }
    expect(batches).toBeGreaterThanOrEqual(3);

    // The invariant: the live form always finds every row, written before the column, between the trigger and
    // the fill, and after, before and after the switch.
    const live = observations.filter((observation) => observation.form === 'filter');
    expect(live.length).toBeGreaterThan(0);
    for (const observation of observations) {
      for (const count of observation.counts) {
        const served = observation.form === 'filter' ? count.filter : count.document;
        expect(served, JSON.stringify(observation)).toBe(count.truth);
      }
    }
    // And the guard mattered: before the switch the column existed but was incomplete.
    expect(
      observations.some(
        (observation) =>
          observation.form === 'document' &&
          observation.counts.some((count) => count.filter !== null && count.filter < count.document),
      ),
    ).toBe(true);

    expect(await wrongFilterData(db)).toBe(0);
    expect(await filterCheckState(db)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('valid');
    // Built by the job exactly as the migration builds it on a new install.
    expect(await indexDefinition(db, FILTER_INDEX)).toBe(
      await indexDefinition(template.current.db, FILTER_INDEX),
    );
    // The check refuses a head without filter data, whoever writes (the trigger fills it; this goes around it).
    await sql`alter table entry_heads disable trigger entry_heads_filter_data`.execute(db);
    await expect(
      sql`update entry_heads set filter_data = null where entry_id in (select entry_id from entry_heads limit 1)`.execute(
        db,
      ),
    ).rejects.toThrow(FILTER_CHECK);
    await sql`alter table entry_heads enable trigger entry_heads_filter_data`.execute(db);

    // The old index stays until every process has had time to switch; the drop is queued for later.
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('valid');
    const queued = (await jobsOf(db)).find((job) => job.type === CONTENT_DOCUMENT_INDEX_DROP_JOB);
    // Ahead of bulk background work, so it runs soon after it is due.
    expect(queued).toMatchObject({
      idempotency_key: CONTENT_DOCUMENT_INDEX_DROP_KEY,
      status: 'pending',
      priority: JOB_PRIORITY.normal,
    });
    expect(new Date(queued?.run_at ?? 0).getTime()).toBeGreaterThanOrEqual(
      startedAt + DOCUMENT_INDEX_DROP_DELAY_MS,
    );

    // The process sees the switch at its next look; one more build changes nothing and queues no second drop.
    expect(contentIndexForm()).toBe('document');
    await vi.advanceTimersByTimeAsync(CONTENT_INDEX_RECHECK_MS);
    await waitFor(async () => contentIndexForm() === 'filter', { description: 'the switch' });
    await expect(build?.(jobContext)).resolves.toEqual({ outcome: 'exists' });
    expect((await jobsOf(db)).filter((job) => job.type === CONTENT_DOCUMENT_INDEX_DROP_JOB)).toHaveLength(1);

    // A draft's scalar index left on some database goes with the whole-document index.
    await sql`create index ${sql.id(DRAFT_SCALARS_INDEX)} on entry_heads ((data ->> 'dup'))`.execute(db);
    const before = await observe(db);
    await expect(drop?.(jobContext)).resolves.toEqual({ dropped: true });
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('missing');
    expect(await getIndexState(db, DRAFT_SCALARS_INDEX)).toBe('missing');
    await expect(drop?.(jobContext)).resolves.toEqual({ dropped: false });
    expect((await observe(db)).counts).toEqual(before.counts);

    // Dead jobs get a new round a day later, once.
    await sql`update jobs set status = 'dead', finished_at = now() - interval '2 days'
      where idempotency_key in (${CONTENT_FILTER_INDEX_KEY}, ${CONTENT_DOCUMENT_INDEX_DROP_KEY})`.execute(db);
    expect(await requeueDeadContentFilterIndexJobs(db, new Date(), silentLogger)).toBe(2);
    expect((await jobsOf(db)).map((job) => job.status)).toEqual(['pending', 'pending']);
    expect(await requeueDeadContentFilterIndexJobs(db, new Date(), silentLogger)).toBe(0);

    // `down` brings the whole-document index back and removes the rest; `up` again starts over.
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('missing');
    expect(await filterCheckState(db)).toBe('missing');
    for (const what of ['function', 'trigger', 'column'] as const) {
      expect(await exists(db, what), what).toBe(false);
    }
    expect(await jobsOf(db)).toEqual([]);
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
    expect(await jobsOf(db)).toMatchObject([{ type: CONTENT_FILTER_INDEX_JOB, status: 'pending' }]);
    expect(await readContentIndexForm(db)).toBe('document');
  }, 120_000);
});

/** Runs `statement` in a transaction kept open until `release` (the locks it took stay held). */
const holdLock = async (db: Database, statement: RawBuilder<unknown>) => {
  let release = () => undefined as void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = () => undefined as void;
  const held = new Promise<void>((resolve) => {
    holding = resolve;
  });
  const done = db.transaction().execute(async (trx) => {
    await statement.execute(trx);
    holding();
    await released;
  });
  await held;
  return {
    release: async () => {
      release();
      await done;
    },
  };
};

/** Holds ACCESS SHARE on `entry_heads` in an open transaction (what `pg_dump` or a long export does). */
const holdReadLock = (db: Database) => holdLock(db, sql`select count(*) from entry_heads`);

/** Whether some backend waits for ACCESS EXCLUSIVE on `entry_heads` right now. */
const exclusiveLockWaiting = async (db: Database) =>
  (
    await sql<{ waiting: boolean }>`select exists (select 1 from pg_locks
      where relation = to_regclass('entry_heads') and mode = 'AccessExclusiveLock' and not granted) as waiting`.execute(
      db,
    )
  ).rows[0]?.waiting ?? false;

/**
 * A read of `entry_heads` that fails if it queues for 2 s: far beyond one polite lock attempt (150 ms), far
 * below a wait that lasts until the holder ends.
 */
const boundedRead = (db: Database) =>
  db.transaction().execute(async (trx) => {
    await sql`set local statement_timeout = '2s'`.execute(trx);
    await sql`select count(*) from entry_heads`.execute(trx);
  });

/** While some backend keeps trying for the table lock, user reads pass it. */
const readsPassTheWait = async (db: Database) => {
  await waitFor(async () => exclusiveLockWaiting(db), {
    intervalMs: 5,
    description: 'an attempt to lock entry_heads',
  });
  for (let read = 0; read < 3; read += 1) {
    await boundedRead(db);
  }
};

describe.skipIf(skip)(
  withSkipReason('strong locks on entry_heads never hold user queries for long', skip),
  () => {
    const database = useTestDatabase({ empty: true });

    beforeAll(async () => {
      const { db } = database.current;
      expect((await createMigrator(db).migrateTo(PREVIOUS)).error).toBeUndefined();
      await ensureModels(db);
      await insertHeads(db, 50);
    });

    it('the migration on a table with heads takes no lock a user write waits for, nor one that waits for it', async () => {
      const { db } = database.current;
      // An open write transaction (ROW EXCLUSIVE): any lock stronger than the read that finds a head would wait.
      const writer = await holdLock(
        db,
        sql`update entry_heads set data = data where entry_id = (select entry_id from entry_heads limit 1)`,
      );
      try {
        expect((await createMigrator(db).migrateTo(FILTER)).error).toBeUndefined();
      } finally {
        await writer.release();
      }
      expect(await exists(db, 'column')).toBe(false);
      expect(await exists(db, 'trigger')).toBe(false);
    });

    it('the job adds the column and trigger politely, giving up while a transaction holds the table', async () => {
      const { db } = database.current;
      const holder = await holdReadLock(db);
      try {
        const outcome = addFilterDataColumn(db, { attempts: 4 }).then(
          () => 'added',
          (error: unknown) => error,
        );
        await readsPassTheWait(db);
        expect(await outcome).toBeInstanceOf(EntryHeadsLockBusyError);
        expect(await exists(db, 'column')).toBe(false);
      } finally {
        await holder.release();
      }
      expect(await addFilterDataColumn(db)).toBe(true);
      expect(await exists(db, 'column')).toBe(true);
      expect(await exists(db, 'trigger')).toBe(true);
      // Guarded: a second run finds both and takes no lock.
      expect(await addFilterDataColumn(db)).toBe(false);
    });

    it('the migration gives up with a clear message, and leaves lock_timeout as it was', async () => {
      const { db } = database.current;
      await db.transaction().execute(async (trx) => {
        await sql`set local lock_timeout = '7s'`.execute(trx);
        await filterMigration.lockEntryHeads(trx as unknown as Kysely<unknown>);
        const { rows } = await sql<{
          setting: string;
        }>`select current_setting('lock_timeout') as setting`.execute(trx);
        expect(rows[0]?.setting).toBe('7s');
      });
      const holder = await holdReadLock(db);
      try {
        await expect(
          db
            .transaction()
            .execute((trx) => filterMigration.lockEntryHeads(trx as unknown as Kysely<unknown>, 500)),
        ).rejects.toThrow(/kept entry_heads locked/);
      } finally {
        await holder.release();
      }
    });

    it('adding the check waits politely, and the job reschedules itself instead of failing', async () => {
      const { db } = database.current;
      await fillFilterData(db, silentLogger);
      const holder = await holdReadLock(db);
      try {
        const adding = addFilterCheckNotValid(db, { attempts: 4 });
        const outcome = adding.then(
          () => 'added',
          (error: unknown) => error,
        );
        await readsPassTheWait(db);
        expect(await outcome).toBeInstanceOf(EntryHeadsLockBusyError);
        expect(await filterCheckState(db)).toBe('missing');
        const build = new Map(createContentFilterIndexHandlers(db)).get(CONTENT_FILTER_INDEX_JOB);
        const failure = await build?.(jobContext).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(RescheduleJobError);
        expect((failure as RescheduleJobError).runAt.getTime()).toBeGreaterThan(Date.now());
      } finally {
        await holder.release();
      }
      await addFilterCheckNotValid(db);
      expect(await filterCheckState(db)).toBe('notValid');
    }, 60_000);
  },
);

describe.skipIf(skip)(withSkipReason('the job that switches the form stays queued', skip), () => {
  const database = useTestDatabase({ empty: true });
  let watch: ContentIndexWatch | undefined;

  beforeAll(async () => {
    const { db } = database.current;
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    await ensureModels(db);
    await insertHeads(db, 20);
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  afterEach(() => {
    watch?.stop();
    vi.useRealTimers();
    resetContentIndexForm();
  });

  const buildJob = async (db: Database) =>
    (await jobsOf(db)).find((job) => job.type === CONTENT_FILTER_INDEX_JOB);
  /** What a 0.8.2 worker does with a job type it does not know. */
  const refusedByOldWorker = (db: Database) =>
    sql`update jobs set status = 'dead', attempts = 1, finished_at = now(),
      last_error = ${`No handler registered for job type "${CONTENT_FILTER_INDEX_JOB}"`}
      where idempotency_key = ${CONTENT_FILTER_INDEX_KEY}`.execute(db);

  it('queues it again when an older worker refused it or it is missing, at startup and on each look', async () => {
    const { db } = database.current;
    await refusedByOldWorker(db);
    const ensure = vi.fn((form: 'document' | 'filter') => keepContentIndexJobsQueued(db, silentLogger, form));
    watch = watchContentIndexForm(db, silentLogger, { onLook: ensure });
    await watch.ready;
    expect(contentIndexForm()).toBe('document');
    expect(await buildJob(db)).toMatchObject({ status: 'pending', attempts: 0 });

    await refusedByOldWorker(db);
    await vi.advanceTimersByTimeAsync(CONTENT_INDEX_RECHECK_MS);
    await waitFor(async () => (await buildJob(db))?.status === 'pending', { description: 'queued again' });
    expect(ensure).toHaveBeenCalledTimes(2);

    await sql`delete from jobs where idempotency_key = ${CONTENT_FILTER_INDEX_KEY}`.execute(db);
    expect(await ensureContentFilterIndexJob(db, silentLogger)).toBe('queued');
    expect(await ensureContentFilterIndexJob(db, silentLogger)).toBe('live');
    expect((await jobsOf(db)).filter((job) => job.type === CONTENT_FILTER_INDEX_JOB)).toHaveLength(1);

    // A job that died of its own failures is left to the daily round (no loop).
    await sql`update jobs set status = 'dead', finished_at = now(), last_error = 'Error: validation failed'
      where idempotency_key = ${CONTENT_FILTER_INDEX_KEY}`.execute(db);
    expect(await ensureContentFilterIndexJob(db, silentLogger)).toBe('waiting');
    expect(await buildJob(db)).toMatchObject({ status: 'dead' });
    await sql`update jobs set finished_at = now() - interval '2 days'
      where idempotency_key = ${CONTENT_FILTER_INDEX_KEY}`.execute(db);
    expect(await ensureContentFilterIndexJob(db, silentLogger)).toBe('requeued');
  });

  it('then keeps the drop queued the same way, and stops looking once the old index is gone', async () => {
    const { db } = database.current;
    const build = new Map(createContentFilterIndexHandlers(db)).get(CONTENT_FILTER_INDEX_JOB);
    await build?.(jobContext);
    const dropJob = async () =>
      (await jobsOf(db)).find((job) => job.type === CONTENT_DOCUMENT_INDEX_DROP_JOB);
    await sql`update jobs set status = 'dead', attempts = 1, finished_at = now(),
      last_error = ${`No handler registered for job type "${CONTENT_DOCUMENT_INDEX_DROP_JOB}"`}
      where idempotency_key = ${CONTENT_DOCUMENT_INDEX_DROP_KEY}`.execute(db);
    const ensure = vi.fn((form: 'document' | 'filter') => keepContentIndexJobsQueued(db, silentLogger, form));
    watch = watchContentIndexForm(db, silentLogger, { onLook: ensure });
    await watch.ready;
    expect(contentIndexForm()).toBe('filter');
    expect(await dropJob()).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await ensureContentDocumentIndexDropJob(db, silentLogger)).toBe('live');

    await dropContentDocumentIndex(db, silentLogger);
    await vi.advanceTimersByTimeAsync(CONTENT_INDEX_RECHECK_MS);
    await waitFor(async () => ensure.mock.calls.length === 2, { description: 'one more look' });
    expect(await ensureContentDocumentIndexDropJob(db, silentLogger)).toBe('finished');
    await vi.advanceTimersByTimeAsync(3 * CONTENT_INDEX_RECHECK_MS);
    expect(ensure).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(skip)(withSkipReason('in-process delivery on a database that is down at first', skip), () => {
  const admin = useTestDatabase();
  const late = `shapio_t_${process.pid}_late_${randomUUID().slice(0, 8)}`;
  let lateDb: Database | undefined;
  let runtime: DeliveryRuntime | undefined;

  afterAll(async () => {
    await runtime?.close();
    await lateDb?.destroy();
    await sql`drop database if exists ${sql.id(late)} with (force)`.execute(admin.current.db);
    resetContentIndexForm();
    vi.useRealTimers();
  });

  it('answers right while the column is incomplete, and switches once a look confirms the filter form', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const url = new URL(admin.current.url);
    url.pathname = `/${late}`;
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    // The database does not exist yet: the first catalog read fails.
    runtime = createDeliveryRuntime({ databaseUrl: url.toString(), poolMax: 2, logger });
    const reader = runtime.db;
    await waitFor(
      async () => lines.some((line) => line.includes('checking the content filter index failed')),
      {
        description: 'the first look failed',
      },
    );
    expect(contentIndexForm()).toBe('document');

    // It comes up as an upgraded instance whose filter data is not filled yet.
    await sql`create database ${sql.id(late)} template template0`.execute(admin.current.db);
    lateDb = createDb({ connectionString: url.toString(), poolMax: 2, applicationName: 'shapio-test' });
    const migrator = createMigrator(lateDb);
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    await ensureModels(lateDb);
    await insertHeads(lateDb, 300);
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
    await insertHeads(lateDb, 30, 1);

    const target = {
      fieldId: FIELD,
      cast: 'text' as const,
      list: false,
      numericString: false,
      indexed: false,
    };
    const right = async () => {
      const count = async (condition: RawBuilder<unknown>) =>
        Number(
          (
            await sql<{ n: string }>`select count(*)::text as n from entry_heads where ${condition}`.execute(
              reader,
            )
          ).rows[0]?.n,
        );
      const answered = await count(contentDialect().fieldEquals(target, 'x1'));
      const truth = await count(sql`data ->> ${FIELD} = 'x1'`);
      expect(truth).toBeGreaterThan(100);
      expect(answered).toBe(truth);
    };
    await vi.advanceTimersByTimeAsync(CONTENT_INDEX_RECHECK_MS);
    await waitFor(async () => lines.some((line) => line.includes('content filter index not ready yet')), {
      description: 'a successful look',
    });
    expect(contentIndexForm()).toBe('document');
    await right();

    await buildContentFilterIndex(lateDb, silentLogger);
    await vi.advanceTimersByTimeAsync(CONTENT_INDEX_RECHECK_MS);
    await waitFor(async () => contentIndexForm() === 'filter', { description: 'the switch' });
    await right();
  }, 60_000);
});
