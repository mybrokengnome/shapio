import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { startFakeCloudflare, type FakeCloudflare } from './fixtures/cloudflareApi.js';
import { startFakeGitHub, type FakeGitHub } from './fixtures/githubApi.js';
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

type Run = {
  id: string;
  status: string;
  snapshot: number | null;
  retryOf: string | null;
  providerRef: string | null;
  logUrl: string | null;
  siteUrl: string | null;
  error: string | null;
  completionReported: boolean;
  timeline: Array<{ status: string; source: string; message: string | null }>;
};
type Connection = {
  id: string;
  version: number;
  callbackUrl: string;
  secrets: Record<string, { set: boolean }>;
  latestRun: Run | null;
  currentRun: Run | null;
};

const JOB_TYPES = [PUBLISHING_JOBS.deploymentTrigger, PUBLISHING_JOBS.deploymentPoll];

describe('deployments', () => {
  const database = useTestDatabase();
  let testApp: TestApp & { dns: FakeDns };
  let admin: SchemaClient;
  let site: Receiver;
  let cloudflare: FakeCloudflare;
  let github: FakeGitHub;
  const workers: Worker[] = [];
  const clock = createTestClock();

  const worker = () => {
    const created = createPublishingWorker({
      db: database.current.db,
      app: testApp.app,
      dns: testApp.dns,
      now: clock.now,
      pollIntervalMs: 1000,
    });
    workers.push(created);
    return created;
  };
  const drain = (running: Worker) =>
    drainJobs(running, database.current.db, { types: JOB_TYPES, now: clock.now });

  const createConnection = async (body: Record<string, unknown>) =>
    expectStatus(await admin.post('/api/admin/deployments/connections', body), 201).json<{
      connection: Connection;
      generatedSecrets: Record<string, string>;
    }>();
  const getRun = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/deployments/runs/${id}`), 200).json<Run>();
  const runsOf = async (connectionId: string) =>
    expectStatus(await admin.get(`/api/admin/deployments/runs?connectionId=${connectionId}`), 200).json<{
      items: Run[];
    }>().items;
  const publish = async (title: string) => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/page', { data: { title } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
    return entry;
  };

  const callback = (
    connection: Connection,
    secret: string,
    payload: Record<string, unknown>,
    // The API checks timestamps against the real clock (the test clock only drives the worker).
    at = new Date(),
  ) => {
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(at.getTime() / 1000);
    const signature = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
    return testApp.app.inject({
      method: 'POST',
      url: new URL(connection.callbackUrl).pathname,
      headers: {
        'content-type': 'application/json',
        'x-shapio-timestamp': String(timestamp),
        'x-shapio-signature': signature,
      },
      payload: body,
    });
  };

  const genericConnection = async (overrides: Record<string, unknown> = {}) =>
    createConnection({
      name: 'Example site',
      provider: 'generic_webhook',
      settings: { url: `${site.url}/build` },
      secrets: {},
      triggerPolicy: ['publish', 'change_set', 'manual'],
      debounceSeconds: 0,
      allowPrivateNetwork: true,
      previewUrlTemplate: 'https://preview.example.test/{path}?token={token}',
      ...overrides,
    });

  beforeAll(async () => {
    cloudflare = await startFakeCloudflare(clock.now);
    github = await startFakeGitHub();
    testApp = await createPublishingTestApp(database.current, {
      env: { CLOUDFLARE_API_URL: cloudflare.apiUrl, GITHUB_API_URL: github.url },
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    site = await startReceiver();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((created) => created.stop(500)));
    await database.current.db.deleteFrom('deployment_connections').execute();
    site.requests.splice(0);
    site.respondWith(() => ({ status: 202 }));
  });

  afterAll(async () => {
    await Promise.all([site.close(), cloudflare.close(), github.close()]);
    await testApp.app.close();
  });

  describe('generic signed build webhook', () => {
    it('triggers on publish with the snapshot, then follows signed callbacks and ignores a late older state', async () => {
      const { connection, generatedSecrets } = await genericConnection();
      const secret = generatedSecrets.signingSecret ?? '';
      expect(secret).toMatch(/^whsec_/);
      expect(connection.secrets).toEqual({ signingSecret: { set: true, envVar: null } });

      await publish('Home');
      await drain(worker());
      expect(site.requests).toHaveLength(1);
      const trigger = site.requests[0];
      const body = JSON.parse(trigger?.body ?? '{}') as {
        runId: string;
        snapshot: number;
        callbackUrl: string;
      };
      const expected = createHmac('sha256', secret)
        .update(`${String(trigger?.headers['x-shapio-timestamp'])}.${trigger?.body ?? ''}`)
        .digest('hex');
      expect(trigger?.headers['x-shapio-signature']).toBe(`v1=${expected}`);
      expect(trigger?.headers['x-shapio-delivery']).toBe(body.runId);
      expect(body.callbackUrl).toBe(connection.callbackUrl);

      let run = await getRun(body.runId);
      expect(run).toMatchObject({ status: 'triggered', snapshot: body.snapshot, completionReported: false });

      expect(
        expectStatus(await callback(connection, secret, { runId: run.id, status: 'building' }), 200).json(),
      ).toEqual({
        applied: true,
        status: 'building',
      });
      expect(
        expectStatus(
          await callback(connection, secret, {
            runId: run.id,
            status: 'deployed',
            siteUrl: 'https://example.test',
            logUrl: 'https://ci.example.test/1',
          }),
          200,
        ).json(),
      ).toEqual({ applied: true, status: 'deployed' });
      // A "building" callback that arrives after "deployed" must not regress the run.
      expect(
        expectStatus(await callback(connection, secret, { runId: run.id, status: 'building' }), 200).json(),
      ).toEqual({
        applied: false,
        status: 'deployed',
      });

      run = await getRun(run.id);
      expect(run).toMatchObject({
        status: 'deployed',
        completionReported: true,
        siteUrl: 'https://example.test/',
        logUrl: 'https://ci.example.test/1',
      });
      expect(run.timeline.map((event) => `${event.status}/${event.source}`)).toEqual([
        'queued/shapio',
        'triggered/shapio',
        'building/callback',
        'deployed/callback',
        'deployed/callback',
      ]);
      expect(run.timeline.at(-1)?.message).toMatch(/Ignored a late "building" callback/);
      const events = await database.current.db
        .selectFrom('outbox_events')
        .select('type')
        .where('aggregate_id', '=', run.id)
        .orderBy('id')
        .execute();
      expect(events.map((event) => event.type)).toEqual([
        'deployment.triggered',
        'deployment.building',
        'deployment.deployed',
      ]);
    });

    it('rejects callbacks with a bad signature, a stale timestamp or another connection’s run', async () => {
      const { connection, generatedSecrets } = await genericConnection();
      const secret = generatedSecrets.signingSecret ?? '';
      const run = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      expect(
        (await callback(connection, 'whsec_wrong', { runId: run.id, status: 'deployed' })).statusCode,
      ).toBe(401);
      expect(
        (
          await callback(
            connection,
            secret,
            { runId: run.id, status: 'deployed' },
            new Date(Date.now() - 3_600_000),
          )
        ).statusCode,
      ).toBe(401);
      const other = await genericConnection({ name: 'Other' });
      expect(
        (
          await callback(other.connection, other.generatedSecrets.signingSecret ?? '', {
            runId: run.id,
            status: 'deployed',
          })
        ).statusCode,
      ).toBe(404);
      expect((await getRun(run.id)).status).toBe('queued');
    });

    it('coalesces a burst of publishes into one run at the latest snapshot', async () => {
      const { connection } = await genericConnection({ debounceSeconds: 30 });
      await publish('One');
      await publish('Two');
      await publish('Three');
      const running = worker();
      await drain(running);
      expect(await runsOf(connection.id)).toEqual([expect.objectContaining({ status: 'queued' })]);
      expect(site.requests).toHaveLength(0);

      clock.advance(31_000);
      await drain(running);
      const runs = await runsOf(connection.id);
      expect(runs).toHaveLength(1);
      expect(site.requests).toHaveLength(1);
      const latest = await database.current.db
        .selectFrom('publication_state')
        .select('last_seq')
        .executeTakeFirstOrThrow();
      expect(runs[0]?.snapshot).toBe(Number(latest.last_seq));
    });

    it('shows a failed trigger as failed with the error, and a retry creates a new run', async () => {
      const { connection } = await genericConnection();
      site.respondWith(() => ({ status: 503, body: '{"error":"maintenance"}' }));
      const run = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      const running = worker();
      for (let round = 0; round < 6; round += 1) {
        await drain(running);
        clock.advance(10 * 60 * 1000);
      }
      const failed = await getRun(run.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/HTTP 503/);
      expect(failed.timeline.filter((event) => /failed: .*retrying/.test(event.message ?? ''))).toHaveLength(
        4,
      );

      site.respondWith(() => ({ status: 202 }));
      const retry = expectStatus(
        await admin.post(`/api/admin/deployments/runs/${run.id}/retry`, {}),
        201,
      ).json<Run>();
      expect(retry.id).not.toBe(run.id);
      expect(retry.retryOf).toBe(run.id);
      await drain(running);
      expect((await getRun(retry.id)).status).toBe('triggered');
      expect((await getRun(run.id)).status).toBe('failed');
    });

    it('reports a build failure from the site with its log, and keeps the newest deployed run as current', async () => {
      const { connection, generatedSecrets } = await genericConnection();
      const secret = generatedSecrets.signingSecret ?? '';
      const running = worker();
      const first = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      await drain(running);
      await publish('Newer content');
      await drain(running);
      const second = (await runsOf(connection.id)).find((candidate) => candidate.id !== first.id) as Run;
      expect(second.snapshot ?? 0).toBeGreaterThan((await getRun(first.id)).snapshot ?? 0);

      expectStatus(await callback(connection, secret, { runId: second.id, status: 'deployed' }), 200);
      // The older run reports late; it is recorded but does not become what the site serves.
      expectStatus(await callback(connection, secret, { runId: first.id, status: 'deployed' }), 200);
      const current = expectStatus(
        await admin.get(`/api/admin/deployments/connections/${connection.id}`),
        200,
      ).json<Connection>();
      expect(current.currentRun?.id).toBe(second.id);

      const third = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      await drain(running);
      await callback(connection, secret, {
        runId: third.id,
        status: 'failed',
        message: 'astro build exited 1',
        logUrl: 'https://ci.example.test/3',
      });
      expect(await getRun(third.id)).toMatchObject({
        status: 'failed',
        error: 'astro build exited 1',
        logUrl: 'https://ci.example.test/3',
      });
    });

    it('lets secrets reference only variables set aside for them (SHAPIO_SECRET_*, SECRET_ENV_ALLOWLIST)', async () => {
      const refused = await admin.post('/api/admin/deployments/connections', {
        name: 'Oracle attempt',
        provider: 'generic_webhook',
        settings: { url: `${site.url}/build` },
        secrets: { signingSecret: '${ENV:SESSION_SECRET}' },
        triggerPolicy: ['manual'],
        allowPrivateNetwork: true,
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: {
          code: 'SECRET_ENV_NOT_ALLOWED',
          message: expect.stringContaining('SHAPIO_SECRET_') as unknown,
          details: { secret: 'signingSecret', variable: 'SESSION_SECRET' },
        },
      });
      const accepted = await admin.post('/api/admin/deployments/connections', {
        name: 'Referenced secret',
        provider: 'generic_webhook',
        settings: { url: `${site.url}/build` },
        secrets: { signingSecret: '${ENV:SHAPIO_SECRET_SITE_HOOK}' },
        triggerPolicy: ['manual'],
        allowPrivateNetwork: true,
      });
      expect(accepted.statusCode).toBe(201);
      expect(accepted.json<{ connection: Connection }>().connection.secrets.signingSecret).toMatchObject({
        set: true,
      });
    });

    it('validates connections and keeps secrets write-only', async () => {
      const bad = await admin.post('/api/admin/deployments/connections', {
        name: 'Bad',
        provider: 'generic_webhook',
        settings: { url: 'http://10.0.0.1/build' },
        secrets: {},
        triggerPolicy: ['publish'],
      });
      expect(bad.statusCode).toBe(400);
      const { connection } = await genericConnection({ secrets: { signingSecret: 'whsec_mine_123456' } });
      const listed = JSON.stringify(
        expectStatus(await admin.get('/api/admin/deployments/connections'), 200).json(),
      );
      expect(listed).not.toContain('whsec_mine_123456');
      const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
      expect((await editor.get('/api/admin/deployments/connections')).statusCode).toBe(403);
      expect((await editor.get(`/api/admin/deployments/runs?connectionId=${connection.id}`)).statusCode).toBe(
        200,
      );
      // Editors may trigger and retry builds (deployments.trigger) without managing connections.
      const triggered = expectStatus(
        await editor.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      expect((await editor.post(`/api/admin/deployments/runs/${triggered.id}/retry`, {})).statusCode).toBe(
        201,
      );
      const readOnly = schemaClient(testApp.app, await createRoleToken(database.current.db, 'read-only'));
      expect(
        (await readOnly.post(`/api/admin/deployments/connections/${connection.id}/runs`, {})).statusCode,
      ).toBe(403);
    });

    it('refuses private and reserved destinations unless the connection opts in and the operator allows them', async () => {
      const refused = async (body: Record<string, unknown>) => {
        const response = await admin.post('/api/admin/deployments/connections', {
          name: 'Internal',
          provider: 'generic_webhook',
          secrets: {},
          triggerPolicy: ['manual'],
          ...body,
        });
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
        expect(response.json(), JSON.stringify(body)).toMatchObject({
          error: { code: 'DESTINATION_NOT_ALLOWED' },
        });
        return response.json<{ error: { message: string } }>().error.message;
      };
      for (const url of [
        'http://127.0.0.1:1/x',
        'http://10.0.0.1/',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]/x',
      ]) {
        await refused({ settings: { url } });
      }
      // A public-looking name that resolves to a private address is refused the same way.
      testApp.dns.set('build.attacker.test', '10.20.30.40');
      expect(await refused({ settings: { url: 'http://build.attacker.test/hook' } })).toContain(
        '10.20.30.40',
      );
      // Opting in is not enough: the address must also be on OUTBOUND_PRIVATE_NETWORK_ALLOWLIST (127.0.0.1/32 here).
      await refused({ settings: { url: 'http://10.0.0.1/' }, allowPrivateNetwork: true });

      // Turning the opt-in off on an allowed private connection is refused too.
      const { connection } = await genericConnection();
      const update = await admin.request({
        method: 'PATCH',
        url: `/api/admin/deployments/connections/${connection.id}`,
        payload: { allowPrivateNetwork: false, expectedVersion: connection.version },
      });
      expect(update.statusCode).toBe(400);
      expect(update.json()).toMatchObject({ error: { code: 'DESTINATION_NOT_ALLOWED' } });
      expect(
        await database.current.db.selectFrom('deployment_connections').select('id').execute(),
      ).toHaveLength(1);
    });

    it('re-checks the destination at send time (DNS rebinding) and fails the run without connecting', async () => {
      // Unresolvable when saved (allowed: DNS may be down), private when the trigger is sent.
      const host = 'rebind-build.attacker.test';
      const { connection } = await genericConnection({
        settings: { url: `http://${host}:${new URL(site.url).port}/build` },
        allowPrivateNetwork: false,
      });
      testApp.dns.set(host, '127.0.0.1');
      const run = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      const running = worker();
      for (let round = 0; round < 6; round += 1) {
        await drain(running);
        clock.advance(10 * 60 * 1000);
      }
      const failed = await getRun(run.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/private or reserved address/);
      expect(site.requests).toHaveLength(0);
    });

    it('reads secrets given as ${ENV:NAME} from the environment, and says clearly when one is missing', async () => {
      process.env.SHAPIO_SECRET_TEST_HOOK = 'whsec_from_environment';
      try {
        const { connection, generatedSecrets } = await genericConnection({
          secrets: { signingSecret: '${ENV:SHAPIO_SECRET_TEST_HOOK}' },
        });
        expect(generatedSecrets).toEqual({});
        expect(connection.secrets).toEqual({
          signingSecret: { set: true, envVar: 'SHAPIO_SECRET_TEST_HOOK' },
        });
        const stored = await database.current.db
          .selectFrom('deployment_connections')
          .select(['secret_env_refs', 'secrets_encrypted'])
          .where('id', '=', connection.id)
          .executeTakeFirstOrThrow();
        expect(stored.secret_env_refs).toEqual({ signingSecret: 'SHAPIO_SECRET_TEST_HOOK' });
        expect(testApp.app.publishing.secrets.decryptJson(stored.secrets_encrypted)).toEqual({});

        const running = worker();
        const run = expectStatus(
          await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
          201,
        ).json<Run>();
        await drain(running);
        const trigger = site.requests.at(-1);
        const expected = createHmac('sha256', 'whsec_from_environment')
          .update(`${String(trigger?.headers['x-shapio-timestamp'])}.${trigger?.body ?? ''}`)
          .digest('hex');
        expect(trigger?.headers['x-shapio-signature']).toBe(`v1=${expected}`);
        expectStatus(
          await callback(connection, 'whsec_from_environment', { runId: run.id, status: 'deployed' }),
          200,
        );

        delete process.env.SHAPIO_SECRET_TEST_HOOK;
        const tested = expectStatus(
          await admin.post(`/api/admin/deployments/connections/${connection.id}/test`, {}),
          200,
        ).json<{ ok: boolean; checks: Array<{ name: string; message: string }> }>();
        expect(tested.ok).toBe(false);
        expect(tested.checks[0]?.message).toMatch(/SHAPIO_SECRET_TEST_HOOK, which is not set/);
        const second = expectStatus(
          await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
          201,
        ).json<Run>();
        await drain(running);
        const failed = await getRun(second.id);
        expect(failed.status).toBe('failed');
        expect(failed.error).toMatch(/SHAPIO_SECRET_TEST_HOOK, which is not set/);
      } finally {
        delete process.env.SHAPIO_SECRET_TEST_HOOK;
      }
    });
  });

  describe('Cloudflare Pages', () => {
    const cloudflareConnection = (overrides: Record<string, unknown> = {}) =>
      createConnection({
        name: 'Pages',
        provider: 'cloudflare_pages',
        settings: { accountId: cloudflare.accountId, projectName: cloudflare.projectName },
        secrets: { deployHookUrl: cloudflare.deployHookUrl, apiToken: cloudflare.apiToken },
        triggerPolicy: ['publish', 'manual'],
        debounceSeconds: 0,
        allowPrivateNetwork: true,
        ...overrides,
      });

    it('tests the token and project', async () => {
      const { connection } = await cloudflareConnection();
      const ok = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/test`, {}),
        200,
      ).json<{
        ok: boolean;
        checks: Array<{ name: string; ok: boolean; message: string }>;
      }>();
      expect(ok.ok).toBe(true);
      expect(cloudflare.hookCalls).toBe(0);

      const updated = expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/deployments/connections/${connection.id}`,
          payload: { secrets: { apiToken: 'wrong' }, expectedVersion: connection.version },
        }),
        200,
      ).json<Connection>();
      const failed = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${updated.id}/test`, {}),
        200,
      ).json<{
        ok: boolean;
        checks: Array<{ name: string; ok: boolean; message: string }>;
      }>();
      expect(failed.ok).toBe(false);
      expect(failed.checks.find((check) => check.name === 'apiToken')?.message).toMatch(
        /Authentication error/,
      );
    });

    it('triggers the deploy hook and reports the real status from the API, never success before deploy succeeds', async () => {
      const { connection } = await cloudflareConnection();
      await publish('Cloudflare');
      const running = worker();
      await drain(running);
      expect(cloudflare.hookCalls).toBe(1);
      const [run] = await runsOf(connection.id);
      const deploymentId = cloudflare.deployments[0]?.id ?? '';
      expect(run).toMatchObject({ status: 'triggered', providerRef: deploymentId, completionReported: true });
      expect(run?.logUrl).toBe(
        `https://dash.cloudflare.com/${cloudflare.accountId}/pages/view/${cloudflare.projectName}/${deploymentId}`,
      );

      cloudflare.setStage(deploymentId, 'build', 'active');
      clock.advance(2000);
      await drain(running);
      expect((await getRun(run?.id ?? '')).status).toBe('building');

      cloudflare.setStage(deploymentId, 'deploy', 'active');
      clock.advance(2000);
      await drain(running);
      expect((await getRun(run?.id ?? '')).status).toBe('building');

      cloudflare.setStage(deploymentId, 'deploy', 'success');
      clock.advance(2000);
      await drain(running);
      const deployed = await getRun(run?.id ?? '');
      expect(deployed.status).toBe('deployed');
      expect(deployed.siteUrl).toContain('.pages.dev');
      expect(deployed.timeline.map((event) => `${event.status}/${event.source}`)).toEqual([
        'queued/shapio',
        'triggered/shapio',
        'building/provider',
        'deployed/provider',
      ]);
    });

    it('holds the deploy hook URL to the admin-destination network policy, at save and at send time', async () => {
      const hookPath = new URL(cloudflare.deployHookUrl).pathname;
      const atSave = await admin.post('/api/admin/deployments/connections', {
        name: 'Pages',
        provider: 'cloudflare_pages',
        settings: { accountId: cloudflare.accountId, projectName: cloudflare.projectName },
        secrets: { deployHookUrl: `http://10.0.0.1${hookPath}`, apiToken: cloudflare.apiToken },
        triggerPolicy: ['manual'],
      });
      expect(atSave.statusCode).toBe(400);
      expect(atSave.json()).toMatchObject({ error: { code: 'DESTINATION_NOT_ALLOWED' } });

      // Unresolvable when saved, resolving to the (private) fake Cloudflare when the hook is called.
      const host = 'hooks.rebind.attacker.test';
      const { connection } = await cloudflareConnection({
        secrets: {
          deployHookUrl: `http://${host}:${new URL(cloudflare.deployHookUrl).port}${hookPath}`,
          apiToken: cloudflare.apiToken,
        },
        allowPrivateNetwork: false,
      });
      testApp.dns.set(host, '127.0.0.1');
      const hookCallsBefore = cloudflare.hookCalls;
      const run = expectStatus(
        await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
        201,
      ).json<Run>();
      const running = worker();
      for (let round = 0; round < 6; round += 1) {
        await drain(running);
        clock.advance(10 * 60 * 1000);
      }
      const failed = await getRun(run.id);
      expect(failed.status).toBe('failed');
      expect(failed.error).toMatch(/private or reserved address/);
      expect(cloudflare.hookCalls).toBe(hookCallsBefore);
    });

    it('reports a failed build as failed, and matches the deployment by time when the hook returns no ID', async () => {
      cloudflare.hookReturnsId = false;
      try {
        const { connection } = await cloudflareConnection();
        const run = expectStatus(
          await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}),
          201,
        ).json<Run>();
        const running = worker();
        await drain(running);
        const deploymentId = cloudflare.deployments[0]?.id ?? '';
        expect((await getRun(run.id)).providerRef).toBeNull();

        cloudflare.setStage(deploymentId, 'build', 'failure');
        clock.advance(2000);
        await drain(running);
        expect(await getRun(run.id)).toMatchObject({
          status: 'failed',
          providerRef: deploymentId,
          error: 'Cloudflare: the build stage failed',
        });
      } finally {
        cloudflare.hookReturnsId = true;
      }
    });
  });

  describe('GitHub schema write-back', () => {
    const githubConnection = (mode: string) =>
      createConnection({
        name: 'Schema mirror',
        provider: 'github',
        settings: { owner: github.owner, repo: github.repo, branch: 'main', mode, directory: 'schema' },
        secrets: { token: github.token },
        triggerPolicy: ['schema'],
        debounceSeconds: 0,
      });

    it('commits the canonical schema files and lock file after a schema change, once per burst', async () => {
      const { connection } = await githubConnection('commit');
      expect(
        expectStatus(
          await admin.post(`/api/admin/deployments/connections/${connection.id}/test`, {}),
          200,
        ).json(),
      ).toMatchObject({ ok: true });
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'author',
        label: 'Author',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
      await drain(worker());
      const [run] = await runsOf(connection.id);
      expect(run?.status).toBe('deployed');
      expect(run?.logUrl).toContain('/commit/');
      const files = github.filesOn('main');
      expect([...files.keys()].sort()).toEqual([
        '.shapio/schema-lock.json',
        'README.md',
        'schema/models/author.json',
        'schema/models/page.json',
      ]);
      expect(JSON.parse(files.get('schema/models/author.json') ?? '{}')).toMatchObject({ apiKey: 'author' });
      const lock = JSON.parse(files.get('.shapio/schema-lock.json') ?? '{}') as {
        definitions: Record<string, { apiKey: string }>;
      };
      expect(
        Object.values(lock.definitions)
          .map((entry) => entry.apiKey)
          .sort(),
      ).toEqual(['author', 'page']);

      // Nothing changed: the next run commits nothing.
      const head = github.refs.get('heads/main');
      expectStatus(await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}), 201);
      await drain(worker());
      expect(github.refs.get('heads/main')).toBe(head);
      expect((await runsOf(connection.id))[0]?.timeline.at(-1)?.message).toMatch(/Already up to date/);
    });

    it('opens one pull request and updates it on later changes', async () => {
      const { connection } = await githubConnection('pull_request');
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'tag',
        label: 'Tag',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      });
      await drain(worker());
      expect(github.pulls).toHaveLength(1);
      expect(github.filesOn('shapio/schema-sync').has('schema/models/tag.json')).toBe(true);
      expect((await runsOf(connection.id))[0]).toMatchObject({
        status: 'deployed',
        logUrl: 'https://github.test/pull/1',
      });
    });
  });
});
