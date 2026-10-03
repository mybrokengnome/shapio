import diagnosticsChannel from 'node:diagnostics_channel';
import type { Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeLlm } from './fixtures/fakeLlm.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const ENTRY_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Product rule 8: nothing leaves the server by default. With AI_PROVIDER unset, assist is off: only
 * `GET /status` exists, every other assist route is a 404, and no outbound request or connection is made
 * while they are called (watched through Node's diagnostics channels for node:http, undici/fetch and raw
 * TCP sockets; the test database's own connections are the only sockets allowed).
 */
describe('assist off (AI_PROVIDER unset)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: SchemaClient;
  const httpRequests: unknown[] = [];
  const fetchRequests: unknown[] = [];
  const sockets: Socket[] = [];
  const onHttp = (message: unknown) => httpRequests.push(message);
  const onFetch = (message: unknown) => fetchRequests.push(message);
  const onSocket = (message: unknown) => sockets.push((message as { socket: Socket }).socket);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    owner = schemaClient(testApp.app, await createRoleToken(database.current.db, 'owner'));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('serves only an "off" status, 404s every action and sends nothing anywhere', async () => {
    expect(testApp.config.assist.provider).toBeUndefined();
    diagnosticsChannel.subscribe('http.client.request.start', onHttp);
    diagnosticsChannel.subscribe('undici:request:create', onFetch);
    diagnosticsChannel.subscribe('net.client.socket', onSocket);
    try {
      const status = expectStatus(await owner.get('/api/admin/assist/status'), 200);
      expect(status.json()).toEqual({ enabled: false });
      const posts: [string, unknown][] = [
        ['/api/admin/assist/alt-text', { assetId: ENTRY_ID }],
        ['/api/admin/assist/summarize', { modelKey: 'post', entryId: ENTRY_ID, fieldApiKey: 'summary' }],
        ['/api/admin/assist/translate', { modelKey: 'post', entryId: ENTRY_ID, from: 'en', to: 'fr' }],
        ['/api/admin/assist/rewrite', { text: 'Hello', instruction: 'Shorten' }],
        ['/api/admin/assist/schema/draft', { description: 'A blog' }],
        ['/api/admin/assist/content-ops/propose', { rule: 'altMissing' }],
      ];
      for (const [url, body] of posts) {
        expectStatus(await owner.post(url, body), 404);
      }
      expectStatus(await owner.get(`/api/admin/assist/content-ops/${ENTRY_ID}`), 404);
      expect(httpRequests).toEqual([]);
      expect(fetchRequests).toEqual([]);
      const databasePort = Number(new URL(database.current.url).port || 5432);
      const foreign = sockets.filter(
        (socket) => socket.remotePort !== undefined && socket.remotePort !== databasePort,
      );
      expect(foreign.map((socket) => `${socket.remoteAddress}:${socket.remotePort}`)).toEqual([]);
      expect(await database.current.db.selectFrom('assist_runs').selectAll().execute()).toEqual([]);
    } finally {
      diagnosticsChannel.unsubscribe('http.client.request.start', onHttp);
      diagnosticsChannel.unsubscribe('undici:request:create', onFetch);
      diagnosticsChannel.unsubscribe('net.client.socket', onSocket);
    }
  });

  it('the same watch does see a request when assist is on (control)', async () => {
    const fake = await startFakeLlm(() => ({ text: 'Shorter.' }));
    const on = await createTestApp(database.current, {
      schemaListen: false,
      env: { AI_PROVIDER: 'openai-compatible', AI_MODEL: 'local', AI_BASE_URL: fake.baseUrl },
    });
    diagnosticsChannel.subscribe('http.client.request.start', onHttp);
    try {
      const client = schemaClient(on.app, await createRoleToken(database.current.db, 'owner'));
      expectStatus(
        await client.post('/api/admin/assist/rewrite', { text: 'Hello there', instruction: 'Shorten' }),
        200,
      );
      expect(httpRequests).toHaveLength(1);
    } finally {
      diagnosticsChannel.unsubscribe('http.client.request.start', onHttp);
      await on.app.close();
      await fake.close();
    }
  });
});
