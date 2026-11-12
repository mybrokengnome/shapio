import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { contentDialectFor } from '../src/content/compiler/dialect/index.js';
import {
  CONTENT_INDEX_RECHECK_MS,
  DOCUMENT_INDEX,
  DRAFT_SCALARS_INDEX,
  FILTER_CHECK,
  FILTER_INDEX,
  filterCheckState,
  readContentIndexForm,
  watchContentIndexForm,
  type ContentIndexWatch,
} from '../src/db/contentFilterIndex.js';
import { contentIndexForm, setContentIndexForm } from '../src/db/contentIndexForm.js';
import type { Database } from '../src/db/index.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import * as filterMigration from '../src/db/migrations/20261112120000_entry_heads_scalars_gin.js';
import { createMigrator } from '../src/db/migrator.js';
import type { JobContext } from '../src/jobs/types.js';
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

const exists = async (db: Database, what: 'function' | 'trigger' | 'column') => {
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
    .select(['type', 'idempotency_key', 'status', 'run_at'])
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

/** Counts of each containment, in both forms, in one snapshot, with the form the catalog says is live then. */
const observe = (db: Database) =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const form = await readContentIndexForm(trx);
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
        counts.push({ value, document: await count('document'), filter: await count('filter') });
      }
      return { form, counts };
    });

describe.skipIf(skip)(withSkipReason('shapio_scalar_fields contains what data contains', skip), () => {
  const database = useTestDatabase();

  const scalar = fc.oneof(
    fc.constantFrom('a', 'b', '', 'A', 'true', '1'),
    fc.constantFrom(0, 1, 1.5, -2, 1e21),
    fc.boolean(),
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
  const documents = fc.dictionary(keys, value, { maxKeys: 4 });
  /** Exactly the shapes `fieldEquals` binds: `{fieldId: scalar}` or `{fieldId: [scalar]}`. */
  const queries = fc
    .tuple(keys, scalar, fc.boolean())
    .map(([key, item, list]) => ({ [key]: list ? [item] : item }));
  const isScalar = (item: unknown) => item !== null && typeof item !== 'object';
  /** Half the queries name a scalar the document holds (at the top or in a top-level array), so many match. */
  const cases = fc.tuple(documents, queries, fc.boolean(), fc.nat()).map(([d, random, aimed, pick]) => {
    const candidates = Object.entries(d).flatMap(([key, held]) => [
      ...(isScalar(held) ? [{ [key]: held }] : []),
      ...(Array.isArray(held) ? held.filter(isScalar).map((item) => ({ [key]: [item] })) : []),
      // The same scalar in the other shape: an array never contains a bare scalar, and the reverse.
      ...(isScalar(held) ? [{ [key]: [held] }] : []),
    ]);
    return { d, q: aimed && candidates.length > 0 ? candidates[pick % candidates.length] : random };
  });

  it('for every containment document the compiler can emit, on arbitrary stored data', async () => {
    const sample = fc.sample(cases, { numRuns: 5000, seed: 20261112 });
    const { rows } = await sql<{ i: string; d: unknown; q: unknown; full: boolean; scalars: boolean }>`
      select c.i::text as i, c.pair -> 'd' as d, c.pair -> 'q' as q,
        (c.pair -> 'd') @> (c.pair -> 'q') as full,
        shapio_scalar_fields(c.pair -> 'd') @> (c.pair -> 'q') as scalars
      from jsonb_array_elements(${JSON.stringify(sample)}::jsonb) with ordinality as c(pair, i)
    `.execute(database.current.db);
    expect(rows).toHaveLength(sample.length);
    expect(rows.filter((row) => row.full !== row.scalars)).toEqual([]);
    // Not vacuous: both answers occur often.
    expect(rows.filter((row) => row.full).length).toBeGreaterThan(500);
    expect(rows.filter((row) => !row.full).length).toBeGreaterThan(500);
  });

  it('keeps scalars and arrays with a scalar, drops nulls, objects and arrays without one', async () => {
    const { rows } = await sql<{ kept: unknown }>`select shapio_scalar_fields(${JSON.stringify({
      s: 'x',
      n: 1,
      b: false,
      tags: ['a', 'b'],
      mixed: [{ k: 1 }, 'x'],
      empty: [],
      items: [{ __id: 'i1', f: 'x' }],
      nested: [['x']],
      card: { f: 'x' },
      nothing: null,
    })}::jsonb) as kept`.execute(database.current.db);
    expect(rows[0]?.kept).toEqual({ s: 'x', n: 1, b: false, tags: ['a', 'b'], mixed: [{ k: 1 }, 'x'] });
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
    expect(sql`${contentDialectFor('postgres').fieldEquals(target, 'x')}`.compile(db).sql).toBe(
      '("filter_data" @> $1::jsonb)',
    );
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
    setContentIndexForm('filter');
  });
  afterAll(() => {
    setContentIndexForm('filter');
  });

  it('fills, proves and indexes the column while writes continue, switches, drops the old index later, rolls back', async () => {
    const { db } = database.current;
    const migrator = createMigrator(db);
    expect((await migrator.migrateTo(PREVIOUS)).error).toBeUndefined();
    await ensureModels(db);
    await insertHeads(db, 1200);

    // The migration adds the column and trigger and enqueues the job: no scan, no index build.
    expect((await migrator.migrateTo(FILTER)).error).toBeUndefined();
    expect(await exists(db, 'trigger')).toBe(true);
    expect(await filterCheckState(db)).toBe('missing');
    expect(await getIndexState(db, DOCUMENT_INDEX)).toBe('valid');
    expect(await getIndexState(db, FILTER_INDEX)).toBe('missing');
    expect(await wrongFilterData(db)).toBe(1200);
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
    // Rows written after the migration get their filter data from the trigger.
    await insertHeads(db, 30, 1);
    expect(await wrongFilterData(db)).toBe(1200);

    watch = await watchContentIndexForm(db, silentLogger);
    expect(contentIndexForm()).toBe('document');

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
    const handlers = new Map(createContentFilterIndexHandlers(db));
    const build = handlers.get(CONTENT_FILTER_INDEX_JOB);
    const drop = handlers.get(CONTENT_DOCUMENT_INDEX_DROP_JOB);
    try {
      // Rows written between batches of the fill, and an update to a row the fill already filled.
      await buildContentFilterIndex(db, silentLogger, {
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

    // The invariant: never a difference while the filter form was live.
    const live = observations.filter((observation) => observation.form === 'filter');
    expect(live.length).toBeGreaterThan(0);
    for (const observation of live) {
      for (const count of observation.counts) {
        expect(count.filter, JSON.stringify(observation)).toBe(count.document);
      }
    }
    // And the guard mattered: before the switch the column was incomplete.
    expect(
      observations.some(
        (observation) =>
          observation.form === 'document' &&
          observation.counts.some((count) => count.filter < count.document),
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
    expect(queued).toMatchObject({ idempotency_key: CONTENT_DOCUMENT_INDEX_DROP_KEY, status: 'pending' });
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
