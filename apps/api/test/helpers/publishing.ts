import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { Logger } from 'pino';
import { buildApp } from '../../src/app.js';
import type { ContentHooks } from '../../src/content/hooks.js';
import type { Database } from '../../src/db/index.js';
import { createUrlBuilder } from '../../src/helpers/publicUrl.js';
import { createJobHandlers } from '../../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../../src/jobs/worker.js';
import { createPublishingJobEnvironment } from '../../src/publishing/jobEnvironment.js';
import { createPublishingJobHandlers, PUBLISHING_OUTBOX_SUBSCRIBERS } from '../../src/publishing/jobs.js';
import type { HostResolver } from '../../src/publishing/outbound/ssrf.js';
import { createPublishingRuntime } from '../../src/publishing/runtime.js';
import { testConfig, type TestApp } from './createTestApp.js';
import { principalFactory } from './principalFactory.js';
import { silentLogger } from './silentLogger.js';
import type { TestDatabase } from './testDatabase.js';
import { waitFor } from './waitFor.js';

/** Hosts tests may make resolve anywhere (e.g. a public-looking name resolving to a private address). */
export type FakeDns = { resolver: HostResolver; set: (host: string, address: string) => void };

export const createFakeDns = (): FakeDns => {
  const table = new Map<string, string>();
  return {
    set: (host, address) => table.set(host, address),
    resolver: async (host) => {
      const address = table.get(host) ?? (host === 'localhost' ? '127.0.0.1' : undefined);
      if (!address) {
        throw new Error(`ENOTFOUND ${host}`);
      }
      return [{ address, family: address.includes(':') ? 6 : 4 }];
    },
  };
};

/** Lets tests reach local receivers: 127.0.0.1 is allowlisted (targets must still opt in). */
export const PUBLISHING_TEST_ENV = { OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: '127.0.0.1/32' };

export const createPublishingTestApp = async (
  database: TestDatabase,
  {
    env = {},
    dns = createFakeDns(),
    logger,
  }: { env?: Record<string, string>; dns?: FakeDns; logger?: FastifyBaseLogger } = {},
): Promise<TestApp & { dns: FakeDns }> => {
  const config = testConfig(database, { ...PUBLISHING_TEST_ENV, ...env });
  const app = await buildApp(config, {
    db: database.db,
    adminDistPath: null,
    schemaListen: false,
    outboundResolver: dns.resolver,
    ...(logger ? { logger } : {}),
  });
  await app.ready();
  return { app, db: database.db, config, principalFactory, dns };
};

type PublishingWorkerOptions = {
  db: Database;
  app: TestApp['app'];
  dns?: FakeDns;
  hooks?: ContentHooks;
  now?: () => Date;
  pollIntervalMs?: number;
  /** Defaults to a silent logger. */
  log?: Logger;
};

/** A worker with the publishing handlers and outbox subscribers (the same set `shapio start` runs). */
export const createPublishingWorker = ({
  db,
  app,
  dns,
  hooks,
  now,
  pollIntervalMs,
  log = silentLogger,
}: PublishingWorkerOptions): Worker => {
  const runtime = createPublishingRuntime({
    db,
    signingSecret: app.signingSecret,
    urls: createUrlBuilder(app.config.server),
    config: app.config.publishing,
    log,
    ...(dns ? { resolve: dns.resolver } : {}),
    ...(now ? { now } : {}),
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
  });
  return createWorker({
    db,
    handlers: createJobHandlers(
      createPublishingJobHandlers(createPublishingJobEnvironment(runtime, hooks ? { hooks } : {})),
    ),
    subscribers: PUBLISHING_OUTBOX_SUBSCRIBERS,
    workerId: `test-${randomUUID()}`,
    concurrency: 4,
    pollIntervalMs: 20,
    leaseMs: 10_000,
    log,
    ...(now ? { now } : {}),
  });
};

/** Ticks the worker (relay + claims) until no runnable job of `types` is left and nothing is running. */
export const drainJobs = async (
  worker: Worker,
  db: Database,
  {
    types,
    now = () => new Date(),
    timeoutMs = 15_000,
  }: { types: string[]; now?: () => Date; timeoutMs?: number },
) => {
  await waitFor(
    async () => {
      await worker.tick();
      await waitFor(async () => worker.runningJobIds.size === 0, { timeoutMs });
      const open = await db
        .selectFrom('jobs')
        .select('id')
        .where('type', 'in', types)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'running'),
            eb.and([eb('status', '=', 'pending'), eb('run_at', '<=', now())]),
          ]),
        )
        .execute();
      const undispatched = await db
        .selectFrom('outbox_events')
        .select('id')
        .where('dispatched_at', 'is', null)
        .where('dispatch_attempts', '<', 10)
        .execute();
      return open.length === 0 && undispatched.length === 0;
    },
    { timeoutMs },
  );
};

export type ReceivedRequest = { method: string; path: string; headers: IncomingHttpHeaders; body: string };

export type Receiver = {
  url: string;
  port: number;
  requests: ReceivedRequest[];
  /** The status (and body) the next requests get; defaults to 200. */
  respondWith: (
    handler: (request: ReceivedRequest) => {
      status: number;
      body?: string;
      headers?: Record<string, string>;
    },
  ) => void;
  close: () => Promise<void>;
};

/** A local HTTP server that records requests, standing in for a site, a build hook or a provider API. */
export const startReceiver = async (): Promise<Receiver> => {
  const requests: ReceivedRequest[] = [];
  let handler: Parameters<Receiver['respondWith']>[0] = () => ({ status: 200, body: '{}' });
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const received = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(received);
      const reply = handler(received);
      res.writeHead(reply.status, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.body ?? '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    respondWith: (next) => {
      handler = next;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

/** A clock tests move forward to make delayed jobs (debounce, backoff, schedules) due at once. */
export const createTestClock = (start = new Date()) => {
  let offsetMs = 0;
  return {
    now: () => new Date(start.getTime() + offsetMs + (Date.now() - start.getTime())),
    advance: (ms: number) => {
      offsetMs += ms;
    },
  };
};
