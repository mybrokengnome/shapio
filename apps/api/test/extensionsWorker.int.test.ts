import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AFTER_HOOK_JOB } from '../src/constants/extensions.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { createHookLog, FIXTURE_CONFIG, hooksOf as hooksOfEntry } from './helpers/extensions.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const sqliteSkip = dialectSkipReason(import.meta.url);

const LEASE_MS = 1500;

/** Package K: hooks in the dedicated worker (`shapio worker`), and after* hooks across a worker crash. */
describe.skipIf(sqliteSkip)(
  withSkipReason('extension hooks in the dedicated worker (child processes)', sqliteSkip),
  { timeout: 60_000 },
  () => {
    const database = useTestDatabase();
    const children: SpawnedProcess[] = [];
    let testApp: TestApp;
    let admin: SchemaClient;

    const startWorker = (workerId: string, hangAt?: 'afterCommit') => {
      const child = spawnTsProcess('test/fixtures/extensionWorker.ts', {
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        DATABASE_URL: database.current.url,
        SHAPIO_CONFIG_PATH: FIXTURE_CONFIG,
        WORKER_MODE: 'dedicated',
        INSTANCE_ID: workerId,
        JOB_LEASE_MS: String(LEASE_MS),
        WORKER_POLL_INTERVAL_MS: '50',
        ...(hangAt ? { HANG_AT: hangAt } : {}),
      });
      children.push(child);
      return child;
    };

    const hooksOf = (entryId: string) => hooksOfEntry(database.current.db, entryId);

    beforeAll(async () => {
      await createHookLog(database.current.db);
      // The API without a worker (WORKER_MODE=dedicated): jobs only run in the child processes.
      testApp = await createTestApp(database.current, {
        schemaListen: false,
        env: { SHAPIO_CONFIG_PATH: FIXTURE_CONFIG, WORKER_MODE: 'dedicated' },
      });
      admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      });
    });

    afterAll(async () => {
      await Promise.all(children.map((child) => child.stop('SIGKILL')));
      await testApp.app.close();
    });

    it('runs an after* hook exactly once when its worker dies after the hook committed', async () => {
      const { db } = database.current;
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Crash' } }),
        201,
      ).json<EntryBody>();

      // Worker A runs the hook (committed), then hangs before marking the job done; kill it without cleanup.
      const workerA = startWorker('worker-a', 'afterCommit');
      await workerA.waitForLog(
        (line) => line.msg === 'after hook committed; hanging before the job is marked succeeded',
        { description: "worker A's 'after hook committed; hanging …'" },
      );
      expect(await workerA.stop('SIGKILL')).toBeNull();
      const job = await db
        .selectFrom('jobs')
        .selectAll()
        .where('type', '=', AFTER_HOOK_JOB)
        .executeTakeFirstOrThrow();
      expect(job).toMatchObject({ status: 'running', locked_by: 'worker-a' });
      expect(await hooksOf(entry.id)).toEqual(['article.beforeCreate', 'article.afterCreate']);

      // Worker B (`shapio worker`) reclaims the job when the lease expires; the hook sees it already ran.
      startWorker('worker-b');
      const done = await waitFor(
        async () => {
          const row = await jobsRepository.findById(job.id, db);
          // Terminal state only: a dead job fails the assertion below instead of timing out here.
          return row?.status === 'succeeded' || row?.status === 'dead' ? row : undefined;
        },
        {
          timeoutMs: 30_000,
          description: `job ${job.id} to finish on worker B after worker A's lease expired`,
        },
      );
      expect(done).toMatchObject({ status: 'succeeded', attempts: 2, result: { skipped: 'already ran' } });
      expect(await hooksOf(entry.id)).toEqual(['article.beforeCreate', 'article.afterCreate']);
    });

    it('runs before* and after* publish hooks for a scheduled publish in the dedicated worker', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Scheduled' } }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.post('/api/admin/publishing/schedules', {
          modelKey: 'article',
          entryId: entry.id,
          action: 'publish',
          runAt: new Date(Date.now() + 500).toISOString(),
        }),
        201,
      );
      await waitFor(async () => (await hooksOf(entry.id)).includes('article.afterPublish'), {
        timeoutMs: 30_000,
        description: 'the dedicated worker to run the scheduled publish and its afterPublish hook',
      });
      const rows = await sql<{ hook: string; principal: string }>`
      select hook, principal from ext_hook_log where entry_id = ${entry.id} and hook like '%Publish' order by id
    `.execute(database.current.db);
      expect(rows.rows).toEqual([
        { hook: 'article.beforePublish', principal: 'token' },
        { hook: 'article.afterPublish', principal: 'token' },
      ]);
    });
  },
);
