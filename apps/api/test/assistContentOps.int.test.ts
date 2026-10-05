import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssistRuntime } from '../src/assist/runtime.js';
import { ASSIST_CONTENT_OPS_JOB } from '../src/constants/assist.js';
import { createUrlBuilder } from '../src/helpers/publicUrl.js';
import { createAssistJobHandlers } from '../src/jobs/assistContentOps.js';
import {
  CONTENT_HEALTH_JOBS,
  contentHealthOutboxSubscriber,
  createContentHealthJobHandlers,
} from '../src/jobs/contentHealth.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createMediaStorage } from '../src/media/storage.js';
import { createPublishingJobEnvironment } from '../src/publishing/jobEnvironment.js';
import { createPublishingRuntime } from '../src/publishing/runtime.js';
import { segmentsOf, startFakeLlm, type FakeLlm } from './fixtures/fakeLlm.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  type EntryBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { drainJobs } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type RunView = {
  runId: string;
  rule: string;
  status: string;
  model: string;
  error: { code: string } | null;
  result: Record<string, unknown> | null;
};
type ChangeSetView = {
  id: string;
  source: string;
  status: string;
  items: { entryId: string; locale: string; action: string }[];
};

const JOB_TYPES = [...Object.values(CONTENT_HEALTH_JOBS), ASSIST_CONTENT_OPS_JOB];

/** Content-ops (plan agentic-ecosystem §I): a job that proposes fixes for health findings; nothing publishes. */
describe('assist content-ops', () => {
  const database = useTestDatabase();
  let fake: FakeLlm;
  let testApp: TestApp;
  let owner: SchemaClient;
  let worker: Worker;
  let image: MediaAssetBody;
  let post: EntryBody;
  let note: EntryBody;

  const workerWith = async (assistOn: boolean) => {
    const runtime = createPublishingRuntime({
      db: database.current.db,
      signingSecret: testApp.app.signingSecret,
      urls: createUrlBuilder(testApp.config.server),
      config: testApp.config.publishing,
      log: silentLogger,
    });
    return createWorker({
      db: database.current.db,
      handlers: createJobHandlers([
        ...createContentHealthJobHandlers({ db: database.current.db, staleDays: 14, log: silentLogger }),
        ...createAssistJobHandlers({
          environment: createPublishingJobEnvironment(runtime),
          assist: assistOn ? createAssistRuntime(testApp.config.assist, runtime.resolve) : undefined,
          storage: await createMediaStorage(testApp.config.storage, {
            urls: createUrlBuilder(testApp.config.server),
          }),
        }),
      ]),
      subscribers: [contentHealthOutboxSubscriber],
      workerId: `test-${randomUUID()}`,
      concurrency: 2,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
  };

  const drain = (target = worker) => drainJobs(target, database.current.db, { types: JOB_TYPES });

  const propose = async (client: SchemaClient, body: Record<string, unknown>) =>
    expectStatus(await client.post('/api/admin/assist/content-ops/propose', body), 202).json<{
      runId: string;
    }>().runId;

  const runView = async (client: SchemaClient, runId: string) =>
    expectStatus(await client.get(`/api/admin/assist/content-ops/${runId}`), 200).json<RunView>();

  beforeAll(async () => {
    fake = await startFakeLlm((call) =>
      call.images > 0
        ? { text: 'A blue square on a plain background.' }
        : {
            text: JSON.stringify({
              segments: segmentsOf(call).map((segment) => ({ id: segment.id, text: `FR:${segment.text}` })),
            }),
          },
    );
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: {
        AI_PROVIDER: 'anthropic',
        AI_MODEL: 'fake-model-1',
        AI_API_KEY: 'sk-test-secret',
        AI_BASE_URL: fake.baseUrl,
      },
    });
    const token = await createRoleToken(database.current.db, 'owner');
    owner = schemaClient(testApp.app, token);
    worker = await workerWith(true);
    expectStatus(await owner.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    image = await uploadAsset(
      testApp.app,
      { authorization: `Bearer ${token}` },
      { file: await createPng(32, 32), filename: 'square.png', mimeType: 'image/png' },
    );
    await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true, localized: true },
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      ],
    });
    await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      localized: true,
      draftAndPublish: false,
      fields: [{ apiKey: 'text', label: 'Text', type: 'string', localized: true }],
    });
    post = expectStatus(
      await owner.post('/api/admin/content/post', {
        data: { title: 'Hello', cover: image.id },
        publish: true,
      }),
      201,
    ).json<EntryBody>();
    note = expectStatus(
      await owner.post('/api/admin/content/note', { data: { text: 'Live note' } }),
      201,
    ).json<EntryBody>();
    await drain();
  });
  afterAll(async () => {
    await worker.stop(1000);
    await testApp.app.close();
    await fake.close();
  });

  it('localeMissing: writes the missing locale draft into an assist change set, publishing nothing', async () => {
    fake.reset();
    const runId = await propose(owner, { rule: 'localeMissing' });
    expect((await runView(owner, runId)).status).toBe('queued');
    await drain();
    const run = await runView(owner, runId);
    expect(run).toMatchObject({
      status: 'succeeded',
      rule: 'localeMissing',
      model: 'fake-model-1',
      error: null,
    });
    const result = run.result as {
      changeSetId: string;
      fromLocale: string;
      written: { entryId: string; locale: string }[];
      skipped: { entryId: string; reason: string }[];
    };
    expect(result.fromLocale).toBe('en');
    expect(result.written).toEqual([
      expect.objectContaining({ entryId: post.id, locale: 'fr', modelKey: 'post' }),
    ]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ entryId: note.id, reason: 'publishesOnSave' }),
    ]);

    const set = expectStatus(
      await owner.get(`/api/admin/change-sets/${result.changeSetId}`),
      200,
    ).json<ChangeSetView>();
    expect(set).toMatchObject({ source: 'assist', status: 'open' });
    expect(set.items).toEqual([
      expect.objectContaining({ entryId: post.id, locale: 'fr', action: 'publish' }),
    ]);

    const french = expectStatus(
      await owner.get(`/api/admin/content/post/${post.id}?locale=fr`),
      200,
    ).json<EntryBody>();
    expect(french.data.title).toBe('FR:Hello');
    expect(french.status).toBe('draft');
    const published = await database.current.db
      .selectFrom('entry_heads')
      .select('locale')
      .where('entry_id', '=', post.id)
      .where('state', '=', 'published')
      .execute();
    expect(published.map((head) => head.locale)).toEqual(['en']);
    // Model-generated text stays out of the run and audit rows.
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select(['metadata', 'outcome'])
      .where('action', '=', 'assist.content_ops')
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toMatchObject({
      rule: 'localeMissing',
      written: 1,
      skipped: 1,
      model: 'fake-model-1',
    });
    expect(JSON.stringify(audit)).not.toContain('FR:');
  });

  it('localeMissing: a locale created meanwhile is skipped, not overwritten', async () => {
    const other = expectStatus(
      await owner.post('/api/admin/content/post', { data: { title: 'Second' } }),
      201,
    ).json<EntryBody>();
    await drain();
    const runId = await propose(owner, { rule: 'localeMissing', modelKey: 'post' });
    // A person writes the French version before the job runs.
    expectStatus(
      await owner.put(`/api/admin/content/post/${other.id}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'Deuxième' },
      }),
      200,
    );
    await drain();
    const result = (await runView(owner, runId)).result as {
      written: unknown[];
      skipped: { entryId: string; reason: string }[];
    };
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: other.id, reason: 'localeCreatedMeanwhile' }),
      ]),
    );
    const french = expectStatus(
      await owner.get(`/api/admin/content/post/${other.id}?locale=fr`),
      200,
    ).json<EntryBody>();
    expect(french.data.title).toBe('Deuxième');
  });

  it('altMissing: proposes library alt texts as a review list and writes nothing', async () => {
    fake.reset();
    const runId = await propose(owner, { rule: 'altMissing' });
    await drain();
    const run = await runView(owner, runId);
    expect(run.status).toBe('succeeded');
    const result = run.result as { proposals: Record<string, unknown>[] };
    expect(result.proposals).toEqual([
      expect.objectContaining({
        assetId: image.id,
        filename: 'square.png',
        currentAlt: '',
        proposedAlt: 'A blue square on a plain background.',
        assetVersion: image.version,
      }),
    ]);
    expect(fake.calls.filter((call) => call.images === 1)).toHaveLength(1);
    const asset = expectStatus(await owner.get(`/api/admin/media/assets/${image.id}`), 200).json<{
      alt: string;
    }>();
    expect(asset.alt).toBe('');
  });

  it('shows a run to its starter and to people who can act on it; others get 404', async () => {
    const runId = await propose(owner, { rule: 'localeMissing', modelKey: 'post' });
    await drain();
    const managerRole = await createRole(database.current.db, 'admin', [
      { action: 'changes.manage' as never, modelId: null },
    ]);
    const manager = schemaClient(testApp.app, await createTokenForRole(database.current.db, managerRole));
    expect((await runView(manager, runId)).runId).toBe(runId);
    const readerRole = await createRole(database.current.db, 'admin', [{ action: 'read', modelId: null }]);
    const reader = schemaClient(testApp.app, await createTokenForRole(database.current.db, readerRole));
    expectStatus(await reader.get(`/api/admin/assist/content-ops/${runId}`), 404);
    // Starting a localeMissing run needs changes.manage.
    expectStatus(await reader.post('/api/admin/assist/content-ops/propose', { rule: 'localeMissing' }), 403);
  });

  it('fails a run queued before assist was switched off, without contacting any provider', async () => {
    const off = await workerWith(false);
    try {
      fake.reset();
      const runId = await propose(owner, { rule: 'altMissing' });
      await drainJobs(off, database.current.db, { types: JOB_TYPES });
      const run = await runView(owner, runId);
      expect(run).toMatchObject({ status: 'failed', error: { code: 'ASSIST_DISABLED' } });
      expect(fake.calls).toHaveLength(0);
    } finally {
      await off.stop(1000);
    }
  });
});
