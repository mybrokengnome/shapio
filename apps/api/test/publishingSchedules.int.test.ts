import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { CONTENT_HEALTH_JOBS, contentHealthOutboxSubscriber } from '../src/jobs/contentHealth.js';
import type { Worker } from '../src/jobs/worker.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import { createAdmin, login } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type Schedule = { id: string; status: string; error: string | null; snapshot: number | null };

describe('scheduled publications', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let deliveryToken: string;
  const children: SpawnedProcess[] = [];
  const workers: Worker[] = [];
  const LEASE_MS = 1500;

  const createEntry = async (title: string) =>
    expectStatus(await admin.post('/api/admin/content/article', { data: { title } }), 201).json<EntryBody>();

  const schedule = async (client: SchemaClient, entryId: string, runAt: Date, action = 'publish') =>
    client.post('/api/admin/publishing/schedules', {
      modelKey: 'article',
      entryId,
      action,
      runAt: runAt.toISOString(),
    });

  const publicationsOf = (entryId: string) =>
    database.current.db.selectFrom('publication_log').selectAll().where('entry_id', '=', entryId).execute();
  const publishEventsOf = (entryId: string) =>
    database.current.db
      .selectFrom('outbox_events')
      .select('id')
      .where('type', '=', 'entry.published')
      .where('aggregate_id', '=', entryId)
      .execute();
  const scheduleRow = (id: string) =>
    database.current.db
      .selectFrom('scheduled_publications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const deliver = (id: string) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/content/articles/${id}`,
      headers: { authorization: `Bearer ${deliveryToken}` },
    });

  const worker = (now?: () => Date) => {
    const created = createPublishingWorker({
      db: database.current.db,
      app: testApp.app,
      ...(now ? { now } : {}),
    });
    workers.push(created);
    return created;
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    deliveryToken = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
  });

  afterAll(async () => {
    await Promise.all(workers.map((created) => created.stop(500)));
    await Promise.all(children.map((child) => child.stop('SIGKILL')));
    await testApp.app.close();
  });

  it('publishes when the time comes, not before, and records the snapshot', async () => {
    const entry = await createEntry('Scheduled');
    const clock = createTestClock();
    const created = expectStatus(
      await schedule(admin, entry.id, new Date(Date.now() + 60_000)),
      201,
    ).json<Schedule>();
    expect(created.status).toBe('scheduled');

    const running = worker(clock.now);
    await drainJobs(running, database.current.db, {
      types: [PUBLISHING_JOBS.scheduledPublication],
      now: clock.now,
    });
    expect((await deliver(entry.id)).statusCode).toBe(404);

    clock.advance(61_000);
    await drainJobs(running, database.current.db, {
      types: [PUBLISHING_JOBS.scheduledPublication],
      now: clock.now,
    });
    expect(expectStatus(await deliver(entry.id), 200).json<{ data: { title: string } }>().data.title).toBe(
      'Scheduled',
    );
    const done = await scheduleRow(created.id);
    expect(done).toMatchObject({ status: 'done', error: null });
    expect(done.snapshot_seq).not.toBeNull();
    expect(await publicationsOf(entry.id)).toHaveLength(1);

    const listed = expectStatus(
      await admin.get(`/api/admin/publishing/schedules?entryId=${entry.id}`),
      200,
    ).json<{ items: Schedule[] }>();
    expect(listed.items).toEqual([expect.objectContaining({ id: created.id, status: 'done' })]);
  });

  it('unpublishes at the scheduled time and cancelled schedules do nothing', async () => {
    const entry = await createEntry('Goes offline');
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    const unpublish = expectStatus(
      await schedule(admin, entry.id, new Date(), 'unpublish'),
      201,
    ).json<Schedule>();
    const other = await createEntry('Never published');
    const cancelled = expectStatus(await schedule(admin, other.id, new Date()), 201).json<Schedule>();
    expect((await admin.delete(`/api/admin/publishing/schedules/${cancelled.id}`)).statusCode).toBe(204);

    await drainJobs(worker(), database.current.db, { types: [PUBLISHING_JOBS.scheduledPublication] });
    expect((await deliver(entry.id)).statusCode).toBe(404);
    expect((await scheduleRow(unpublish.id)).status).toBe('done');
    expect((await scheduleRow(cancelled.id)).status).toBe('cancelled');
    expect(await publicationsOf(other.id)).toHaveLength(0);
    expect((await admin.delete(`/api/admin/publishing/schedules/${cancelled.id}`)).statusCode).toBe(409);
  });

  it('checks publish permission when scheduling, and again when it runs', async () => {
    const entry = await createEntry('Permission');
    const readOnly = schemaClient(testApp.app, await createRoleToken(database.current.db, 'read-only'));
    expect((await schedule(readOnly, entry.id, new Date())).statusCode).toBe(403);

    // An editor schedules, then is disabled before the time comes: nothing is published.
    const editor = await createAdmin(database.current.db, { roleKeys: ['editor'] });
    const session = await login(testApp.app, editor);
    const created = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/publishing/schedules',
      headers: session.headers,
      payload: { modelKey: 'article', entryId: entry.id, action: 'publish', runAt: new Date().toISOString() },
    });
    const scheduled = expectStatus(created, 201).json<Schedule>();
    await database.current.db
      .updateTable('admin_users')
      .set({ status: 'disabled' })
      .where('id', '=', editor.id)
      .execute();

    await drainJobs(worker(), database.current.db, { types: [PUBLISHING_JOBS.scheduledPublication] });
    const failed = await scheduleRow(scheduled.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/no longer exists or is disabled/);
    expect(await publicationsOf(entry.id)).toHaveLength(0);
    expect((await jobsRepository.findById(failed.job_id ?? '', database.current.db))?.status).toBe('dead');
  });

  it('refuses times in the past and models without drafts', async () => {
    const entry = await createEntry('Past');
    expect((await schedule(admin, entry.id, new Date(Date.now() - 3_600_000))).statusCode).toBe(400);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      draftAndPublish: false,
      fields: [{ apiKey: 'body', label: 'Body', type: 'string' }],
    });
    const note = expectStatus(
      await admin.post('/api/admin/content/note', { data: { body: 'x' } }),
      201,
    ).json<EntryBody>();
    const response = await admin.post('/api/admin/publishing/schedules', {
      modelKey: 'note',
      entryId: note.id,
      action: 'publish',
      runAt: new Date().toISOString(),
    });
    expect(response.statusCode).toBe(422);
  });

  it('a due scheduled publish is claimed ahead of a due content-health backlog', async () => {
    const backlogSize = 200;
    // Health checks enqueued through their real outbox subscriber, all due before the schedule.
    await database.current.db.transaction().execute(async (trx) => {
      for (let i = 0; i < backlogSize; i += 1) {
        await contentHealthOutboxSubscriber(
          {
            id: String(i),
            event_id: randomUUID(),
            type: 'entry.updated',
            aggregate_type: 'entry',
            aggregate_id: randomUUID(),
            payload: {},
            site_id: null,
            created_at: new Date(),
            dispatched_at: null,
            dispatch_attempts: 0,
            last_dispatch_error: null,
          },
          trx,
        );
      }
    });
    const entry = await createEntry('Ahead of the backlog');
    const created = expectStatus(await schedule(admin, entry.id, new Date()), 201).json<Schedule>();

    const workerId = `claim-${randomUUID()}`;
    const at = new Date(Date.now() + 1000);
    const [claimed] = await jobsRepository.claimRunnable(
      { workerId, limit: 1, now: at, leaseUntil: new Date(at.getTime() + 10_000) },
      database.current.db,
    );
    expect(claimed).toMatchObject({
      type: PUBLISHING_JOBS.scheduledPublication,
      payload: { scheduleId: created.id },
    });

    // Hand the job back, drop the synthetic backlog, and let the schedule run to completion.
    await jobsRepository.release({ id: claimed!.id, workerId }, new Date(), database.current.db);
    await database.current.db.deleteFrom('jobs').where('type', '=', CONTENT_HEALTH_JOBS.entry).execute();
    await drainJobs(worker(), database.current.db, { types: [PUBLISHING_JOBS.scheduledPublication] });
    expect(await scheduleRow(created.id)).toMatchObject({ status: 'done' });
  });

  describe('exactly once across a worker restart', { timeout: 60_000 }, () => {
    const startChild = (workerId: string, hangAt: string) => {
      const child = spawnTsProcess('test/fixtures/publishingWorker.ts', {
        DATABASE_URL: database.current.url,
        WORKER_ID: workerId,
        LEASE_MS: String(LEASE_MS),
        SIGNING_SECRET: testApp.app.signingSecret,
        HANG_AT: hangAt,
      });
      children.push(child);
      return child;
    };

    afterEach(async () => {
      await Promise.all(children.splice(0).map((child) => child.stop('SIGKILL')));
    });

    const waitForSchedule = (id: string, status: string) =>
      waitFor(async () => ((await scheduleRow(id)).status === status ? true : undefined), {
        timeoutMs: 30_000,
        description: `schedule ${id} to reach status '${status}'`,
      });

    it('a worker killed before commit publishes nothing; the next worker publishes once', async () => {
      const entry = await createEntry('Crash before commit');
      const created = expectStatus(await schedule(admin, entry.id, new Date()), 201).json<Schedule>();

      const first = startChild('crash-before', 'beforeCommit');
      await first.waitForLog(
        (line) => line.msg === 'published inside the transaction; hanging before commit',
        { description: "'published inside the transaction; hanging before commit'" },
      );
      expect(await first.stop('SIGKILL')).toBeNull();
      expect(await publicationsOf(entry.id)).toHaveLength(0);
      expect((await scheduleRow(created.id)).status).toBe('scheduled');

      startChild('recover-before', 'never');
      await waitForSchedule(created.id, 'done');
      expect(await publicationsOf(entry.id)).toHaveLength(1);
      expect(await publishEventsOf(entry.id)).toHaveLength(1);
    });

    it('a worker killed after commit is not repeated by the next worker', async () => {
      const entry = await createEntry('Crash after commit');
      const created = expectStatus(await schedule(admin, entry.id, new Date()), 201).json<Schedule>();

      const first = startChild('crash-after', 'afterCommit');
      await first.waitForLog(
        (line) => line.msg === 'handler finished; hanging before the job is marked succeeded',
        { description: "'handler finished; hanging before the job is marked succeeded'" },
      );
      expect(await first.stop('SIGKILL')).toBeNull();
      const row = await scheduleRow(created.id);
      expect(row.status).toBe('done');
      expect((await jobsRepository.findById(row.job_id ?? '', database.current.db))?.status).toBe('running');

      startChild('recover-after', 'never');
      const job = await waitFor(
        async () => {
          const current = await jobsRepository.findById(row.job_id ?? '', database.current.db);
          // Terminal state only: a dead job fails the assertion below instead of timing out here.
          return current?.status === 'succeeded' || current?.status === 'dead' ? current : undefined;
        },
        { timeoutMs: 30_000, description: `job ${row.job_id} to finish on the recovering worker` },
      );
      expect(job).toMatchObject({ status: 'succeeded', attempts: 2 });
      expect(job.result).toEqual({ skipped: 'done' });
      expect(await publicationsOf(entry.id)).toHaveLength(1);
      expect(await publishEventsOf(entry.id)).toHaveLength(1);
    });
  });
});
