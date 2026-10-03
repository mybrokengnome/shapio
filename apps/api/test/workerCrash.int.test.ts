import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueJob } from '../src/jobs/queue.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import { testColumnTypes } from './helpers/dialect.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const LEASE_MS = 1500;

describe('worker crash recovery (child processes)', () => {
  const database = useTestDatabase();
  const children: SpawnedProcess[] = [];

  const startWorker = (workerId: string, hangMs: number) => {
    const child = spawnTsProcess('test/fixtures/crashableWorker.ts', {
      DATABASE_URL: database.current.url,
      WORKER_ID: workerId,
      LEASE_MS: String(LEASE_MS),
      HANG_MS: String(hangMs),
    });
    children.push(child);
    return child;
  };

  afterAll(async () => {
    await Promise.all(children.map((child) => child.stop('SIGKILL')));
  });

  it("reclaims a killed worker's job and completes it once logically", async () => {
    const { db } = database.current;
    await sql`create table test_effects (job_id ${testColumnTypes().uuid} primary key)`.execute(db);
    const { job } = await enqueueJob({ type: 'test.recordThenHang', maxAttempts: 3 }, db);

    // Worker A records the effect, then hangs; kill it mid-job with SIGKILL (no cleanup runs).
    const workerA = startWorker('worker-a', 60_000);
    await workerA.waitForLog((line) => line.msg === 'effect recorded');
    expect(await workerA.stop('SIGKILL')).toBeNull();
    expect(await jobsRepository.findById(job.id, db)).toMatchObject({
      status: 'running',
      locked_by: 'worker-a',
    });

    // Worker B picks it up once the lease expires and finishes it.
    startWorker('worker-b', 0);
    const done = await waitFor(
      async () => {
        const row = await jobsRepository.findById(job.id, db);
        return row?.status === 'succeeded' ? row : undefined;
      },
      { timeoutMs: 20_000 },
    );

    expect(done).toMatchObject({ attempts: 2, result: { attempt: 2 }, locked_by: null });
    const effects = await sql<{ job_id: string }>`select job_id from test_effects`.execute(db);
    expect(effects.rows).toEqual([{ job_id: job.id }]);
  });
});
