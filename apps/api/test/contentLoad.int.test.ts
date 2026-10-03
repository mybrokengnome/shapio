import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeliveryToken } from './helpers/content.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type ModelBody = { definition: Record<string, unknown> & { id: string; fields: unknown[] }; version: number };

/**
 * Brief §10: "optional field creation while normal traffic continues, with unchanged process identity".
 * A real server process takes reads and writes while a field is added; the same PID serves the new field
 * immediately, and nothing fails with a 5xx.
 */
describe('adding an optional field under load', () => {
  const database = useTestDatabase();
  let server: SpawnedServer;
  let adminToken: string;
  let deliveryToken: string;

  const call = async (path: string, token: string, init: RequestInit = {}) => {
    const response = await fetch(`${server.url}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });
    return {
      status: response.status,
      body: (await response.json().catch(() => null)) as Record<string, unknown> | null,
    };
  };

  beforeAll(async () => {
    server = await spawnServer({
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      RATE_LIMIT_MAX: '100000',
      SCHEMA_LISTEN: 'true',
    });
    // The server seeds the built-in roles at startup.
    adminToken = await waitFor(async () => createRoleToken(database.current.db).catch(() => undefined));
  });
  afterAll(async () => {
    await server?.stop('SIGTERM');
  });

  it('serves the new field from the same process with no 5xx', async () => {
    const created = await call('/api/admin/models', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        definition: {
          kind: 'collection',
          apiKey: 'post',
          label: 'Post',
          fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
        },
      }),
    });
    expect(created.status).toBe(201);
    const modelId = created.body?.definitionId as string;
    deliveryToken = await createDeliveryToken(database.current.db, [{ modelId }]);
    const seed = await call('/api/admin/content/post', adminToken, {
      method: 'POST',
      body: JSON.stringify({ data: { title: 'seed' }, publish: true }),
    });
    expect(seed.status).toBe(201);

    const statuses: number[] = [];
    let stop = false;
    const reader = async () => {
      while (!stop) {
        statuses.push((await call('/api/content/posts', deliveryToken)).status);
      }
    };
    const writer = async () => {
      while (!stop) {
        const write = await call('/api/admin/content/post', adminToken, {
          method: 'POST',
          body: JSON.stringify({ data: { title: 'under load' }, publish: true }),
        });
        statuses.push(write.status);
      }
    };
    const traffic = [reader(), reader(), writer(), writer()];
    // Traffic is flowing before the change starts.
    await waitFor(async () => statuses.length >= 12, {
      description: 'requests to complete before the change',
    });

    const model = (await call(`/api/admin/models/${modelId}`, adminToken)).body as unknown as ModelBody;
    const changed = await call(`/api/admin/models/${modelId}`, adminToken, {
      method: 'PUT',
      body: JSON.stringify({
        definition: {
          ...model.definition,
          fields: [...model.definition.fields, { apiKey: 'subtitle', label: 'Subtitle', type: 'string' }],
        },
        expectedVersion: model.version,
      }),
    });
    expect(changed.status).toBe(200);

    // The very next requests see the field: in the delivery API, and accepted by writes.
    const delivered = await call('/api/content/posts', deliveryToken);
    expect(delivered.status).toBe(200);
    expect((delivered.body?.data as Array<Record<string, unknown>>)[0]).toHaveProperty('subtitle');
    const written = await call('/api/admin/content/post', adminToken, {
      method: 'POST',
      body: JSON.stringify({ data: { title: 'new shape', subtitle: 'live' }, publish: true }),
    });
    expect(written.status).toBe(201);

    // Keep the traffic going until it has answered requests made after the change, then stop.
    const afterChange = statuses.length;
    await waitFor(async () => statuses.length >= afterChange + 12, {
      description: 'requests to complete after the change',
    });
    stop = true;
    await Promise.all(traffic);

    expect(statuses.length).toBeGreaterThan(20);
    // Writes validated against the old version and committed after the change are refused with 409 (retry).
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
    expect(statuses.filter((status) => status !== 200 && status !== 201 && status !== 409)).toEqual([]);
    // Same process identity throughout: no restart.
    expect(server.child.exitCode).toBeNull();
    expect(server.child.pid).toBe(server.pid);
    expect(server.logs.filter((line) => line.msg?.startsWith('Server listening'))).toHaveLength(1);
  });
});
