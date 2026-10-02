import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type Delivery = { deliveryId: string; runId: string; headers: IncomingHttpHeaders };
type Run = { id: string; status: string; snapshot: number | null; trigger: string };

/**
 * A build endpoint that answers each trigger as the test decides: `hold` keeps the request open (the worker
 * is then mid-trigger), `accept` answers 202 at once and calls `onAccepted` once the answer is written.
 */
const startBuildEndpoint = async () => {
  const deliveries: Delivery[] = [];
  const held: ServerResponse[] = [];
  let mode: 'hold' | 'accept' = 'accept';
  let onAccepted: (() => void) | undefined;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { runId: string };
      deliveries.push({
        deliveryId: String(req.headers['x-shapio-delivery']),
        runId: body.runId,
        headers: req.headers,
      });
      if (mode === 'hold') {
        held.push(res);
        return;
      }
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end('{}', () => onAccepted?.());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/build`,
    deliveries,
    setMode: (next: 'hold' | 'accept', accepted?: () => void) => {
      mode = next;
      onAccepted = accepted;
    },
    close: () => {
      for (const response of held) {
        response.destroy();
      }
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

/**
 * Brief §10 "Worker crash/retry does not lose a publish event or create duplicate logical deployments": a
 * real worker process is SIGKILLed while a deployment trigger is in flight; the next worker finishes the same
 * run, and every delivery the build endpoint saw carries that one run's ID (its idempotency key).
 */
describe('deployments across a worker crash', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let endpoint: Awaited<ReturnType<typeof startBuildEndpoint>>;
  const children: SpawnedProcess[] = [];
  const LEASE_MS = 1500;

  const startWorker = (workerId: string) => {
    const child = spawnTsProcess('test/fixtures/deploymentWorker.ts', {
      DATABASE_URL: database.current.url,
      WORKER_ID: workerId,
      LEASE_MS: String(LEASE_MS),
      SIGNING_SECRET: testApp.app.signingSecret,
    });
    children.push(child);
    return child;
  };

  const createConnection = async (name: string, debounceSeconds = 0) =>
    expectStatus(
      await admin.post('/api/admin/deployments/connections', {
        name,
        provider: 'generic_webhook',
        settings: { url: endpoint.url },
        secrets: {},
        triggerPolicy: ['publish'],
        debounceSeconds,
        allowPrivateNetwork: true,
      }),
      201,
    ).json<{ connection: { id: string } }>().connection;

  const publish = async (title: string) => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/page', { data: { title } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
    return entry;
  };

  const runsOf = async (connectionId: string) =>
    expectStatus(await admin.get(`/api/admin/deployments/runs?connectionId=${connectionId}`), 200).json<{
      items: Run[];
    }>().items;

  const publishEventOf = (entryId: string) =>
    database.current.db
      .selectFrom('outbox_events')
      .select(['id', 'dispatched_at'])
      .where('type', '=', 'entry.published')
      .where('aggregate_id', '=', entryId)
      .execute();

  const triggerJobsOf = (runId: string) =>
    database.current.db
      .selectFrom('jobs')
      .selectAll()
      .where('type', '=', PUBLISHING_JOBS.deploymentTrigger)
      .where('idempotency_key', '=', `deployment-trigger:${runId}`)
      .execute();

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    endpoint = await startBuildEndpoint();
  });

  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => child.stop('SIGKILL')));
    await database.current.db.deleteFrom('deployment_connections').execute();
    endpoint.deliveries.splice(0);
  });

  afterAll(async () => {
    await endpoint.close();
    await testApp.app.close();
  });

  it('a worker killed mid-trigger: the next worker completes the same run, with the same delivery ID', async () => {
    const connection = await createConnection('Crash mid-trigger');
    // Published while no worker runs: the event waits in the outbox.
    const entry = await publish('Published before the crash');
    const [event] = await publishEventOf(entry.id);
    expect(event?.dispatched_at).toBeNull();

    endpoint.setMode('hold');
    const first = startWorker('deploy-crash-1');
    await waitFor(async () => endpoint.deliveries.length === 1, { timeoutMs: 20_000 });
    expect(await first.stop('SIGKILL')).toBeNull();

    const [queued] = await runsOf(connection.id);
    expect(queued).toMatchObject({ status: 'queued', trigger: 'publish' });
    const [inFlight] = await triggerJobsOf(queued?.id ?? '');
    expect(inFlight).toMatchObject({ status: 'running', attempts: 1 });

    endpoint.setMode('accept');
    startWorker('deploy-crash-2');
    const run = await waitFor(
      async () => {
        const [current] = await runsOf(connection.id);
        return current?.status === 'triggered' ? current : undefined;
      },
      { timeoutMs: 20_000 },
    );

    // One logical deployment for the publish, and its event was not lost.
    expect(await runsOf(connection.id)).toEqual([run]);
    expect(run.id).toBe(queued?.id);
    expect((await publishEventOf(entry.id))[0]?.dispatched_at).not.toBeNull();
    const jobs = await triggerJobsOf(run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'succeeded', attempts: 2 });

    // The endpoint saw the trigger twice (the crashed attempt and the retry), both as the same delivery.
    expect(endpoint.deliveries).toHaveLength(2);
    expect(new Set(endpoint.deliveries.map((delivery) => delivery.deliveryId))).toEqual(new Set([run.id]));
    expect(new Set(endpoint.deliveries.map((delivery) => delivery.runId))).toEqual(new Set([run.id]));
  }, 60_000);

  it('a worker killed right after the endpoint accepted: still one run, never a second delivery ID', async () => {
    const connection = await createConnection('Crash after accept');
    const crashing: { worker?: SpawnedProcess } = {};
    endpoint.setMode('accept', () => {
      // Kill the worker the moment the endpoint has answered: before or after the run is marked triggered.
      crashing.worker?.child.kill('SIGKILL');
    });
    const first = startWorker('deploy-accept-1');
    crashing.worker = first;
    const entry = await publish('Accepted, then crashed');
    await waitFor(async () => endpoint.deliveries.length >= 1, { timeoutMs: 20_000 });
    await first.stop('SIGKILL');

    endpoint.setMode('accept');
    startWorker('deploy-accept-2');
    const run = await waitFor(
      async () => {
        const [current] = await runsOf(connection.id);
        const [job] = current ? await triggerJobsOf(current.id) : [];
        return current?.status === 'triggered' && job?.status === 'succeeded' ? current : undefined;
      },
      { timeoutMs: 20_000 },
    );
    expect(await runsOf(connection.id)).toEqual([run]);
    expect((await publishEventOf(entry.id))[0]?.dispatched_at).not.toBeNull();
    expect(endpoint.deliveries.length).toBeGreaterThanOrEqual(1);
    expect(endpoint.deliveries.length).toBeLessThanOrEqual(2);
    expect(new Set(endpoint.deliveries.map((delivery) => delivery.deliveryId))).toEqual(new Set([run.id]));
  }, 60_000);

  it('a burst of publishes while the worker is down becomes one run once a worker is back', async () => {
    const connection = await createConnection('Burst', 1);
    const first = startWorker('deploy-burst-1');
    await first.waitForLog((line) => line.msg === 'worker ready');
    expect(await first.stop('SIGKILL')).toBeNull();
    const entries = [];
    for (const title of ['Burst one', 'Burst two', 'Burst three']) {
      entries.push(await publish(title));
    }

    endpoint.setMode('accept');
    startWorker('deploy-burst-2');
    const run = await waitFor(
      async () => {
        const [current] = await runsOf(connection.id);
        return current?.status === 'triggered' ? current : undefined;
      },
      { timeoutMs: 20_000 },
    );
    // Every publish event is dispatched (none lost), and they coalesced into the one run.
    for (const entry of entries) {
      expect((await publishEventOf(entry.id))[0]?.dispatched_at).not.toBeNull();
    }
    expect(await runsOf(connection.id)).toEqual([run]);
    expect(endpoint.deliveries.map((delivery) => delivery.deliveryId)).toEqual([run.id]);
  }, 60_000);
});
