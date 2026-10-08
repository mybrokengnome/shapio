import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleKeyFor } from '../src/content/transfer/bundleFile.js';
import { TRANSFER_IMPORT_JOB } from '../src/content/transfer/job.js';
import { createUrlBuilder } from '../src/helpers/publicUrl.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import {
  createRetentionJobHandlers,
  ensureRetentionScheduled,
  RETENTION_JOB,
} from '../src/jobs/retention.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createMediaStorage } from '../src/media/storage.js';
import type { MediaStorage } from '../src/media/types.js';
import { testConfig } from './helpers/createTestApp.js';
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

/** Dead imports keep their bundle for the retention period (an operator may retry them), then it goes. */
describe('retention job: bundles of dead imports', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-retention-'));
  let storage: MediaStorage;

  const deadImport = async (importId: string, finishedAt: Date) => {
    const bundle = { driver: storage.active.driver, key: bundleKeyFor(importId) };
    await storage.active.put(bundle.key, Buffer.from('{}\n'), {
      contentType: 'application/x-ndjson',
      contentLength: 3,
    });
    await database.current.db
      .insertInto('jobs')
      .values({
        type: TRANSFER_IMPORT_JOB,
        status: 'dead',
        finished_at: finishedAt,
        payload: JSON.stringify({ importId, bundle }),
      })
      .execute();
    return bundle.key;
  };

  beforeAll(async () => {
    const config = testConfig(database.current, { MEDIA_PATH: mediaPath });
    storage = await createMediaStorage(config.storage, { urls: createUrlBuilder(config.server) });
  });
  afterAll(() => rmSync(mediaPath, { recursive: true, force: true }));

  it('removes the bundles of imports dead for longer than the retention period, keeps the job rows', async () => {
    const old = await deadImport(randomUUID(), daysAgo(31));
    const gone = bundleKeyFor(randomUUID());
    await database.current.db
      .insertInto('jobs')
      .values({
        type: TRANSFER_IMPORT_JOB,
        status: 'dead',
        finished_at: daysAgo(40),
        payload: JSON.stringify({ importId: 'x', bundle: { driver: storage.active.driver, key: gone } }),
      })
      .execute();
    const recent = await deadImport(randomUUID(), daysAgo(2));
    const handlers = new Map(createRetentionJobHandlers(database.current.db, { days: 30, storage }));
    const run = handlers.get(RETENTION_JOB);
    const result = (await run?.({
      id: randomUUID(),
      type: RETENTION_JOB,
      payload: {},
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: null,
      checkpoint: null,
      saveCheckpoint: async () => true,
      signal: new AbortController().signal,
      log: silentLogger,
    })) as { removed: { transferBundles: number } };

    // The already-missing bundle counts too: deleting a missing object succeeds.
    expect(result.removed.transferBundles).toBe(2);
    expect(await storage.active.exists(old)).toBe(false);
    expect(await storage.active.exists(recent)).toBe(true);
    const dead = await database.current.db
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', TRANSFER_IMPORT_JOB)
      .where('status', '=', 'dead')
      .execute();
    expect(dead).toHaveLength(3);
  });
});
