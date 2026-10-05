import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AFTER_HOOK_JOB } from '../src/constants/extensions.js';
import { loadExtensionRuntime, type ExtensionRuntime } from '../src/extensions/runtime.js';
import type { Worker } from '../src/jobs/worker.js';
import { createConfiguredWorker } from '../src/server.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, testConfig, type TestApp } from './helpers/createTestApp.js';
import { drainWorker, REPO_ROOT } from './helpers/extensions.js';
import { createPng, uploadAsset, type Headers } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const EXAMPLE_CONFIG = resolve(REPO_ROOT, 'examples/extension/shapio.config.ts');

/** examples/extension, wired through SHAPIO_CONFIG_PATH exactly as a project would run it. */
describe('example extension', () => {
  const database = useTestDatabase();
  let runtime: ExtensionRuntime;
  let testApp: TestApp;
  let admin: SchemaClient;
  let headers: Headers;
  let worker: Worker;

  beforeAll(async () => {
    const { db } = database.current;
    const config = testConfig(database.current, { SHAPIO_CONFIG_PATH: EXAMPLE_CONFIG });
    runtime = await loadExtensionRuntime({ db, config, logger: silentLogger });
    testApp = await createTestApp(database.current, { schemaListen: false, extensions: runtime });
    const token = await createRoleToken(db);
    headers = { authorization: `Bearer ${token}` };
    admin = schemaClient(testApp.app, token);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      ],
    });
    worker = await createConfiguredWorker(config, db, silentLogger, testApp.app.signingSecret, runtime);
  });

  afterAll(async () => {
    await worker.stop(500);
    await testApp.app.close();
    runtime.close();
  });

  it('refuses to publish an article without a cover image, and publishes it once it has one', async () => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'No cover yet' } }),
      201,
    ).json<EntryBody>();
    const refused = await admin.post(`/api/admin/content/article/${entry.id}/publish`, {});
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({
      error: {
        code: 'HOOK_REJECTED',
        message: 'An article needs a cover image before it can be published',
        details: { hook: 'article.beforePublish', field: 'cover' },
      },
    });

    const image = await uploadAsset(testApp.app, headers, {
      file: await createPng(8, 8),
      filename: 'cover.png',
      mimeType: 'image/png',
    });
    const withCover = expectStatus(
      await admin.put(`/api/admin/content/article/${entry.id}`, {
        expectedVersion: entry.version,
        data: { cover: image.id },
      }),
      200,
    ).json<EntryBody>();
    expect(
      expectStatus(
        await admin.post(`/api/admin/content/article/${withCover.id}/publish`, {}),
        200,
      ).json<EntryBody>(),
    ).toMatchObject({
      status: 'published',
    });

    // The `*` afterPublish hook ran once, after commit.
    await drainWorker(worker, database.current.db);
    const hookJobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'result'])
      .where('type', '=', AFTER_HOOK_JOB)
      .execute();
    expect(hookJobs).toEqual([{ status: 'succeeded', result: { ran: '*.afterPublish' } }]);
  });

  it('serves entry counts from the stats service to admins only', async () => {
    expect((await testApp.app.inject({ method: 'GET', url: '/api/ext/example/stats' })).statusCode).toBe(401);
    const stats = expectStatus(await admin.get('/api/ext/example/stats'), 200).json<{
      items: Array<{ model: string; entries: number }>;
    }>();
    expect(stats.items).toEqual([{ model: 'article', entries: 1 }]);
  });

  it('queues the report job from an audited custom route and runs it as ext.statsReport', async () => {
    const response = expectStatus(await admin.post('/api/ext/example/reports', {}), 202).json<{
      jobId: string;
    }>();
    const { db } = database.current;
    expect(
      await db
        .selectFrom('audit_events')
        .select(['action', 'actor_type'])
        .where('action', 'like', 'example.%')
        .execute(),
    ).toEqual([{ action: 'example.report.request', actor_type: 'token' }]);
    await drainWorker(worker, db);
    expect(
      await db
        .selectFrom('jobs')
        .select(['type', 'status', 'result'])
        .where('id', '=', response.jobId)
        .executeTakeFirst(),
    ).toEqual({
      type: 'ext.statsReport',
      status: 'succeeded',
      result: { counts: [{ model: 'article', entries: 1 }] },
    });
  });
});
