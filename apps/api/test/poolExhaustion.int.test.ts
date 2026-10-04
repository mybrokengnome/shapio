import { createServer, type Socket } from 'node:net';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/index.js';
import { DatabaseUnavailableError } from '../src/db/poolAcquire.js';
import { setPublicGrants } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { isSqliteRun, testDialect } from './helpers/dialect.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { createTestDatabase, useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

/** Fewer connections than concurrent requests: any request that holds one while asking for another deadlocks. */
const POOL_MAX = 4;
const CONCURRENT = 12;
/** Far above what 24 small requests need, far below the pool acquire timeout below. */
const COMPLETION_BOUND_MS = 15_000;
const ACQUIRE_TIMEOUT_MS = 20_000;

/**
 * Counts settled requests, so the test waits on the real condition (every request answered) with a bound,
 * instead of awaiting requests that may never return.
 */
const tracked = (requests: ReadonlyArray<Promise<LightMyRequestResponse>>) => {
  const responses: LightMyRequestResponse[] = [];
  const failures: unknown[] = [];
  for (const request of requests) {
    request.then(
      (response) => responses.push(response),
      (error: unknown) => failures.push(error),
    );
  }
  return { responses, failures, settled: () => responses.length + failures.length === requests.length };
};

describe('connection pool under concurrent requests', () => {
  const database = useTestDatabase({ poolMax: POOL_MAX, acquireTimeoutMs: ACQUIRE_TIMEOUT_MS });
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;
  let article: ModelBody;
  const authorIds: string[] = [];

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    // Anonymous callers read both models (the primary site binds the public app role).
    await setPublicGrants(database.current.db, [
      { action: 'read', modelId: article.definition.id },
      { action: 'read', modelId: author.definition.id },
    ]);
    for (const name of ['Ada', 'Grace']) {
      const created = expectStatus(
        await admin.post('/api/admin/content/author', { data: { name }, publish: true }),
        201,
      ).json<EntryBody>();
      authorIds.push(created.id);
    }
    expectStatus(
      await admin.post('/api/admin/content/article', {
        data: { title: 'Seed', author: authorIds[0] },
        publish: true,
      }),
      201,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('answers populate reads and relation writes beyond the pool size', async () => {
    const reads = Array.from({ length: CONCURRENT }, () =>
      testApp.app.inject({ method: 'GET', url: '/api/content/articles?populate=author' }),
    );
    const writes = Array.from({ length: CONCURRENT }, (_unused, index) =>
      admin.post('/api/admin/content/article', {
        data: { title: `Concurrent ${index}`, author: authorIds[index % authorIds.length] },
        publish: true,
      }),
    );
    const all = tracked([...reads, ...writes]);
    await waitFor(() => Promise.resolve(all.settled()), {
      timeoutMs: COMPLETION_BOUND_MS,
      description: `all ${CONCURRENT * 2} requests answered with a pool of ${POOL_MAX}`,
    });
    expect(all.failures).toEqual([]);
    const statuses = all.responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual(
      [...Array<number>(CONCURRENT).fill(200), ...Array<number>(CONCURRENT).fill(201)].sort(),
    );
    const page = expectStatus(
      await testApp.app.inject({ method: 'GET', url: '/api/content/articles?populate=author&pageSize=100' }),
      200,
    ).json<{ data: Array<{ author: { name: string } | null }> }>();
    expect(page.data).toHaveLength(CONCURRENT + 1);
    expect(page.data.every((entry) => entry.author !== null)).toBe(true);
  });

  it.skipIf(isSqliteRun())('fails with 503 when no connection becomes free in time', async () => {
    const small = await createTestDatabase({ poolMax: 1, acquireTimeoutMs: 300 });
    const app = await createTestApp(small, { schemaListen: false });
    let release: () => void = () => undefined;
    let begun: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    // Holds the only connection: the callback runs once the transaction has begun on it.
    const held = small.db.transaction().execute(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          begun();
        }),
    );
    try {
      await started;
      const response = await app.app.inject({ method: 'GET', url: '/api/content/articles' });
      expect(response.statusCode).toBe(503);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('DATABASE_BUSY');
    } finally {
      release();
      await held;
      await app.app.close();
      await small.drop();
    }
  });

  it.skipIf(testDialect() !== 'postgres')(
    'fails with 503 DATABASE_UNAVAILABLE when a connection cannot be opened in time',
    async () => {
      // Accepts TCP connections and never answers, like a database host that hangs.
      const sockets = new Set<Socket>();
      const silent = createServer((socket) => {
        sockets.add(socket);
      });
      await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
      const { port } = silent.address() as { port: number };
      const unreachable = createDb({
        connectionString: `postgres://shapio@127.0.0.1:${port}/shapio`,
        poolMax: 1,
        acquireTimeoutMs: 300,
      });
      try {
        const failure = await unreachable
          .selectFrom('system_versions')
          .select('permissions_version')
          .execute()
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        expect(failure).toBeInstanceOf(DatabaseUnavailableError);
        expect(failure).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
      } finally {
        await unreachable.destroy();
        for (const socket of sockets) {
          socket.destroy();
        }
        await new Promise<void>((resolve) => silent.close(() => resolve()));
      }
    },
  );
});
