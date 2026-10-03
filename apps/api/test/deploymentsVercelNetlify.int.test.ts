import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { startFakeNetlify, type FakeNetlify } from './fixtures/netlifyApi.js';
import { startFakeVercel, type FakeVercel } from './fixtures/vercelApi.js';
import { createDefinition, expectStatus } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createLogCapture } from './helpers/logCapture.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
  type FakeDns,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Run = {
  id: string;
  status: string;
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
  settings: Record<string, string>;
  secrets: Record<string, { set: boolean }>;
};
type TestResult = { ok: boolean; checks: Array<{ name: string; ok: boolean; message: string }> };

const JOB_TYPES = [PUBLISHING_JOBS.deploymentTrigger, PUBLISHING_JOBS.deploymentPoll];

describe('Vercel and Netlify deployments', () => {
  const database = useTestDatabase();
  const logs = createLogCapture();
  let testApp: TestApp & { dns: FakeDns };
  let admin: SchemaClient;
  let vercel: FakeVercel;
  let netlify: FakeNetlify;
  const workers: Worker[] = [];
  const clock = createTestClock();

  const worker = () => {
    const created = createPublishingWorker({
      db: database.current.db,
      app: testApp.app,
      dns: testApp.dns,
      now: clock.now,
      pollIntervalMs: 1000,
      log: logs.logger,
    });
    workers.push(created);
    return created;
  };
  const drain = (running: Worker) =>
    drainJobs(running, database.current.db, { types: JOB_TYPES, now: clock.now });
  /** Drains, then moves the clock past the poll interval (and any retry backoff) for the next round. */
  const step = async (running: Worker, advanceMs = 2000) => {
    clock.advance(advanceMs);
    await drain(running);
  };

  const post = (url: string, body: Record<string, unknown>) => admin.post(url, body);
  const createConnection = async (body: Record<string, unknown>) =>
    expectStatus(await post('/api/admin/deployments/connections', body), 201).json<{
      connection: Connection;
      generatedSecrets: Record<string, string>;
    }>().connection;
  const testConnection = async (id: string) =>
    expectStatus(await post(`/api/admin/deployments/connections/${id}/test`, {}), 200).json<TestResult>();
  const deployNow = async (id: string) =>
    expectStatus(await post(`/api/admin/deployments/connections/${id}/runs`, {}), 201).json<Run>();
  const getRun = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/deployments/runs/${id}`), 200).json<Run>();
  const expectInvalid = async (body: Record<string, unknown>, field: string) => {
    const response = await post('/api/admin/deployments/connections', {
      name: 'Site',
      triggerPolicy: ['manual'],
      ...body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { details: { field } } });
  };

  beforeAll(async () => {
    vercel = await startFakeVercel(clock.now);
    netlify = await startFakeNetlify(clock.now);
    testApp = await createPublishingTestApp(database.current, {
      env: { VERCEL_API_URL: vercel.apiUrl, NETLIFY_API_URL: netlify.apiUrl },
      logger: logs.logger,
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((created) => created.stop(500)));
    await database.current.db.deleteFrom('deployment_connections').execute();
    vercel.state.hookFailsWith = undefined;
    vercel.state.hookCalls = 0;
    netlify.state.buildCalls = 0;
    netlify.state.buildFailsWith = undefined;
    netlify.state.buildReturnsDeployId = true;
  });

  afterAll(async () => {
    await Promise.all([vercel.close(), netlify.close()]);
    await testApp.app.close();
  });

  describe('Vercel', () => {
    const settings = () => ({ projectId: vercel.state.projectId, teamId: vercel.state.teamId });
    const secrets = () => ({ deployHookUrl: vercel.deployHookUrl, apiToken: vercel.state.apiToken });
    const vercelConnection = (overrides: Record<string, unknown> = {}) =>
      createConnection({
        name: 'Vercel',
        provider: 'vercel',
        settings: settings(),
        secrets: secrets(),
        triggerPolicy: ['publish', 'manual'],
        debounceSeconds: 0,
        allowPrivateNetwork: true,
        ...overrides,
      });

    it('validates the settings and secrets, and keeps secrets write-only', async () => {
      const base = { provider: 'vercel', allowPrivateNetwork: true };
      await expectInvalid(
        { ...base, settings: { teamId: 'team_x' }, secrets: secrets() },
        'settings.projectId',
      );
      await expectInvalid(
        { ...base, settings: { projectId: 'prj/../x' }, secrets: secrets() },
        'settings.projectId',
      );
      await expectInvalid(
        { ...base, settings: { ...settings(), region: 'iad1' }, secrets: secrets() },
        'settings.region',
      );
      await expectInvalid(
        { ...base, settings: settings(), secrets: { deployHookUrl: vercel.deployHookUrl } },
        'secrets.apiToken',
      );
      await expectInvalid(
        { ...base, settings: settings(), secrets: { apiToken: vercel.state.apiToken } },
        'secrets.deployHookUrl',
      );
      // The deploy hook is an admin-entered destination: private addresses need the connection's opt-in.
      const privateHook = await post('/api/admin/deployments/connections', {
        name: 'Vercel',
        provider: 'vercel',
        settings: settings(),
        secrets: { ...secrets(), deployHookUrl: `http://10.0.0.1${vercel.hookPath}` },
        triggerPolicy: ['manual'],
      });
      expect(privateHook.statusCode).toBe(400);
      expect(privateHook.json()).toMatchObject({ error: { code: 'DESTINATION_NOT_ALLOWED' } });

      const personal = await vercelConnection({
        settings: { projectId: vercel.state.projectId, teamId: '' },
      });
      expect(personal.settings).toEqual({ projectId: vercel.state.projectId });
      expect(personal.secrets).toEqual({
        deployHookUrl: { set: true, envVar: null },
        apiToken: { set: true, envVar: null },
      });
      const listed = JSON.stringify(
        (await admin.get(`/api/admin/deployments/connections/${personal.id}`)).json(),
      );
      expect(listed).not.toContain(vercel.state.apiToken);
      expect(listed).not.toContain(vercel.hookPath);
    });

    it('tests the token and project without calling the deploy hook', async () => {
      const connection = await vercelConnection();
      const ok = await testConnection(connection.id);
      expect(ok.ok).toBe(true);
      expect(ok.checks.find((check) => check.name === 'apiToken')?.message).toContain('example-site');
      expect(vercel.state.hookCalls).toBe(0);

      const updated = expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/deployments/connections/${connection.id}`,
          payload: { secrets: { apiToken: 'wrong' }, expectedVersion: connection.version },
        }),
        200,
      ).json<Connection>();
      const failed = await testConnection(updated.id);
      expect(failed.ok).toBe(false);
      expect(failed.checks.find((check) => check.name === 'apiToken')?.message).toMatch(/Not authorized/);
    });

    it('triggers the hook, matches the deployment by project and time, and reports its real state', async () => {
      const before = vercel.addDeployment(undefined, new Date(clock.now().getTime() - 10 * 60 * 1000));
      const connection = await vercelConnection();
      const run = await deployNow(connection.id);
      const running = worker();
      await drain(running);
      expect(vercel.state.hookCalls).toBe(1);
      const hooked = vercel.state.deployments[0];
      // A git push lands right after the hook: newer, but not this hook's deployment.
      const pushed = vercel.addDeployment(undefined);
      expect(await getRun(run.id)).toMatchObject({
        status: 'triggered',
        providerRef: null,
        completionReported: true,
      });

      vercel.setState(hooked?.uid ?? '', 'BUILDING');
      await step(running);
      const building = await getRun(run.id);
      expect(building).toMatchObject({ status: 'building', providerRef: hooked?.uid });
      expect(building.logUrl).toBe(`https://vercel.com/example/example-site/${hooked?.uid}`);
      expect([before.uid, pushed.uid]).not.toContain(building.providerRef);
      const listQuery = vercel.requests.find((request) => request.path === '/v6/deployments')?.query;
      expect(listQuery?.get('projectId')).toBe(vercel.state.projectId);
      expect(listQuery?.get('teamId')).toBe(vercel.state.teamId);

      vercel.setState(hooked?.uid ?? '', 'READY');
      await step(running);
      const deployed = await getRun(run.id);
      expect(deployed.status).toBe('deployed');
      expect(deployed.siteUrl).toMatch(/^https:\/\/example-site-.*\.vercel\.app$/);
      expect(deployed.timeline.map((event) => `${event.status}/${event.source}`)).toEqual([
        'queued/shapio',
        'triggered/shapio',
        'building/provider',
        'deployed/provider',
      ]);
    });

    it('reports a failed build with its error', async () => {
      const connection = await vercelConnection();
      const run = await deployNow(connection.id);
      const running = worker();
      await drain(running);
      vercel.setState(
        vercel.state.deployments[0]?.uid ?? '',
        'ERROR',
        'Command "npm run build" exited with 1',
      );
      await step(running);
      expect(await getRun(run.id)).toMatchObject({
        status: 'failed',
        error: 'Vercel: Command "npm run build" exited with 1',
      });
    });

    it('adopts the deployment a lost hook answer started instead of starting a second build', async () => {
      vercel.state.hookFailsWith = 502;
      const connection = await vercelConnection();
      const run = await deployNow(connection.id);
      const running = worker();
      await drain(running);
      expect(vercel.state.hookCalls).toBe(1);
      expect((await getRun(run.id)).status).toBe('queued');
      for (let round = 0; round < 5 && (await getRun(run.id)).status === 'queued'; round += 1) {
        await step(running, 10 * 60 * 1000);
      }
      const adopted = await getRun(run.id);
      expect(vercel.state.hookCalls).toBe(1);
      expect(adopted).toMatchObject({ status: 'triggered', providerRef: vercel.state.deployments[0]?.uid });
      expect(adopted.timeline.map((event) => event.message)).toContain(
        'Vercel: resumed tracking the deployment started earlier',
      );
    });
  });

  describe('Netlify', () => {
    const netlifyConnection = (overrides: Record<string, unknown> = {}) =>
      createConnection({
        name: 'Netlify',
        provider: 'netlify',
        settings: { siteId: netlify.state.siteId },
        secrets: { apiToken: netlify.state.apiToken },
        triggerPolicy: ['publish', 'manual'],
        debounceSeconds: 0,
        ...overrides,
      });

    it('validates the settings and secrets', async () => {
      const base = { provider: 'netlify' };
      const token = { apiToken: netlify.state.apiToken };
      await expectInvalid({ ...base, settings: {}, secrets: token }, 'settings.siteId');
      await expectInvalid({ ...base, settings: { siteId: 'a/b' }, secrets: token }, 'settings.siteId');
      await expectInvalid(
        { ...base, settings: { siteId: netlify.state.siteId }, secrets: {} },
        'secrets.apiToken',
      );
      await expectInvalid(
        {
          ...base,
          settings: { siteId: netlify.state.siteId },
          secrets: { ...token, deployHookUrl: 'https://x' },
        },
        'secrets.deployHookUrl',
      );
      const connection = await netlifyConnection();
      expect(connection.secrets).toEqual({ apiToken: { set: true, envVar: null } });
    });

    it('tests the token against the site', async () => {
      const connection = await netlifyConnection();
      expect((await testConnection(connection.id)).ok).toBe(true);
      expect(netlify.state.buildCalls).toBe(0);
      const updated = expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/deployments/connections/${connection.id}`,
          payload: { secrets: { apiToken: 'wrong' }, expectedVersion: connection.version },
        }),
        200,
      ).json<Connection>();
      const failed = await testConnection(updated.id);
      expect(failed.ok).toBe(false);
      expect(failed.checks[0]?.message).toMatch(/Access Denied: Invalid token/);
    });

    it('starts a build through the API on publish and follows its deploy to published', async () => {
      const connection = await netlifyConnection();
      const entry = expectStatus(
        await post('/api/admin/content/page', { data: { title: 'Netlify' } }),
        201,
      ).json<{ id: string }>();
      expectStatus(await post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
      const running = worker();
      await drain(running);
      expect(netlify.state.buildCalls).toBe(1);
      const deployId = netlify.state.deploys[0]?.id ?? '';
      const [run] = expectStatus(
        await admin.get(`/api/admin/deployments/runs?connectionId=${connection.id}`),
        200,
      ).json<{ items: Run[] }>().items;
      expect(run).toMatchObject({ status: 'triggered', providerRef: deployId, completionReported: true });
      const build = netlify.requests.find((request) => request.method === 'POST');
      expect(build?.path).toBe(`/api/v1/sites/${netlify.state.siteId}/builds`);

      netlify.setState(deployId, 'building');
      await step(running);
      const building = await getRun(run?.id ?? '');
      expect(building.status).toBe('building');
      expect(building.logUrl).toBe(`${netlify.adminUrl}/deploys/${deployId}`);

      netlify.setState(deployId, 'processing');
      await step(running);
      expect((await getRun(run?.id ?? '')).status).toBe('building');

      netlify.setState(deployId, 'ready');
      await step(running);
      const deployed = await getRun(run?.id ?? '');
      expect(deployed).toMatchObject({
        status: 'deployed',
        siteUrl: `https://${deployId}--example-site.netlify.app`,
      });
      expect(deployed.timeline.map((event) => `${event.status}/${event.source}`)).toEqual([
        'queued/shapio',
        'triggered/shapio',
        'building/provider',
        'deployed/provider',
      ]);
    });

    it('reports a failed deploy with its error, and a skipped build as not updating the site', async () => {
      const connection = await netlifyConnection();
      const running = worker();
      const failedRun = await deployNow(connection.id);
      await drain(running);
      netlify.setState(
        netlify.state.deploys[0]?.id ?? '',
        'error',
        'Build script returned non-zero exit code: 2',
      );
      await step(running);
      expect(await getRun(failedRun.id)).toMatchObject({
        status: 'failed',
        error: 'Netlify: Build script returned non-zero exit code: 2',
      });

      const skippedRun = await deployNow(connection.id);
      await drain(running);
      netlify.setState(netlify.state.deploys[0]?.id ?? '', 'skipped');
      await step(running);
      expect(await getRun(skippedRun.id)).toMatchObject({
        status: 'failed',
        error: 'Netlify: the build was skipped; the site was not updated',
      });
    });

    it('finds the deploy from the site’s builds when the build answer has no deploy ID', async () => {
      netlify.state.buildReturnsDeployId = false;
      const connection = await netlifyConnection();
      const run = await deployNow(connection.id);
      const running = worker();
      await drain(running);
      expect((await getRun(run.id)).providerRef).toBeNull();
      const deployId = netlify.state.deploys[0]?.id ?? '';
      netlify.setState(deployId, 'building');
      await step(running);
      expect(await getRun(run.id)).toMatchObject({ status: 'building', providerRef: deployId });
    });

    it('adopts the build a lost answer started instead of starting a second one', async () => {
      netlify.state.buildFailsWith = 502;
      const connection = await netlifyConnection();
      const run = await deployNow(connection.id);
      const running = worker();
      await drain(running);
      for (let round = 0; round < 5 && (await getRun(run.id)).status === 'queued'; round += 1) {
        await step(running, 10 * 60 * 1000);
      }
      expect(netlify.state.buildCalls).toBe(1);
      expect(await getRun(run.id)).toMatchObject({
        status: 'triggered',
        providerRef: netlify.state.deploys[0]?.id,
      });
    });
  });

  it('never writes the API tokens or the deploy hook path to the logs or the runs', async () => {
    // Earlier tests in this file ran triggers, polls, failures and retries with this capture attached;
    // this one adds a failing trigger of each provider so error paths are covered too.
    const vercelConnection = await createConnection({
      name: 'Vercel',
      provider: 'vercel',
      settings: { projectId: vercel.state.projectId, teamId: vercel.state.teamId },
      secrets: { deployHookUrl: vercel.deployHookUrl, apiToken: vercel.state.apiToken },
      triggerPolicy: ['manual'],
      debounceSeconds: 0,
      allowPrivateNetwork: true,
    });
    const netlifyConnection = await createConnection({
      name: 'Netlify',
      provider: 'netlify',
      settings: { siteId: netlify.state.siteId },
      secrets: { apiToken: netlify.state.apiToken },
      triggerPolicy: ['manual'],
      debounceSeconds: 0,
    });
    vercel.state.hookFailsWith = 500;
    netlify.state.buildFailsWith = 500;
    vercel.state.deployments.splice(0);
    netlify.state.deploys.splice(0);
    const runs = [await deployNow(vercelConnection.id), await deployNow(netlifyConnection.id)];
    const running = worker();
    await drain(running);
    const views = JSON.stringify(await Promise.all(runs.map((run) => getRun(run.id))));
    const text = logs.text();
    expect(logs.lines.length).toBeGreaterThan(0);
    for (const secret of [vercel.state.apiToken, netlify.state.apiToken, vercel.hookPath]) {
      expect(text).not.toContain(secret);
      expect(views).not.toContain(secret);
    }
  });
});
