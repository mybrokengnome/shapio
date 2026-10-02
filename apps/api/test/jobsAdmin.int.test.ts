import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob } from '../src/jobs/queue.js';
import { expectStatus } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Job = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  payload: Record<string, unknown>;
  lastError: string | null;
};

describe('admin jobs view', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists, filters and pages jobs with secret-looking payload values redacted', async () => {
    const { db } = database.current;
    const { job: dead } = await enqueueJob(
      {
        type: 'test.secretive',
        payload: { runId: 'r1', apiToken: 'cf-123', nested: { signingSecret: 'whsec_x' } },
      },
      db,
    );
    await db
      .updateTable('jobs')
      .set({ status: 'dead', attempts: 10, last_error: 'boom' })
      .where('id', '=', dead.id)
      .execute();
    for (let index = 0; index < 3; index += 1) {
      await enqueueJob({ type: 'test.other', payload: { index } }, db);
    }

    const filtered = expectStatus(await admin.get('/api/admin/jobs?status=dead'), 200).json<{
      items: Job[];
    }>();
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.payload).toEqual({
      runId: 'r1',
      apiToken: '[redacted]',
      nested: { signingSecret: '[redacted]' },
    });

    const firstPage = expectStatus(await admin.get('/api/admin/jobs?type=test.other&limit=2'), 200).json<{
      items: Job[];
      nextCursor: string | null;
    }>();
    expect(firstPage.items).toHaveLength(2);
    const secondPage = expectStatus(
      await admin.get(`/api/admin/jobs?type=test.other&limit=2&cursor=${firstPage.nextCursor ?? ''}`),
      200,
    ).json<{ items: Job[]; nextCursor: string | null }>();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const summary = expectStatus(await admin.get('/api/admin/jobs/summary'), 200).json<{
      counts: Record<string, number>;
      types: string[];
    }>();
    expect(summary.counts.dead).toBe(1);
    expect(summary.types).toEqual(expect.arrayContaining(['test.other', 'test.secretive']));
    expect((await admin.get('/api/admin/jobs?cursor=not-a-cursor')).statusCode).toBe(400);
  });

  it('retries dead jobs only, and audits it', async () => {
    const { db } = database.current;
    const { job } = await enqueueJob({ type: 'test.retry' }, db);
    expect((await admin.post(`/api/admin/jobs/${job.id}/retry`, {})).statusCode).toBe(409);
    await db
      .updateTable('jobs')
      .set({ status: 'dead', attempts: 10, last_error: 'gave up' })
      .where('id', '=', job.id)
      .execute();
    const retried = expectStatus(await admin.post(`/api/admin/jobs/${job.id}/retry`, {}), 200).json<Job>();
    expect(retried).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: 'Retried by an admin after: gave up',
    });
    const audit = await db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', job.id)
      .execute();
    expect(audit).toEqual([{ action: 'job.retry' }]);
  });

  it('needs publishing.manage', async () => {
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect((await editor.get('/api/admin/jobs')).statusCode).toBe(403);
    expect((await schemaClient(testApp.app, undefined).get('/api/admin/jobs')).statusCode).toBe(401);
  });
});
