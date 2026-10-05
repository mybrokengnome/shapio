import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { compileFilter, compileHeadQuery } from '../src/content/compiler/compile.js';
import {
  fieldIndexName,
  fieldStatisticsName,
  fieldValueExpression,
} from '../src/content/compiler/expressions.js';
import { parseContentQuery } from '../src/content/compiler/parse.js';
import { parseQueryTree } from '../src/content/compiler/querystring.js';
import { compileOrderBy } from '../src/content/compiler/sort.js';
import { readScopeFor } from '../src/content/locales.js';
import { resolveModel, type ContentModel } from '../src/content/model.js';
import { createContentPorts } from '../src/content/ports.js';
import { ENTRY_ORDER_INDEX } from '../src/db/entryOrderIndex.js';
import { getIndexState } from '../src/db/indexCatalog.js';
import { up as enqueueFieldIndexLayout } from '../src/db/migrations/20261003140200_enqueue_field_index_layout.js';
import * as entryCreatedAtMigration from '../src/db/migrations/20261005120000_entry_heads_entry_created_at.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker } from '../src/jobs/worker.js';
import { createSchemaJobHandlers } from '../src/schema/planner/changeJob.js';
import type { SchemaSnapshot } from '../src/schema/snapshot.js';
import { createDefinition, fieldIdOf, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const sqliteSkip = dialectSkipReason(import.meta.url);

/**
 * The compiler and the index builder share one expression module (ADR 0001); these tests prove the
 * planner can actually use the indexes for the SQL the compiler emits: GIN for equality (containment),
 * the per-field expression index for ranges and sorts.
 */
describe.skipIf(sqliteSkip)(withSkipReason('content indexes serve compiled queries', sqliteSkip), () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let listing: ModelBody;
  let catalog: ModelBody;
  let snapshot: SchemaSnapshot;

  /** 5,000 published entries per locale, written directly for speed (the write path is tested elsewhere). */
  const seed = async (definition: ModelBody, locales: readonly string[]) => {
    const active = snapshot.byId.get(definition.definition.id);
    const title = fieldIdOf(definition, 'title');
    const rank = fieldIdOf(definition, 'rank');
    await sql`
      with e as (
        insert into entries (site_id, model_id)
        select ${PRIMARY_SITE_ID}::uuid, ${definition.definition.id}::uuid from generate_series(1, 5000)
        returning id, created_at
      ), r as (
        insert into content_revisions (entry_id, locale, schema_revision_id, data, reason, author_type)
        select e.id, l.locale, ${active?.revisionId}::uuid,
          jsonb_build_object(${title}::text, md5(random()::text), ${rank}::text, (random() * 100000)::int),
          'create', 'system'
        from e cross join unnest(${[...locales]}::text[]) as l(locale)
        returning id, entry_id, locale, data
      )
      insert into entry_heads (entry_id, site_id, model_id, locale, state, revision_id, data, entry_created_at)
      select r.entry_id, ${PRIMARY_SITE_ID}::uuid, ${definition.definition.id}::uuid, r.locale, 'published', r.id,
        r.data, e.created_at
      from r join e on e.id = r.entry_id
    `.execute(database.current.db);
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const fields = (localized: boolean) => [
      { apiKey: 'title', label: 'Title', type: 'string', localized },
      { apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true, sortable: true },
    ];
    listing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'listing',
      label: 'Listing',
      localized: true,
      fields: fields(true),
    });
    catalog = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'catalog',
      label: 'Catalog',
      fields: fields(false),
    });
    await runContentSchemaJobs(database.current.db);
    snapshot = (await testApp.app.schemaRegistry.getSnapshot()).forSite(PRIMARY_SITE_ID);
    await seed(listing, ['en', 'fr']);
    await seed(catalog, ['en']);
    // Autovacuum's job in production; the index job also analyzes right after a build.
    await sql`analyze entries, entry_heads`.execute(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const planOf = async (apiKey: string, rawQuery: string) => {
    const model: ContentModel = resolveModel(snapshot, apiKey);
    const query = parseContentQuery(parseQueryTree(rawQuery), {
      model: model.definition,
      locales: snapshot.locales.map((locale) => locale.code),
      isReadable: () => true,
      allowSnapshot: false,
      resolveModel: () => undefined,
    });
    const compiled = compileHeadQuery({
      siteId: PRIMARY_SITE_ID,
      modelId: model.definition.id,
      source: { kind: 'heads', state: 'published' },
      locales: readScopeFor(snapshot, model.definition, 'en', { fallback: false }),
      conditions: query.filter ? [compileFilter(query.filter)] : [],
      orderBy: query.sort.length > 0 ? compileOrderBy(query.sort) : [],
      limit: 10,
    });
    return database.current.db.transaction().execute(async (trx) => {
      await sql`set local enable_seqscan = off`.execute(trx);
      const explain = sql<{ 'QUERY PLAN': unknown }>`explain (format json) ${compiled.rows}`;
      const { rows } = await explain.execute(trx);
      return JSON.stringify(rows[0]?.['QUERY PLAN']);
    });
  };

  const indexOf = (definition: ModelBody, localized: boolean) =>
    fieldIndexName({
      modelId: definition.definition.id,
      fieldId: fieldIdOf(definition, 'rank'),
      type: 'integer',
      localized,
    });

  it('each field index exists under its deterministic name, with its statistics object', async () => {
    for (const name of [indexOf(listing, true), indexOf(catalog, false)]) {
      expect(await getIndexState(database.current.db, name)).toBe('valid');
      const statistics = await sql<{
        stxname: string;
      }>`select stxname from pg_statistic_ext where stxname = ${fieldStatisticsName(name)}`.execute(
        database.current.db,
      );
      expect(statistics.rows).toHaveLength(1);
    }
    const columns = await sql<{
      indexdef: string;
    }>`select indexdef from pg_indexes where indexname = ${indexOf(catalog, false)}`.execute(
      database.current.db,
    );
    expect(columns.rows[0]?.indexdef).not.toContain('locale');
  });

  it('equality on a field without an index compiles to containment and uses the GIN index', async () => {
    expect(await planOf('listing', 'filters[title][$eq]=abc')).toContain('entry_heads_data_gin');
  });

  it('equality on an indexed field uses the field index, not the GIN index', async () => {
    for (const [apiKey, localized] of [
      ['listing', true],
      ['catalog', false],
    ] as const) {
      const definition = apiKey === 'listing' ? listing : catalog;
      const eq = await planOf(apiKey, 'filters[rank][$eq]=5');
      expect(eq).toContain(indexOf(definition, localized));
      expect(eq).not.toContain('entry_heads_data_gin');
      const oneOf = await planOf(apiKey, 'filters[rank][$in][0]=5&filters[rank][$in][1]=6');
      expect(oneOf).toContain(indexOf(definition, localized));
      expect(oneOf).not.toContain('entry_heads_data_gin');
    }
  });

  it('a one-sided range with no sort uses the field index (localized and non-localized models)', async () => {
    expect(await planOf('listing', 'filters[rank][$gt]=99990')).toContain(indexOf(listing, true));
    expect(await planOf('catalog', 'filters[rank][$gt]=99990')).toContain(indexOf(catalog, false));
    expect(await planOf('catalog', 'filters[rank][$lt]=10')).toContain(indexOf(catalog, false));
  });

  it('the newest-first order reads the entry order index and stops at the page (no sort node)', async () => {
    for (const apiKey of ['listing', 'catalog']) {
      const plan = await planOf(apiKey, 'sort=createdAt:desc');
      expect(plan).toContain(ENTRY_ORDER_INDEX);
      expect(plan).not.toContain('"Node Type":"Sort"');
    }
  });

  it('ranges with sorts and plain sorts use the field index', async () => {
    expect(await planOf('listing', 'filters[rank][$gt]=99000&filters[rank][$lt]=99100')).toContain(
      indexOf(listing, true),
    );
    expect(await planOf('listing', 'sort=rank:asc')).toContain(indexOf(listing, true));
    expect(await planOf('listing', 'sort=rank:desc&filters[rank][$lte]=500')).toContain(
      indexOf(listing, true),
    );
    expect(await planOf('catalog', 'sort=rank:asc')).toContain(indexOf(catalog, false));
  });
});

describe.skipIf(sqliteSkip)(withSkipReason('field index builds', sqliteSkip), () => {
  const database = useTestDatabase();

  it('builds the indexes of several new models in parallel without a deadlock or a retry', async () => {
    const testApp = await createTestApp(database.current, { schemaListen: false });
    try {
      const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
      for (let i = 0; i < 6; i += 1) {
        await createDefinition(admin, {
          kind: 'collection',
          apiKey: `catalog${i}`,
          label: `Catalog ${i}`,
          fields: [
            { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
            { apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true, sortable: true },
            { apiKey: 'day', label: 'Day', type: 'date', sortable: true },
          ],
        });
      }
      // Four follow-up jobs at a time, as an inline worker runs them.
      const worker = createWorker({
        db: database.current.db,
        handlers: createJobHandlers(
          createSchemaJobHandlers({
            db: database.current.db,
            ports: createContentPorts(database.current.db),
          }),
        ),
        workerId: 'index-builder',
        concurrency: 4,
        pollIntervalMs: 20,
        leaseMs: 30_000,
        log: silentLogger,
      });
      worker.start();
      try {
        await waitFor(
          async () => {
            const open = await database.current.db
              .selectFrom('jobs')
              .select('id')
              .where('type', 'like', 'schema.%')
              .where('status', '!=', 'succeeded')
              .execute();
            return open.length === 0;
          },
          { timeoutMs: 30_000 },
        );
      } finally {
        await worker.stop(5000);
      }
      const jobs = await database.current.db
        .selectFrom('jobs')
        .select(['attempts', 'last_error'])
        .where('type', 'like', 'schema.%')
        .execute();
      expect(jobs).toHaveLength(6);
      expect(jobs).toEqual(jobs.map(() => ({ attempts: 1, last_error: null })));
      const indexes = await sql<{ valid: boolean }>`
        select indisvalid as valid from pg_index
        where indrelid = 'entry_heads'::regclass and indexrelid::regclass::text like 'eh\\_%'
      `.execute(database.current.db);
      expect(indexes.rows).toHaveLength(18);
      expect(indexes.rows.every((row) => row.valid)).toBe(true);
    } finally {
      await testApp.app.close();
    }
  });
});

describe.skipIf(sqliteSkip)(withSkipReason('field index layout v2 (sites)', sqliteSkip), () => {
  const database = useTestDatabase();

  it('rebuilds indexes of the layout before sites with the site leading, then drops the old ones', async () => {
    const testApp = await createTestApp(database.current, { schemaListen: false });
    try {
      const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
      const shop = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'shop',
        label: 'Shop',
        fields: [{ apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true }],
      });
      await runContentSchemaJobs(database.current.db);
      const spec = {
        modelId: shop.definition.id,
        fieldId: fieldIdOf(shop, 'rank'),
        type: 'integer' as const,
        localized: false,
      };
      const current = fieldIndexName(spec);
      const legacy = fieldIndexName(spec, 1);
      const { db } = database.current;
      // An instance upgraded from before sites: the layout-1 index, no layout-2 one.
      await sql`drop index ${sql.id(current)}`.execute(db);
      await sql`create index ${sql.id(legacy)} on entry_heads (state, ${fieldValueExpression(spec.fieldId, spec.type)})
        where model_id = ${sql.lit(spec.modelId)}`.execute(db);
      await sql`create statistics ${sql.id(fieldStatisticsName(legacy))}
        on ${fieldValueExpression(spec.fieldId, spec.type)} from entry_heads`.execute(db);

      await enqueueFieldIndexLayout(db as never);
      await enqueueFieldIndexLayout(db as never);
      const queued = await db
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'schema.fieldIndexLayout')
        .execute();
      expect(queued).toHaveLength(1);
      await runContentSchemaJobs(db);

      expect(await getIndexState(db, current)).toBe('valid');
      expect(await getIndexState(db, legacy)).toBe('missing');
      const definition = await sql<{
        indexdef: string;
      }>`select indexdef from pg_indexes where indexname = ${current}`.execute(db);
      expect(definition.rows[0]?.indexdef).toContain('(site_id, state,');
      const statistics = await sql<{ stxname: string }>`select stxname from pg_statistic_ext
        where stxname in (${fieldStatisticsName(current)}, ${fieldStatisticsName(legacy)})`.execute(db);
      expect(statistics.rows.map((row) => row.stxname)).toEqual([fieldStatisticsName(current)]);
    } finally {
      await testApp.app.close();
    }
  });
});

describe.skipIf(sqliteSkip)(withSkipReason('entry order index (upgrade with content)', sqliteSkip), () => {
  const database = useTestDatabase();

  it('backfills each head with its entry creation time, then builds the index concurrently in a job', async () => {
    const testApp = await createTestApp(database.current, { schemaListen: false });
    try {
      const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'memo',
        label: 'Memo',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      });
      await runContentSchemaJobs(database.current.db);
      for (const title of ['One', 'Two', 'Three']) {
        const created = await admin.post('/api/admin/content/memo', { data: { title }, publish: true });
        expect(created.statusCode).toBe(201);
      }
      const { db } = database.current;
      // An instance upgraded with content: the column and index do not exist yet.
      await entryCreatedAtMigration.down(db as never);
      await entryCreatedAtMigration.up(db as never);

      const heads = await db
        .selectFrom('entry_heads as h')
        .innerJoin('entries as e', 'e.id', 'h.entry_id')
        .select(['h.entry_created_at', 'e.created_at'])
        .execute();
      expect(heads).toHaveLength(6);
      expect(heads.every((head) => head.entry_created_at?.getTime() === head.created_at.getTime())).toBe(
        true,
      );
      expect(await getIndexState(db, ENTRY_ORDER_INDEX)).toBe('missing');
      const queued = await db
        .selectFrom('jobs')
        .select('id')
        .where('type', '=', 'schema.entryOrderIndex')
        .execute();
      expect(queued).toHaveLength(1);

      await runContentSchemaJobs(db);
      expect(await getIndexState(db, ENTRY_ORDER_INDEX)).toBe('valid');
      const definition = await sql<{
        indexdef: string;
      }>`select indexdef from pg_indexes where indexname = ${ENTRY_ORDER_INDEX}`.execute(db);
      expect(definition.rows[0]?.indexdef).toContain(
        '(site_id, model_id, state, entry_created_at DESC, entry_id)',
      );
    } finally {
      await testApp.app.close();
    }
  });
});
