import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeliveryToken } from './helpers/content.js';
import { dialectSkipReason, isSqliteRun, jsonWithKey, withSkipReason } from './helpers/dialect.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { useTestDatabase, type TestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

/**
 * Load measurements for package M (build plan §4.M, §8): latency of live schema changes under sustained
 * traffic, and the cost of many per-field partial indexes on `entry_heads`. They take about a minute and
 * measure rather than gate, so they run only with LOAD_TEST=1; numbers are printed as `[measure]` lines
 * and recorded in documentation/modelling.md and the acceptance report.
 */
const enabled = process.env.LOAD_TEST === '1';
const suiteName = (name: string) => (enabled ? name : `${name} [skipped: set LOAD_TEST=1]`);

const measure = (name: string, value: number | string, unit = 'ms') =>
  process.stdout.write(
    `[measure] load: ${name} = ${typeof value === 'number' ? value.toFixed(1) : value} ${unit}\n`,
  );

const percentile = (values: number[], p: number) => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
};

type Json = Record<string, unknown>;
type Sample = { at: number; ms: number; status: number; kind: 'read' | 'write' };

const startServer = (database: TestDatabase) =>
  spawnServer({
    DATABASE_URL: database.url,
    MIGRATE_ON_START: 'false',
    RATE_LIMIT_MAX: '10000000',
    WORKER_POLL_INTERVAL_MS: '100',
  }).then(async (server) => ({
    server,
    // The server seeds the built-in roles at startup.
    token: await waitFor(async () => createRoleToken(database.db).catch(() => undefined)),
  }));

const client = (server: SpawnedServer, token: string) => {
  const call = async <T = Json>(path: string, init: RequestInit = {}, as = token) => {
    const response = await fetch(`${server.url}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json', ...init.headers },
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as T };
  };
  const send = <T = Json>(method: string, path: string, body: unknown) =>
    call<T>(path, { method, body: JSON.stringify(body) });

  /** Waits for a model change to be active (immediately, or after its prerequisite job). */
  const settle = async (answer: { status: number; body: Json }) => {
    if (answer.status === 202) {
      const changeId = answer.body.changeId as string;
      await waitFor(
        async () =>
          (await call<{ status: string }>(`/api/admin/schema/changes/${changeId}`)).body.status ===
          'activated',
        { timeoutMs: 120_000, intervalMs: 50 },
      );
      return;
    }
    expect([200, 201], JSON.stringify(answer.body)).toContain(answer.status);
  };
  const createModel = async (apiKey: string, fields: unknown[]) => {
    const created = await send<Json>('POST', '/api/admin/models', {
      definition: { kind: 'collection', apiKey, label: apiKey, fields },
    });
    await settle(created);
    return created.body.definitionId as string;
  };
  const addField = async (modelId: string, field: Json) => {
    const current = (
      await call<{ definition: Json & { fields: unknown[] }; version: number }>(
        `/api/admin/models/${modelId}`,
      )
    ).body;
    const answer = await send<Json>('PUT', `/api/admin/models/${modelId}`, {
      definition: { ...current.definition, fields: [...current.definition.fields, field] },
      expectedVersion: current.version,
    });
    return answer;
  };
  return { call, send, settle, createModel, addField };
};

describe.skipIf(!enabled)(suiteName('live field addition under sustained traffic'), () => {
  const database = useTestDatabase();
  let server: SpawnedServer;
  let api: ReturnType<typeof client>;
  let deliveryToken: string;

  beforeAll(async () => {
    const started = await startServer(database.current);
    server = started.server;
    api = client(server, started.token);
  }, 60_000);
  afterAll(async () => {
    await server?.stop('SIGTERM');
  });

  /** 12 readers and 4 writers until `stop()`, recording each request's latency and status. */
  const runTraffic = () => {
    const samples: Sample[] = [];
    let stopped = false;
    const timed = async (kind: Sample['kind'], request: () => Promise<{ status: number }>) => {
      const start = performance.now();
      const { status } = await request();
      samples.push({ at: start, ms: performance.now() - start, status, kind });
    };
    const reader = async () => {
      while (!stopped) {
        await timed('read', () => api.call('/api/content/posts?pageSize=20', {}, deliveryToken));
      }
    };
    const writer = async () => {
      while (!stopped) {
        await timed('write', () =>
          api.send('POST', '/api/admin/content/post', { data: { title: 'under load' }, publish: true }),
        );
      }
    };
    const loops = [...Array.from({ length: 12 }, reader), ...Array.from({ length: 4 }, writer)];
    return {
      samples,
      stop: async () => {
        stopped = true;
        await Promise.all(loops);
      },
    };
  };

  const report = (label: string, samples: Sample[], windows: Record<string, [number, number]>) => {
    for (const [phase, [from, to]] of Object.entries(windows)) {
      for (const kind of ['read', 'write'] as const) {
        const latencies = samples
          .filter((s) => s.kind === kind && s.at >= from && s.at < to)
          .map((s) => s.ms);
        measure(
          `${label}, ${phase}, ${kind} p50 / p95 / p99 (n=${latencies.length})`,
          `${percentile(latencies, 50).toFixed(1)} / ${percentile(latencies, 95).toFixed(1)} / ${percentile(latencies, 99).toFixed(1)}`,
        );
      }
    }
  };

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('keeps latency flat and serves no 5xx while fields are added live', async () => {
    const modelId = await api.createModel('post', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    deliveryToken = await createDeliveryToken(database.current.db, [{ modelId }]);
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        api.send('POST', '/api/admin/content/post', { data: { title: `seed ${i}` }, publish: true }),
      ),
    );

    const traffic = runTraffic();
    await pause(4000);
    // 1. An optional field: activated at once.
    const optionalStart = performance.now();
    const optional = await api.addField(modelId, { apiKey: 'subtitle', label: 'Subtitle', type: 'string' });
    const optionalEnd = performance.now();
    expect(optional.status).toBe(200);
    measure('optional field: change request answered in', optionalEnd - optionalStart);
    await pause(4000);
    // 2. A required field with a default: every existing head is backfilled before activation.
    const requiredStart = performance.now();
    const required = await api.addField(modelId, {
      apiKey: 'category',
      label: 'Category',
      type: 'string',
      required: true,
      defaultValue: 'news',
    });
    await api.settle(required);
    const requiredEnd = performance.now();
    measure('required field with default: activated (backfill included) in', requiredEnd - requiredStart);
    await pause(4000);
    const end = performance.now();
    await traffic.stop();

    const first = traffic.samples[0]?.at ?? 0;
    const settleMs = 1000;
    report('optional field', traffic.samples, {
      before: [first, optionalStart],
      during: [optionalStart, optionalEnd + settleMs],
      after: [optionalEnd + settleMs, requiredStart],
    });
    report('required field', traffic.samples, {
      during: [requiredStart, requiredEnd + settleMs],
      after: [requiredEnd + settleMs, end],
    });
    const statuses = new Map<number, number>();
    for (const sample of traffic.samples) {
      statuses.set(sample.status, (statuses.get(sample.status) ?? 0) + 1);
    }
    measure('statuses over the whole run', JSON.stringify(Object.fromEntries(statuses)), '');
    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    measure('entry heads at the end', Number(heads.count), 'rows');

    expect(traffic.samples.length).toBeGreaterThan(500);
    expect(traffic.samples.filter((sample) => sample.status >= 500)).toEqual([]);
    // Writes validated against the previous version that commit after a flip are refused with 409 (retry).
    expect(traffic.samples.every((sample) => [200, 201, 409].includes(sample.status))).toBe(true);
    expect(server.child.exitCode).toBeNull();
  }, 120_000);
});

/** MySQL caps field indexes below what this case builds (dialect.ts says why). */
const CEILING_SUITE = 'the partial-index ceiling on entry_heads';
const ceilingSkip = dialectSkipReason(import.meta.url, CEILING_SUITE);
const ceilingTitle = withSkipReason(suiteName(CEILING_SUITE), ceilingSkip);

describe.skipIf(!enabled || ceilingSkip !== undefined)(ceilingTitle, () => {
  const database = useTestDatabase();
  let server: SpawnedServer;
  let api: ReturnType<typeof client>;

  beforeAll(async () => {
    const started = await startServer(database.current);
    server = started.server;
    api = client(server, started.token);
  }, 60_000);
  afterAll(async () => {
    await server?.stop('SIGTERM');
  });

  const FIELDS_PER_MODEL = 5;
  const filterableFields = () => [
    { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
    { apiKey: 'rank', label: 'Rank', type: 'integer', filterable: true, sortable: true },
    { apiKey: 'price', label: 'Price', type: 'number', filterable: true, sortable: true },
    { apiKey: 'day', label: 'Day', type: 'date', filterable: true, sortable: true },
    { apiKey: 'at', label: 'At', type: 'datetime', filterable: true, sortable: true },
  ];

  /** Indexes on entry_heads and their size: PostgreSQL's catalog, or SQLite's schema and `dbstat` pages. */
  const indexStats = async () => {
    const result = isSqliteRun()
      ? await sql<{ indexes: number; bytes: number | null }>`
          select (select count(*) from sqlite_schema where type = 'index' and tbl_name = 'entry_heads') as indexes,
            (select sum(pgsize) from dbstat where name in
              (select name from sqlite_schema where type = 'index' and tbl_name = 'entry_heads')) as bytes
        `.execute(database.current.db)
      : await sql<{ indexes: string; bytes: string }>`
          select count(*)::text as indexes, coalesce(sum(pg_relation_size(indexrelid)), 0)::text as bytes
          from pg_index where indrelid = 'entry_heads'::regclass
        `.execute(database.current.db);
    const row = result.rows[0];
    return { indexes: Number(row?.indexes ?? 0), bytes: Number(row?.bytes ?? 0) };
  };

  /** API write latency (create a draft) and raw head-update latency (what autosave does). */
  const measureWrites = async (label: string, modelKey: string) => {
    const writes: number[] = [];
    let entryId = '';
    for (let i = 0; i < 150; i += 1) {
      const start = performance.now();
      const created = await api.send<{ id: string }>('POST', `/api/admin/content/${modelKey}`, {
        data: { title: `t${i}` },
      });
      writes.push(performance.now() - start);
      expect(created.status).toBe(201);
      entryId = created.body.id;
    }
    const updates: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const start = performance.now();
      await sql`
        update entry_heads set data = ${jsonWithKey('data', 'bench', String(i))}, version = version + 1
        where entry_id = ${entryId} and state = 'draft'
      `.execute(database.current.db);
      updates.push(performance.now() - start);
    }
    const { indexes, bytes } = await indexStats();
    measure(
      `${label} (${indexes} indexes on entry_heads, ${(bytes / 1024 / 1024).toFixed(1)} MiB): API create p50 / p95`,
      `${percentile(writes, 50).toFixed(2)} / ${percentile(writes, 95).toFixed(2)}`,
    );
    measure(
      `${label} (${indexes} indexes): SQL head update p50 / p95`,
      `${percentile(updates, 50).toFixed(3)} / ${percentile(updates, 95).toFixed(3)}`,
    );
    return { indexes };
  };

  it('measures write cost and index count up to 50 models with 5 filterable fields each', async () => {
    await api.createModel('probe', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    const baseline = await measureWrites('baseline, probe model has no field indexes', 'probe');

    let modelCount = 0;
    const createIndexedModels = async (upTo: number) => {
      const started = performance.now();
      const from = modelCount;
      for (; modelCount < upTo; modelCount += 1) {
        await api.createModel(`indexed${modelCount}`, filterableFields());
      }
      // A new model is active at once; its indexes are built right after, by the worker, one at a time.
      const expected = baseline.indexes + modelCount * FIELDS_PER_MODEL;
      await waitFor(async () => (await indexStats()).indexes === expected, {
        timeoutMs: 300_000,
        intervalMs: 100,
      });
      measure(
        `models ${from + 1}-${upTo} (${FIELDS_PER_MODEL} filterable fields each) created and indexed, per model`,
        (performance.now() - started) / (upTo - from),
      );
    };
    await createIndexedModels(10);
    await measureWrites('10 indexed models, writes to the unindexed probe model', 'probe');
    await createIndexedModels(50);
    const full = await measureWrites('50 indexed models, writes to the unindexed probe model', 'probe');
    await measureWrites('50 indexed models, writes to an indexed model', 'indexed0');

    expect(full.indexes - baseline.indexes).toBe(50 * FIELDS_PER_MODEL);
    // SQLite has no extended statistics and no INVALID indexes (its index builds are not concurrent).
    if (isSqliteRun()) {
      return;
    }
    const statistics = await sql<{ count: string }>`
      select count(*)::text as count from pg_statistic_ext where stxrelid = 'entry_heads'::regclass
    `.execute(database.current.db);
    measure('extended statistics objects on entry_heads', Number(statistics.rows[0]?.count ?? 0), '');
    const invalid = await sql<{ count: string }>`
      select count(*)::text as count from pg_index where indrelid = 'entry_heads'::regclass and not indisvalid
    `.execute(database.current.db);
    expect(Number(invalid.rows[0]?.count)).toBe(0);
  }, 600_000);
});
