import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, pageDefinition, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const LISTENING = /^Server listening at (http:\/\/127\.0\.0\.1:\d+)$/;

type ModelBody = {
  definition: { id: string; label: string; fields: Array<{ apiKey: string }> } & Record<string, unknown>;
  version: number;
};

describe('a second instance with schema notifications disabled', () => {
  const database = useTestDatabase();
  let primary: TestApp;
  let admin: SchemaClient;
  let token: string;
  let second: SpawnedProcess;
  let secondUrl: string;

  const onSecond = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${secondUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    primary = await createTestApp(database.current, { schemaListen: false });
    token = await createRoleToken(database.current.db);
    admin = schemaClient(primary.app, token);
    second = spawnTsProcess('test/fixtures/schemaServer.ts', {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'info',
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      SCHEMA_LISTEN: 'false',
    });
    const line = await second.waitForLog(
      (entry) => typeof entry.msg === 'string' && LISTENING.test(entry.msg),
    );
    secondUrl = LISTENING.exec(line.msg ?? '')?.[1] ?? '';
  });
  afterAll(async () => {
    await second?.stop();
    await primary.app.close();
  });

  it('serves and enforces a change made on the first instance, with no notification', async () => {
    // Neither instance listens: no notification can reach the second one.
    const listeners = await database.current.db
      .selectFrom('pg_stat_activity' as never)
      .select('application_name' as never)
      .where('application_name' as never, '=', 'shapio-schema-listen' as never)
      .where('datname' as never, '=', database.current.name as never)
      .execute();
    expect(listeners).toEqual([]);

    const created = await admin.post('/api/admin/models', { definition: pageDefinition() });
    const { definitionId } = created.json<{ definitionId: string }>();
    // Warm the second instance's cache at version 1.
    const warm = await onSecond(`/api/admin/models/${definitionId}`);
    expect(warm).toMatchObject({ status: 200, body: { version: 1 } });

    const current = (await admin.get(`/api/admin/models/${definitionId}`)).json<ModelBody>();
    const changed = {
      ...current.definition,
      label: 'Pages',
      fields: [...current.definition.fields, { apiKey: 'summary', label: 'Summary', type: 'text' }],
    };
    expect(
      (await admin.put(`/api/admin/models/${definitionId}`, { definition: changed, expectedVersion: 1 }))
        .statusCode,
    ).toBe(200);

    // The very next request to the second instance sees version 2.
    const fresh = await onSecond(`/api/admin/models/${definitionId}`);
    expect(fresh).toMatchObject({ status: 200, body: { version: 2, definition: { label: 'Pages' } } });
    expect((fresh.body.definition as ModelBody['definition']).fields.map((field) => field.apiKey)).toEqual([
      'title',
      'summary',
    ]);

    // And it enforces it: an edit based on version 1 is stale there too.
    const stale = await onSecond(`/api/admin/models/${definitionId}`, {
      method: 'PUT',
      body: JSON.stringify({ definition: { ...current.definition, label: 'Old' }, expectedVersion: 1 }),
    });
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'SCHEMA_VERSION_CONFLICT' } } });

    // Validation on the second instance uses the new schema: a model created on the first one blocks
    // a colliding name created through the second one immediately.
    await admin.post('/api/admin/models', {
      definition: pageDefinition({ apiKey: 'article', label: 'Article' }),
    });
    const collision = await onSecond('/api/admin/models', {
      method: 'POST',
      body: JSON.stringify({ definition: pageDefinition({ apiKey: 'articleFilter', label: 'X' }) }),
    });
    expect(collision).toMatchObject({ status: 422, body: { error: { code: 'SCHEMA_INVALID' } } });
  });
});

describe('schema change notifications', () => {
  const database = useTestDatabase();
  let listening: TestApp;
  let writer: TestApp;

  beforeAll(async () => {
    listening = await createTestApp(database.current, { schemaListen: true });
    writer = await createTestApp(database.current, { schemaListen: false });
  });
  afterAll(async () => {
    await listening.app.close();
    await writer.app.close();
  });

  const listenerPids = async () =>
    (
      await database.current.db
        .selectFrom('pg_stat_activity' as never)
        .select('pid' as never)
        .where('application_name' as never, '=', 'shapio-schema-listen' as never)
        .where('datname' as never, '=', database.current.name as never)
        .execute()
    ).map((row) => (row as { pid: number }).pid);

  it('refreshes the cache before any request, and keeps doing so after the connection drops', async () => {
    const registry = listening.app.schemaRegistry;
    await registry.getSnapshot();
    await waitFor(async () => (await listenerPids()).length === 1);
    const admin = schemaClient(writer.app, await createRoleToken(database.current.db));

    await admin.post('/api/admin/models', { definition: pageDefinition() });
    const version = (await admin.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
    await waitFor(async () => registry.peek()?.version === version);

    // Kill the LISTEN connection: the listener reconnects and resynchronises.
    const [pid] = await listenerPids();
    await database.current.db
      .selectNoFrom((eb) => eb.fn('pg_terminate_backend', [eb.val(pid)]).as('done'))
      .execute();
    await waitFor(async () => {
      const pids = await listenerPids();
      return pids.length === 1 && pids[0] !== pid;
    });
    await admin.post('/api/admin/models', { definition: pageDefinition({ apiKey: 'post', label: 'Post' }) });
    const next = (await admin.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
    await waitFor(async () => registry.peek()?.version === next);
  });
});
