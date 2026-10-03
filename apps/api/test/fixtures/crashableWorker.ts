// Child-process worker for the crash test. Handler `test.recordThenHang` records an idempotent effect,
// logs it, then hangs, so the test can SIGKILL the process mid-job.
import { sql } from 'kysely';
import { pino } from 'pino';
import { createDb } from '../../src/db/index.js';
import { isUniqueViolation } from '../../src/db/sql/errors.js';
import { sleep } from '../../src/helpers/sleep.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker } from '../../src/jobs/worker.js';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const db = createDb({ connectionString: env('DATABASE_URL'), poolMax: 4 });
const log = pino({ level: 'info' });
const hangMs = Number(env('HANG_MS'));

const handlers = createJobHandlers([
  [
    'test.recordThenHang',
    async (context) => {
      // Idempotent: a second attempt finds the effect already recorded.
      try {
        await sql`insert into test_effects (job_id) values (${context.id})`.execute(db);
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
      context.log.info({ attempt: context.attempt }, 'effect recorded');
      await sleep(hangMs, context.signal);
      return { attempt: context.attempt };
    },
  ],
]);

const worker = createWorker({
  db,
  handlers,
  workerId: env('WORKER_ID'),
  concurrency: 1,
  pollIntervalMs: 50,
  leaseMs: Number(env('LEASE_MS')),
  log,
});
worker.start();
log.info('worker ready');
