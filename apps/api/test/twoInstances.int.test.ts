import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MEDIA_PROCESS_JOB } from '../src/constants/media.js';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { freePort } from './helpers/freePort.js';
import { createPng, type MediaAssetBody, type UploadGrantBody } from './helpers/media.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type Json = Record<string, unknown>;
type Field = { id: string; apiKey: string } & Json;
type ModelBody = { definition: Json & { id: string; fields: Field[] }; version: number };
type Answer<T = Json> = { status: number; body: T };

/** Measurements land in the test output so the acceptance report can quote them. */
const measure = (name: string, value: number, unit = 'ms') =>
  process.stdout.write(`[measure] two instances: ${name} = ${Math.round(value)} ${unit}\n`);

const elapsedSince = (start: number) => performance.now() - start;

/**
 * Two real server processes against one database (brief §5: "before claiming multi-instance support, run
 * integration tests proving the coordination protocol with two instances"). Instance A listens for schema
 * notifications; instance B does not (SCHEMA_LISTEN=false), so everything B does right relies on the
 * durable version checks alone. Both run the inline worker.
 */
describe('two instances on one database', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-two-instances-'));
  let a: SpawnedServer;
  let b: SpawnedServer;
  let token: string;

  const call = async <T = Json>(server: SpawnedServer, path: string, init: RequestInit = {}, as = token) => {
    const response = await fetch(`${server.url}${path}`, {
      ...init,
      headers: {
        ...(as ? { authorization: `Bearer ${as}` } : {}),
        ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as T } as Answer<T>;
  };
  const post = <T = Json>(server: SpawnedServer, path: string, body: unknown, as?: string) =>
    call<T>(server, path, { method: 'POST', body: JSON.stringify(body) }, as);
  const put = <T = Json>(server: SpawnedServer, path: string, body: unknown) =>
    call<T>(server, path, { method: 'PUT', body: JSON.stringify(body) });
  const patch = <T = Json>(server: SpawnedServer, path: string, body: unknown) =>
    call<T>(server, path, { method: 'PATCH', body: JSON.stringify(body) });
  const expectOk = <T>(answer: Answer<T>, status: number): T => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(status);
    return answer.body;
  };

  const createModel = async (apiKey: string, fields: unknown[]) =>
    expectOk(
      await post<{ definitionId: string }>(a, '/api/admin/models', {
        definition: { kind: 'collection', apiKey, label: apiKey, fields },
      }),
      201,
    ).definitionId;
  const modelOn = async (server: SpawnedServer, id: string) =>
    expectOk(await call<ModelBody>(server, `/api/admin/models/${id}`), 200);
  const changeFields = async (server: SpawnedServer, id: string, add: unknown[]) => {
    const current = await modelOn(server, id);
    return put<{ changeId?: string }>(server, `/api/admin/models/${id}`, {
      definition: { ...current.definition, fields: [...current.definition.fields, ...add] },
      expectedVersion: current.version,
    });
  };
  const createEntry = (server: SpawnedServer, modelKey: string, data: Json, publish = false) =>
    post<{ id: string }>(server, `/api/admin/content/${modelKey}`, { data, publish });

  beforeAll(async () => {
    const [portA, portB] = [await freePort(), await freePort()];
    const shared = {
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      RATE_LIMIT_MAX: '1000000',
      MEDIA_PATH: mediaPath,
      SESSION_SECRET: 'two-instances-test-secret-0123456789abcdef',
      WORKER_POLL_INTERVAL_MS: '100',
    };
    a = await spawnServer({
      ...shared,
      PORT: String(portA),
      PUBLIC_URL: `http://127.0.0.1:${portA}`,
      SCHEMA_LISTEN: 'true',
    });
    b = await spawnServer({
      ...shared,
      PORT: String(portB),
      PUBLIC_URL: `http://127.0.0.1:${portB}`,
      SCHEMA_LISTEN: 'false',
    });
    // The servers seed the built-in roles at startup.
    token = await waitFor(async () => createRoleToken(database.current.db).catch(() => undefined));
  });
  afterAll(async () => {
    await Promise.all([a?.stop('SIGTERM'), b?.stop('SIGTERM')]);
    rmSync(mediaPath, { recursive: true, force: true });
  });

  it('a required-field activation on A and entry writes on both instances never commit an invalid row', async () => {
    const modelId = await createModel('task', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    await Promise.all(Array.from({ length: 20 }, (_, i) => createEntry(b, 'task', { title: `seed ${i}` })));

    let stop = false;
    const statuses = { a: [] as number[], b: [] as number[] };
    const writer = (server: SpawnedServer, into: number[]) => async () => {
      while (!stop) {
        into.push((await createEntry(server, 'task', { title: 'racing' })).status);
      }
    };
    const traffic = [
      writer(a, statuses.a),
      writer(a, statuses.a),
      writer(b, statuses.b),
      writer(b, statuses.b),
    ];
    const running = traffic.map((start) => start());
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Required with a default: existing entries are backfilled, and entries written meanwhile by either
    // instance are caught by the activation's re-check under the exclusive model lock.
    const started = performance.now();
    const changed = await changeFields(a, modelId, [
      { apiKey: 'due', label: 'Due', type: 'date', required: true, defaultValue: '2026-12-31' },
    ]);
    expect(changed.status).toBe(202);
    const changeId = changed.body.changeId ?? '';
    // B learns the outcome from the database: it has no notification channel.
    await waitFor(
      async () =>
        (await call<{ status: string }>(b, `/api/admin/schema/changes/${changeId}`)).body.status ===
        'activated',
      { timeoutMs: 20_000, intervalMs: 20 },
    );
    measure('required-field activation under write load, seen on B', elapsedSince(started));
    expect((await modelOn(b, modelId)).version).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    stop = true;
    await Promise.all(running);

    for (const list of [statuses.a, statuses.b]) {
      expect(list.filter((status) => status === 201).length).toBeGreaterThan(0);
      // Writes validated against the old version and committed after the flip are refused (409, retry).
      expect(
        list.every((status) => status === 201 || status === 409),
        list.join(','),
      ).toBe(true);
    }
    measure('writes during the activation test', statuses.a.length + statuses.b.length, 'requests');
    measure(
      'writes refused with 409 during the activation test',
      [...statuses.a, ...statuses.b].filter((status) => status === 409).length,
      'requests',
    );
    const dueId = (await modelOn(a, modelId)).definition.fields.find((field) => field.apiKey === 'due')?.id;
    expect(dueId).toBeDefined();
    const missing = await database.current.db
      .selectFrom('entry_heads')
      .select('entry_id')
      .where('model_id', '=', modelId)
      .where(sql<boolean>`not (data ? ${dueId ?? ''})`)
      .execute();
    expect(missing).toEqual([]);
    const created = [...statuses.a, ...statuses.b].filter((status) => status === 201).length;
    const total = await database.current.db
      .selectFrom('entry_heads')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('model_id', '=', modelId)
      .executeTakeFirstOrThrow();
    expect(Number(total.count)).toBe(20 + created);
  });

  it('a permission change or token revocation on A applies to the very next request on B', async () => {
    const modelId = await createModel('notice', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    expectOk(await createEntry(a, 'notice', { title: 'Hello' }, true), 201);
    const role = expectOk(
      await post<{ id: string; version: number }>(a, '/api/admin/roles', {
        key: 'site-reader',
        name: 'Site reader',
        kind: 'delivery',
        permissions: [{ action: 'read', modelId, condition: null, fieldIds: null }],
      }),
      201,
    );
    const delivery = expectOk(
      await post<{ token: string; apiToken: { id: string } }>(a, '/api/admin/tokens', {
        name: 'site',
        roleId: role.id,
      }),
      201,
    );
    const read = () => call(b, '/api/content/notices', {}, delivery.token);
    // Warm B's permission cache with the grant.
    expect((await read()).status).toBe(200);

    expectOk(
      await patch(a, `/api/admin/roles/${role.id}`, { expectedVersion: role.version, permissions: [] }),
      200,
    );
    const started = performance.now();
    const denied = await read();
    measure('grant removed on A, first request on B', elapsedSince(started));
    expect(denied.status).toBe(403);

    const tokenId = delivery.apiToken?.id ?? '';
    expect(tokenId).not.toBe('');
    expectOk(await call(a, `/api/admin/tokens/${tokenId}`, { method: 'DELETE' }), 204);
    expect((await read()).status).toBe(401);
  });

  it('a schema change on A regenerates GraphQL on B for its next request', async () => {
    const modelId = await createModel('event', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    expectOk(await createEntry(a, 'event', { title: 'Launch' }, true), 201);
    const query = (fields: string) =>
      post<{ data?: Json; errors?: unknown[] }>(b, '/api/graphql', {
        query: `{ events { nodes { ${fields} } } }`,
      });
    expect((await query('title')).body).toEqual({
      data: { events: { nodes: [{ title: 'Launch' }] } },
    });
    let started = performance.now();
    await query('title');
    measure('GraphQL query on B with a warm schema', elapsedSince(started));

    expect(
      (await changeFields(a, modelId, [{ apiKey: 'venue', label: 'Venue', type: 'string' }])).status,
    ).toBe(200);
    started = performance.now();
    const fresh = await query('title venue');
    measure('first GraphQL query on B after the change (includes the rebuild)', elapsedSince(started));
    expect(fresh.body).toEqual({ data: { events: { nodes: [{ title: 'Launch', venue: null }] } } });
    expect(b.logs.some((line) => line.msg === 'GraphQL schema rebuilt')).toBe(true);
  });

  it('scheduled publishes run exactly once with both workers polling', async () => {
    await createModel('post', [{ apiKey: 'title', label: 'Title', type: 'string' }]);
    const entries = await Promise.all(
      Array.from({ length: 8 }, async (_, i) =>
        expectOk(await createEntry(a, 'post', { title: `p${i}` }), 201),
      ),
    );
    const runAt = new Date(Date.now() + 1500).toISOString();
    for (const [index, entry] of entries.entries()) {
      // Scheduled through both instances.
      expectOk(
        await post(index % 2 === 0 ? a : b, '/api/admin/publishing/schedules', {
          modelKey: 'post',
          entryId: entry.id,
          action: 'publish',
          runAt,
        }),
        201,
      );
    }
    const ids = entries.map((entry) => entry.id);
    const started = performance.now();
    const jobs = await waitFor(
      async () => {
        const rows = await database.current.db
          .selectFrom('jobs')
          .select(['status', 'attempts'])
          .where('type', '=', PUBLISHING_JOBS.scheduledPublication)
          .execute();
        return rows.length === ids.length && rows.every((row) => row.status === 'succeeded')
          ? rows
          : undefined;
      },
      { timeoutMs: 20_000, intervalMs: 50 },
    );
    measure('8 scheduled publishes done after scheduling', elapsedSince(started));
    expect(jobs.every((job) => job.attempts === 1)).toBe(true);

    const publications = await database.current.db
      .selectFrom('publication_log')
      .select('entry_id')
      .where('entry_id', 'in', ids)
      .execute();
    expect(publications.map((row) => row.entry_id).sort()).toEqual([...ids].sort());
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select(sql<string>`payload->>'entryId'`.as('entryId'))
      .where('type', '=', 'entry.published')
      .where(sql<string>`payload->>'entryId'`, 'in', ids)
      .execute();
    expect(events.map((row) => row.entryId).sort()).toEqual([...ids].sort());
  });

  it('media processing runs once per upload with both workers polling', async () => {
    const uploads = 6;
    const assets: MediaAssetBody[] = [];
    for (let i = 0; i < uploads; i += 1) {
      const png = await createPng(800 + i, 600);
      const grant = expectOk(
        await post<UploadGrantBody>(a, '/api/admin/media/uploads', {
          filename: `photo-${i}.png`,
          mimeType: 'image/png',
          sizeBytes: png.length,
        }),
        201,
      );
      const form = new FormData();
      for (const [name, value] of Object.entries(grant.upload.fields)) {
        form.append(name, value);
      }
      form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), `photo-${i}.png`);
      expect((await fetch(grant.upload.url, { method: 'POST', body: form })).status).toBeLessThan(300);
      // Confirmed through B: it enqueues the processing job.
      assets.push(
        expectOk(await post<MediaAssetBody>(b, `/api/admin/media/uploads/${grant.grantId}/confirm`, {}), 201),
      );
    }
    const started = performance.now();
    await waitFor(
      async () => {
        for (const asset of assets) {
          const current = await call<MediaAssetBody>(b, `/api/admin/media/assets/${asset.id}`);
          if (current.body.status !== 'ready' || current.body.variants.some((v) => v.status !== 'ready')) {
            return false;
          }
        }
        return true;
      },
      { timeoutMs: 30_000, intervalMs: 100 },
    );
    measure(`${uploads} uploads processed (variants ready) after the last confirm`, elapsedSince(started));

    const processedBy = (server: SpawnedServer, assetId: string) =>
      server.logs.filter((line) => line.msg === 'media processed' && line.assetId === assetId).length;
    let onA = 0;
    for (const asset of assets) {
      const runsA = processedBy(a, asset.id);
      expect(runsA + processedBy(b, asset.id)).toBe(1);
      onA += runsA;
    }
    measure('uploads processed by A (the rest by B)', onA, 'of 6');
    const jobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'attempts'])
      .where('type', '=', MEDIA_PROCESS_JOB)
      .execute();
    expect(jobs).toHaveLength(uploads);
    expect(jobs.every((job) => job.status === 'succeeded' && job.attempts === 1)).toBe(true);
    // One row per (asset, variant), matching what the API reports.
    const reported = await Promise.all(
      assets.map(
        async (asset) => (await call<MediaAssetBody>(b, `/api/admin/media/assets/${asset.id}`)).body,
      ),
    );
    const expected = reported.flatMap((asset) =>
      asset.variants.map((variant) => `${asset.id}:${variant.name}`),
    );
    const rows = await database.current.db
      .selectFrom('media_variants')
      .select(sql<string>`asset_id || ':' || name`.as('key'))
      .where(
        'asset_id',
        'in',
        assets.map((asset) => asset.id),
      )
      .execute();
    expect(expected.length).toBeGreaterThanOrEqual(uploads * 2);
    expect(rows.map((row) => row.key).sort()).toEqual(expected.sort());
  });
});
