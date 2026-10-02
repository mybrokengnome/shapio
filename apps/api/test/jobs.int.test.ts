import { afterEach, describe, expect, it } from 'vitest';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { enqueueJob } from '../src/jobs/queue.js';
import { PermanentJobError, type JobHandler } from '../src/jobs/types.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

describe('job queue and worker', () => {
  const database = useTestDatabase();
  const workers: Worker[] = [];

  const makeWorker = (
    handlers: Record<string, JobHandler>,
    overrides: { workerId?: string; leaseMs?: number } = {},
  ) => {
    const worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers(Object.entries(handlers)),
      workerId: overrides.workerId ?? `w-${workers.length}`,
      concurrency: 4,
      pollIntervalMs: 20,
      leaseMs: overrides.leaseMs ?? 30_000,
      log: silentLogger,
    });
    workers.push(worker);
    return worker;
  };

  const findJob = (id: string) => jobsRepository.findById(id, database.current.db);
  const settled = (id: string) =>
    waitFor(async () => {
      const job = await findJob(id);
      return job && ['succeeded', 'dead'].includes(job.status) ? job : undefined;
    });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.stop(1000)));
    await database.current.db.deleteFrom('jobs').execute();
  });

  it('runs a job once and stores its result', async () => {
    const { job } = await enqueueJob({ type: 'test.echo', payload: { n: 7 } }, database.current.db);
    makeWorker({ 'test.echo': async ({ payload }) => payload }).start();

    const done = await settled(job.id);
    expect(done).toMatchObject({ status: 'succeeded', attempts: 1, result: { n: 7 }, locked_by: null });
  });

  it('deduplicates enqueues that share an idempotency key', async () => {
    const first = await enqueueJob(
      { type: 'test.echo', idempotencyKey: 'publish:entry-1:rev-9' },
      database.current.db,
    );
    const second = await enqueueJob(
      { type: 'test.echo', idempotencyKey: 'publish:entry-1:rev-9' },
      database.current.db,
    );
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, job: { id: first.job.id } });
  });

  it('enqueued jobs exist only if the surrounding transaction commits', async () => {
    const { db } = database.current;
    await expect(
      db.transaction().execute(async (trx) => {
        await enqueueJob({ type: 'test.echo', idempotencyKey: 'rolled-back' }, trx);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await jobsRepository.findByIdempotencyKey('rolled-back', db)).toBeUndefined();
  });

  it('gives concurrent claimers disjoint jobs (SKIP LOCKED)', async () => {
    const { db } = database.current;
    for (let i = 0; i < 20; i += 1) {
      await enqueueJob({ type: 'test.echo' }, db);
    }
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + 60_000);
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db
          .transaction()
          .execute((trx) =>
            jobsRepository.claimRunnable({ workerId: `c${i}`, limit: 6, now, leaseUntil }, trx),
          ),
      ),
    );
    const ids = claims.flat().map((job) => job.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('retries a failing job later with backoff, recording the error', async () => {
    const { job } = await enqueueJob({ type: 'test.flaky' }, database.current.db);
    const worker = makeWorker({
      'test.flaky': async () => {
        throw new Error('upstream 502');
      },
    });
    const before = Date.now();
    await worker.tick();
    const retried = await waitFor(async () => {
      const row = await findJob(job.id);
      return row?.status === 'pending' && row.attempts === 1 ? row : undefined;
    });
    expect(retried.last_error).toContain('upstream 502');
    expect(new Date(retried.run_at).getTime()).toBeGreaterThan(before);
  });

  it('marks a job dead after max attempts, on a PermanentJobError, or with no handler', async () => {
    const { db } = database.current;
    const exhausted = await enqueueJob({ type: 'test.alwaysFails', maxAttempts: 1 }, db);
    const permanent = await enqueueJob({ type: 'test.permanent' }, db);
    const unknown = await enqueueJob({ type: 'test.noSuchHandler' }, db);
    makeWorker({
      'test.alwaysFails': async () => {
        throw new Error('nope');
      },
      'test.permanent': async () => {
        throw new PermanentJobError('payload is invalid');
      },
    }).start();

    expect(await settled(exhausted.job.id)).toMatchObject({ status: 'dead', attempts: 1 });
    expect(await settled(permanent.job.id)).toMatchObject({
      status: 'dead',
      last_error: expect.stringContaining('payload is invalid') as unknown,
    });
    expect(await settled(unknown.job.id)).toMatchObject({
      status: 'dead',
      last_error: expect.stringContaining('No handler') as unknown,
    });
  });

  it('reclaims a job whose lease expired and fences out the presumed-dead worker', async () => {
    const { db } = database.current;
    const past = new Date(Date.now() - 120_000);
    const { job } = await enqueueJob({ type: 'test.echo', runAt: past }, db);
    // A worker claims the job and then goes silent (no heartbeat): simulate with a direct claim in the past.
    const [claimed] = await jobsRepository.claimRunnable(
      { workerId: 'ghost', limit: 1, now: past, leaseUntil: new Date(past.getTime() + 1000) },
      db,
    );
    expect(claimed?.id).toBe(job.id);

    makeWorker({ 'test.echo': async () => 'ok' }, { workerId: 'rescuer' }).start();
    const done = await settled(job.id);
    expect(done).toMatchObject({ status: 'succeeded', attempts: 2 });

    // The ghost wakes up and tries to report: its write must not apply.
    expect(
      await jobsRepository.markSucceeded({ id: job.id, workerId: 'ghost' }, 'late', new Date(), db),
    ).toBe(false);
    expect((await findJob(job.id))?.result).toBe('ok');
  });

  it('persists checkpoints so a retried attempt resumes', async () => {
    const { job } = await enqueueJob({ type: 'test.resumable', maxAttempts: 3 }, database.current.db);
    const seen: unknown[] = [];
    const worker = makeWorker({
      'test.resumable': async (context) => {
        seen.push(context.checkpoint);
        if (context.attempt === 1) {
          await context.saveCheckpoint({ processed: 500 });
          throw new Error('interrupted');
        }
        return { resumedFrom: context.checkpoint };
      },
    });
    await worker.tick();
    await waitFor(async () => (await findJob(job.id))?.status === 'pending');
    await database.current.db
      .updateTable('jobs')
      .set({ run_at: new Date() })
      .where('id', '=', job.id)
      .execute();
    worker.start();

    expect(await settled(job.id)).toMatchObject({
      status: 'succeeded',
      result: { resumedFrom: { processed: 500 } },
    });
    expect(seen).toEqual([null, { processed: 500 }]);
  });

  it('releases unfinished jobs on shutdown without counting the attempt', async () => {
    const { job } = await enqueueJob({ type: 'test.slow' }, database.current.db);
    const worker = makeWorker({
      'test.slow': (context) =>
        new Promise((resolve) => {
          context.signal.addEventListener('abort', () => resolve('aborted'));
        }),
    });
    await worker.tick();
    await waitFor(async () => (await findJob(job.id))?.status === 'running');
    await worker.stop(100);
    workers.splice(workers.indexOf(worker), 1);

    expect(await findJob(job.id)).toMatchObject({ status: 'pending', attempts: 0, locked_by: null });
  });
});
