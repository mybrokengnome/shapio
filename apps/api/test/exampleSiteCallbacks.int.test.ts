import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendCallback } from '../../../examples/astro/scripts/lib/callback.js';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { expectStatus } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  drainJobs,
  startReceiver,
  type FakeDns,
  type Receiver,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * The example site's build callback sender (examples/astro/scripts/lib/callback.ts) against the real
 * hooks endpoint: a generic-webhook run triggered by Shapio is moved to building, then deployed, by the
 * signed reports the site's build pipeline sends.
 */
describe('example site: signed build callbacks', () => {
  const database = useTestDatabase();
  let testApp: TestApp & { dns: FakeDns };
  let admin: SchemaClient;
  let site: Receiver;
  let origin: string;

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    origin = `http://127.0.0.1:${(testApp.app.server.address() as AddressInfo).port}`;
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    site = await startReceiver();
  });

  afterAll(async () => {
    await site.close();
    await testApp.app.close();
  });

  it('reports building and deployed for the run in the trigger', async () => {
    const { connection, generatedSecrets } = expectStatus(
      await admin.post('/api/admin/deployments/connections', {
        name: 'Example site',
        provider: 'generic_webhook',
        settings: { url: `${site.url}/build` },
        secrets: {},
        triggerPolicy: ['manual'],
        debounceSeconds: 0,
        allowPrivateNetwork: true,
      }),
      201,
    ).json<{ connection: { id: string }; generatedSecrets: { signingSecret: string } }>();
    expectStatus(await admin.post(`/api/admin/deployments/connections/${connection.id}/runs`, {}), 201);
    const worker = createPublishingWorker({ db: database.current.db, app: testApp.app, dns: testApp.dns });
    await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.deploymentTrigger] });
    await worker.stop(500);

    const trigger = JSON.parse(site.requests[0]?.body ?? '{}') as {
      runId: string;
      callbackUrl: string;
      snapshot: number;
    };
    // The trigger's callback URL is built from PUBLIC_URL; this test server listens on a random port.
    const callbackUrl = `${origin}${new URL(trigger.callbackUrl).pathname}`;
    const secret = generatedSecrets.signingSecret;

    expect(await sendCallback(callbackUrl, secret, { runId: trigger.runId, status: 'building' })).toEqual({
      applied: true,
      status: 'building',
    });
    expect(
      await sendCallback(callbackUrl, secret, {
        runId: trigger.runId,
        status: 'deployed',
        siteUrl: 'https://site.example.test',
        message: 'Built at snapshot ' + String(trigger.snapshot),
      }),
    ).toEqual({ applied: true, status: 'deployed' });
    await expect(
      sendCallback(callbackUrl, 'whsec_wrong', { runId: trigger.runId, status: 'failed' }),
    ).rejects.toThrow(/HTTP 401/);

    const run = expectStatus(await admin.get(`/api/admin/deployments/runs/${trigger.runId}`), 200).json<{
      status: string;
      siteUrl: string;
    }>();
    expect(run).toMatchObject({ status: 'deployed', siteUrl: 'https://site.example.test/' });
  });
});
