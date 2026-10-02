import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
  startReceiver,
  type FakeDns,
  type Receiver,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Webhook = { id: string; version: number; enabled: boolean };
type Delivery = {
  id: string;
  status: string;
  attempts: number;
  eventType: string;
  lastResponseStatus: number | null;
  lastError: string | null;
  attemptLog: Array<{
    request: { headers: Record<string, string> };
    response: { status: number } | null;
    error: string | null;
  }>;
};

const JOB_TYPES = [PUBLISHING_JOBS.webhookDeliver];

describe('webhooks', () => {
  const database = useTestDatabase();
  let testApp: TestApp & { dns: FakeDns };
  let admin: SchemaClient;
  let receiver: Receiver;
  const workers: Worker[] = [];

  const createWebhook = (body: Record<string, unknown>) => admin.post('/api/admin/webhooks', body);
  const deliveriesOf = async (webhookId: string) =>
    expectStatus(await admin.get(`/api/admin/webhooks/${webhookId}/deliveries`), 200).json<{
      items: Delivery[];
    }>().items;
  const worker = (now?: () => Date) => {
    const created = createPublishingWorker({
      db: database.current.db,
      app: testApp.app,
      dns: testApp.dns,
      ...(now ? { now } : {}),
    });
    workers.push(created);
    return created;
  };
  const publishArticle = async (title: string) => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    return entry;
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    receiver = await startReceiver();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((created) => created.stop(500)));
    receiver.requests.splice(0);
    receiver.respondWith(() => ({ status: 200 }));
    await database.current.db.deleteFrom('webhooks').execute();
  });

  afterAll(async () => {
    await receiver.close();
    await testApp.app.close();
  });

  it('delivers subscribed events with a valid signature and logs the attempt without the signature', async () => {
    const created = expectStatus(
      await createWebhook({
        name: 'Site',
        url: `${receiver.url}/hooks`,
        events: ['entry.published'],
        allowPrivateNetwork: true,
      }),
      201,
    ).json<{ webhook: Webhook; secret: string }>();
    expect(created.secret).toMatch(/^whsec_/);
    expect(
      JSON.stringify(expectStatus(await admin.get(`/api/admin/webhooks/${created.webhook.id}`), 200).json()),
    ).not.toContain(created.secret);

    const entry = await publishArticle('Hello');
    await drainJobs(worker(), database.current.db, { types: JOB_TYPES });

    expect(receiver.requests).toHaveLength(1);
    const [request] = receiver.requests;
    expect(request?.headers['x-shapio-event']).toBe('entry.published');
    const timestamp = String(request?.headers['x-shapio-timestamp']);
    const expected = createHmac('sha256', created.secret)
      .update(`${timestamp}.${request?.body ?? ''}`)
      .digest('hex');
    expect(request?.headers['x-shapio-signature']).toBe(`v1=${expected}`);
    const body = JSON.parse(request?.body ?? '{}') as {
      type: string;
      data: { entryId: string; snapshot: number };
    };
    expect(body).toMatchObject({
      type: 'entry.published',
      data: { entryId: entry.id },
    });
    expect(typeof body.data.snapshot).toBe('number');

    const [delivery] = await deliveriesOf(created.webhook.id);
    expect(delivery).toMatchObject({ status: 'succeeded', attempts: 1, lastResponseStatus: 200 });
    expect(delivery?.attemptLog[0]?.request.headers['x-shapio-signature']).toBe('[redacted]');
    expect(JSON.stringify(delivery)).not.toContain(created.secret);
  });

  it('retries a failing receiver with backoff until it succeeds', async () => {
    const created = expectStatus(
      await createWebhook({
        name: 'Flaky',
        url: receiver.url,
        events: ['entry.*'],
        allowPrivateNetwork: true,
        maxAttempts: 5,
      }),
      201,
    ).json<{ webhook: Webhook }>();
    let calls = 0;
    receiver.respondWith(() => {
      calls += 1;
      return calls <= 2 ? { status: 500, body: '{"error":"boom"}' } : { status: 204 };
    });
    expectStatus(await admin.post('/api/admin/content/article', { data: { title: 'Retry' } }), 201);

    const clock = createTestClock();
    const running = worker(clock.now);
    for (let round = 0; round < 4; round += 1) {
      await drainJobs(running, database.current.db, { types: JOB_TYPES, now: clock.now });
      clock.advance(10 * 60 * 1000);
    }
    const [delivery] = await deliveriesOf(created.webhook.id);
    expect(delivery).toMatchObject({ status: 'succeeded', attempts: 3, lastResponseStatus: 204 });
    expect(delivery?.attemptLog.map((attempt) => attempt.response?.status)).toEqual([500, 500, 204]);
  });

  it('dead-letters a delivery after its maximum attempts', async () => {
    const created = expectStatus(
      await createWebhook({
        name: 'Down',
        url: receiver.url,
        events: ['entry.created'],
        allowPrivateNetwork: true,
        maxAttempts: 2,
      }),
      201,
    ).json<{ webhook: Webhook }>();
    receiver.respondWith(() => ({ status: 500 }));
    expectStatus(await admin.post('/api/admin/content/article', { data: { title: 'Dead' } }), 201);

    const clock = createTestClock();
    const running = worker(clock.now);
    for (let round = 0; round < 3; round += 1) {
      await drainJobs(running, database.current.db, { types: JOB_TYPES, now: clock.now });
      clock.advance(10 * 60 * 1000);
    }
    const [delivery] = await deliveriesOf(created.webhook.id);
    expect(delivery).toMatchObject({ status: 'dead', attempts: 2, lastError: 'HTTP 500' });
    expect(receiver.requests).toHaveLength(2);
    const jobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'last_error'])
      .where('type', '=', PUBLISHING_JOBS.webhookDeliver)
      .where('status', '=', 'dead')
      .execute();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.last_error).toContain('HTTP 500');
  });

  describe('SSRF protection', () => {
    it.each([
      ['loopback', 'http://127.0.0.1:9/hook', false],
      ['private 10.x', 'http://10.0.0.8/hook', true],
      ['link-local metadata', 'http://169.254.169.254/latest/meta-data', true],
      ['IPv6 loopback', 'http://[::1]/hook', true],
    ])('refuses a %s destination', async (_name, url, allowPrivateNetwork) => {
      const response = await createWebhook({ name: 'Bad', url, events: ['entry.*'], allowPrivateNetwork });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('DESTINATION_NOT_ALLOWED');
    });

    it('refuses a DNS name that resolves to a private address', async () => {
      testApp.dns.set('hooks.attacker.test', '10.20.30.40');
      const response = await createWebhook({
        name: 'Rebind',
        url: 'http://hooks.attacker.test/x',
        events: ['entry.*'],
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { message: string } }>().error.message).toContain('10.20.30.40');
    });

    it('re-checks at send time (DNS rebinding) and dead-letters without connecting', async () => {
      // Unresolvable when saved, private when sent.
      const created = expectStatus(
        await createWebhook({
          name: 'Later',
          url: `http://rebind.attacker.test:${receiver.port}/x`,
          events: ['entry.created'],
        }),
        201,
      ).json<{ webhook: Webhook }>();
      testApp.dns.set('rebind.attacker.test', '127.0.0.1');
      expectStatus(await admin.post('/api/admin/content/article', { data: { title: 'Rebind' } }), 201);
      await drainJobs(worker(), database.current.db, { types: JOB_TYPES });
      const [delivery] = await deliveriesOf(created.webhook.id);
      expect(delivery).toMatchObject({ status: 'dead', attempts: 1 });
      expect(delivery?.lastError).toMatch(/private or reserved address/);
      expect(receiver.requests).toHaveLength(0);
    });
  });

  it('sends test deliveries, redelivers, and skips disabled webhooks for events', async () => {
    const created = expectStatus(
      await createWebhook({
        name: 'Off',
        url: receiver.url,
        events: ['entry.*'],
        enabled: false,
        allowPrivateNetwork: true,
      }),
      201,
    ).json<{ webhook: Webhook }>();
    expectStatus(await admin.post('/api/admin/content/article', { data: { title: 'Ignored' } }), 201);
    const test = expectStatus(
      await admin.post(`/api/admin/webhooks/${created.webhook.id}/test`, {}),
      202,
    ).json<Delivery>();
    expect(test.eventType).toBe('webhook.test');
    await drainJobs(worker(), database.current.db, { types: JOB_TYPES });
    expect(receiver.requests.map((request) => request.headers['x-shapio-event'])).toEqual(['webhook.test']);

    const again = expectStatus(
      await admin.post(`/api/admin/webhooks/${created.webhook.id}/deliveries/${test.id}/redeliver`, {}),
      202,
    ).json<Delivery>();
    expect(again.id).not.toBe(test.id);
    await drainJobs(worker(), database.current.db, { types: JOB_TYPES });
    expect(receiver.requests).toHaveLength(2);
    expect(receiver.requests[1]?.body).toBe(receiver.requests[0]?.body);
  });

  it('validates events and needs webhooks.manage', async () => {
    expect((await createWebhook({ name: 'x', url: receiver.url, events: ['nope.*'] })).statusCode).toBe(400);
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect((await editor.get('/api/admin/webhooks')).statusCode).toBe(403);
    const events = expectStatus(await admin.get('/api/admin/webhooks/events'), 200).json<{
      items: Array<{ type: string }>;
    }>();
    expect(events.items.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'entry.published',
        'media.created',
        'schema.activated',
        'change_set.shipped',
        'deployment.deployed',
      ]),
    );
  });
});
