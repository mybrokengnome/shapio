// Child-process worker for the "deployments under a worker crash" tests: the publishing handlers and outbox
// subscribers (deployment triggers included), with 127.0.0.1 allowlisted so a local build endpoint is reachable.
// The test SIGKILLs it while a deployment trigger is in flight.
import { pino } from 'pino';
import { loadConfig } from '../../src/config/index.js';
import { createDb } from '../../src/db/index.js';
import { createUrlBuilder } from '../../src/helpers/publicUrl.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
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

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: env('DATABASE_URL'),
  LOG_LEVEL: 'info',
  OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: '127.0.0.1/32',
});
const db = createDb({ connectionString: config.database.url, poolMax: 4 });
const log = pino({ level: 'info' });

const runtime = createPublishingRuntime({
  db,
  signingSecret: env('SIGNING_SECRET'),
  urls: createUrlBuilder(config.server),
  config: config.publishing,
  log,
});

const worker = createWorker({
  db,
  handlers: createJobHandlers(createPublishingJobHandlers(createPublishingJobEnvironment(runtime))),
  subscribers: PUBLISHING_OUTBOX_SUBSCRIBERS,
  workerId: env('WORKER_ID'),
  concurrency: 1,
  pollIntervalMs: 50,
  leaseMs: Number(env('LEASE_MS')),
  log,
});
worker.start();
log.info('worker ready');
