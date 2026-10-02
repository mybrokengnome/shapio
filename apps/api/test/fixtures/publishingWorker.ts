// Child-process worker for the "scheduled publish fires exactly once across a worker restart" tests.
// HANG_AT=beforeCommit: an afterPublish hook (inside the publishing transaction) logs and hangs, so a
// SIGKILL rolls the publish back. HANG_AT=afterCommit: the handler finishes (committed) and the process then
// hangs before the job is marked succeeded, so the job is reclaimed and re-run after a SIGKILL.
import { pino } from 'pino';
import { loadConfig } from '../../src/config/index.js';
import { createContentHooks } from '../../src/content/hooks.js';
import { createDb } from '../../src/db/index.js';
import { createUrlBuilder } from '../../src/helpers/publicUrl.js';
import { sleep } from '../../src/helpers/sleep.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import type { JobHandler } from '../../src/jobs/types.js';
import { createWorker } from '../../src/jobs/worker.js';
import { createPublishingJobEnvironment } from '../../src/publishing/jobEnvironment.js';
import { createPublishingJobHandlers, PUBLISHING_OUTBOX_SUBSCRIBERS } from '../../src/publishing/jobs.js';
import { createPublishingRuntime } from '../../src/publishing/runtime.js';

const env = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: env('DATABASE_URL'), LOG_LEVEL: 'info' });
const db = createDb({ connectionString: config.database.url, poolMax: 4 });
const log = pino({ level: 'info' });
const hangAt = process.env.HANG_AT ?? 'never';

const hooks = createContentHooks();
if (hangAt === 'beforeCommit') {
  hooks.on('afterPublish', async () => {
    log.info('published inside the transaction; hanging before commit');
    await sleep(60_000);
  });
}

const runtime = createPublishingRuntime({
  db,
  signingSecret: env('SIGNING_SECRET'),
  urls: createUrlBuilder(config.server),
  config: config.publishing,
  log,
});
const handlers = createPublishingJobHandlers(createPublishingJobEnvironment(runtime, { hooks })).map(
  ([type, handler]): [string, JobHandler] => [
    type,
    async (context) => {
      const result = await handler(context);
      if (hangAt === 'afterCommit') {
        log.info({ result }, 'handler finished; hanging before the job is marked succeeded');
        await sleep(60_000);
      }
      return result;
    },
  ],
);

const worker = createWorker({
  db,
  handlers: createJobHandlers(handlers),
  subscribers: PUBLISHING_OUTBOX_SUBSCRIBERS,
  workerId: env('WORKER_ID'),
  concurrency: 1,
  pollIntervalMs: 50,
  leaseMs: Number(env('LEASE_MS')),
  log,
});
worker.start();
log.info('worker ready');
