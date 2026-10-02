import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import {
  createRetentionJobHandlers,
  ensureRetentionScheduled,
  RETENTION_JOB,
} from '../src/jobs/retention.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** The daily `system.retention` job: prunes finished bookkeeping older than RETENTION_DAYS, nothing else. */
describe('retention job', () => {
  const database = useTestDatabase();
  let worker: Worker;

  const insertJob = (label: string, status: string, finishedAt: Date | null) =>
    database.current.db
      .insertInto('jobs')
      .values({ type: 'test.noop', status, finished_at: finishedAt, idempotency_key: label })
      .execute();
  const insertEvent = (label: string, dispatchedAt: Date | null) =>
    database.current.db
      .insertInto('outbox_events')
      .values({
        type: 'test.event',
        aggregate_type: 'test',
        aggregate_id: label,
        dispatched_at: dispatchedAt,
      })
      .execute();
  const insertHookRun = (label: string, completedAt: Date) =>
    database.current.db
      .insertInto('extension_hook_runs')
      .values({ event_id: randomUUID(), hook: label, completed_at: completedAt })
      .execute();

  beforeAll(async () => {
    await insertJob('old-succeeded', 'succeeded', daysAgo(31));
    await insertJob('recent-succeeded', 'succeeded', daysAgo(29));
    await insertJob('old-dead', 'dead', daysAgo(90));
    await insertJob('old-pending', 'pending', null);
    await insertEvent('old-dispatched', daysAgo(31));
    await insertEvent('recent-dispatched', daysAgo(1));
    await insertEvent('old-undispatched', null);
    await database.current.db
      .updateTable('outbox_events')
      .set({ created_at: daysAgo(90) })
      .where('aggregate_id', '=', 'old-undispatched')
      .execute();
    await insertHookRun('old-run', daysAgo(31));
    await insertHookRun('recent-run', daysAgo(2));

    worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers(createRetentionJobHandlers(database.current.db, { days: 30 })),
      workerId: 'retention-test',
      concurrency: 1,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
    const { job } = await ensureRetentionScheduled(database.current.db);
    await waitFor(async () => {
      await worker.tick();
      const row = await database.current.db
        .selectFrom('jobs')
        .select('status')
        .where('id', '=', job.id)
        .executeTakeFirst();
      return row?.status === 'succeeded';
    });
  });

  afterAll(async () => {
    await worker.stop(500);
  });

  it('deletes old succeeded jobs only, keeping dead, pending and recent ones', async () => {
    const keys = await database.current.db
      .selectFrom('jobs')
      .select('idempotency_key')
      .where('type', '=', 'test.noop')
      .orderBy('idempotency_key')
      .execute();
    expect(keys.map((row) => row.idempotency_key)).toEqual(['old-dead', 'old-pending', 'recent-succeeded']);
  });

  it('deletes old dispatched outbox events only, keeping undispatched ones however old', async () => {
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select('aggregate_id')
      .where('type', '=', 'test.event')
      .orderBy('aggregate_id')
      .execute();
    expect(events.map((row) => row.aggregate_id)).toEqual(['old-undispatched', 'recent-dispatched']);
  });

  it('deletes old after-hook run records', async () => {
    const runs = await database.current.db.selectFrom('extension_hook_runs').select('hook').execute();
    expect(runs.map((row) => row.hook)).toEqual(['recent-run']);
  });

  it("schedules tomorrow's run once, and is idempotent per day", async () => {
    const { created } = await ensureRetentionScheduled(database.current.db);
    expect(created).toBe(false);
    const jobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'run_at'])
      .where('type', '=', RETENTION_JOB)
      .orderBy('run_at')
      .execute();
    expect(jobs.map((row) => row.status)).toEqual(['succeeded', 'pending']);
    expect(jobs[1]?.run_at.getTime()).toBeGreaterThan(Date.now() + DAY_MS - 60_000);
  });
});
