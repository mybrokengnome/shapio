import type { Server as HttpsServer } from 'node:https';
import closeWithGrace from 'close-with-grace';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { buildApp } from './app.js';
import { createAssistRuntime } from './assist/runtime.js';
import type { AppConfig } from './config/index.js';
import { SHAPIO_VERSION } from './constants/version.js';
import { createContentPorts } from './content/ports.js';
import { createTransferJobHandlers } from './content/transfer/job.js';
import { createDb, type Database } from './db/index.js';
import { migrateToLatest } from './db/migrator.js';
import { assertDatabaseReachable, assertNoPendingMigrations } from './db/startupChecks.js';
import { createAppUserEmailJobHandlers } from './email/appUserJobs.js';
import { createEmailTransport } from './email/createTransport.js';
import { createAdminEmailJobHandlers } from './email/jobs.js';
import { loadProjectConfig, type LoadedProjectConfig } from './extensions/loader.js';
import { createExtensionRuntime, type ExtensionRuntime } from './extensions/runtime.js';
import { createUrlBuilder } from './helpers/publicUrl.js';
import { createAssistJobHandlers } from './jobs/assistContentOps.js';
import {
  contentHealthOutboxSubscriber,
  createContentHealthJobHandlers,
  ensureHealthSweepScheduled,
} from './jobs/contentHealth.js';
import { createJobHandlers } from './jobs/handlers/index.js';
import { createRetentionJobHandlers, ensureRetentionScheduled } from './jobs/retention.js';
import { createWorker, type Worker } from './jobs/worker.js';
import { createLogger } from './logger.js';
import { createMediaJobHandlers } from './media/jobs.js';
import { createMediaStorage } from './media/storage.js';
import { createPublishingJobEnvironment } from './publishing/jobEnvironment.js';
import { createPublishingJobHandlers, PUBLISHING_OUTBOX_SUBSCRIBERS } from './publishing/jobs.js';
import { createPublishingRuntime } from './publishing/runtime.js';
import { createSchemaJobHandlers } from './schema/planner/changeJob.js';
import { resolveSigningSecret } from './services/signingSecret.js';
import { prepareTls, type TlsRuntime } from './tls/index.js';

export type RunningServer = {
  app: FastifyInstance;
  worker: Worker | undefined;
  /** Port of the plain-HTTP listener that redirects to HTTPS (HTTP_PORT), when HTTPS is on. */
  httpPort: number | undefined;
  /** Stops the HTTP(S) servers and the worker, then closes the database pool. Idempotent. */
  close: () => Promise<void>;
};

const openDatabase = (config: AppConfig, role: string, logger: Logger): Database =>
  createDb({
    connectionString: config.database.url,
    poolMax: config.database.poolMax,
    applicationName: `shapio-${role}`,
    onIdleConnectionError: (error) =>
      logger.warn({ err: error }, 'database connection lost; it will be replaced on the next query'),
  });

/** One line an operator can read at a glance; never includes secrets or the database credentials. */
const logStartupSummary = (config: AppConfig, logger: Logger) => {
  const summary = {
    version: SHAPIO_VERSION,
    mode: config.nodeEnv,
    url: createUrlBuilder(config.server).absoluteUrl('/'),
    storage: config.storage.driver,
    worker: config.worker.mode,
    tls: config.tls.mode,
  };
  logger.info(
    summary,
    `Shapio ${summary.version} running at ${summary.url} ` +
      `(mode ${summary.mode}, storage ${summary.storage}, worker ${summary.worker}, tls ${summary.tls})`,
  );
};

export const createConfiguredWorker = (
  config: AppConfig,
  db: Database,
  logger: Logger,
  signingSecret: string,
  extensions: ExtensionRuntime,
): Worker => {
  const publishing = createPublishingJobEnvironment(
    createPublishingRuntime({
      db,
      signingSecret,
      urls: createUrlBuilder(config.server),
      config: config.publishing,
      log: logger.child({ component: 'publishing' }),
    }),
    // Scheduled and release publishes run the project's hooks exactly like API writes.
    { hooks: extensions.hooks },
  );
  const email = {
    database: db,
    urls: createUrlBuilder(config.server),
    transport: createEmailTransport(config.email, logger.child({ component: 'email' })),
  };
  const storage = createMediaStorage(config.storage, { urls: createUrlBuilder(config.server) });
  return createWorker({
    db,
    handlers: createJobHandlers([
      ...createAdminEmailJobHandlers(email),
      ...createAppUserEmailJobHandlers({ ...email, appAuth: config.appAuth }),
      ...createSchemaJobHandlers({ db, ports: createContentPorts(db) }),
      ...createMediaJobHandlers({ db, storage }),
      ...createTransferJobHandlers({ db, storage }),
      ...createPublishingJobHandlers(publishing),
      ...extensions.jobHandlers,
      ...createRetentionJobHandlers(db, {
        days: config.retention.days,
        usageDays: config.usage.retentionDays,
      }),
      ...createContentHealthJobHandlers({
        db,
        staleDays: config.health.staleDays,
        log: logger.child({ component: 'content-health' }),
      }),
      ...createAssistJobHandlers({
        environment: publishing,
        assist: createAssistRuntime(config.assist, publishing.runtime.resolve),
        storage,
      }),
    ]),
    subscribers: [
      ...PUBLISHING_OUTBOX_SUBSCRIBERS,
      contentHealthOutboxSubscriber,
      ...extensions.outboxSubscribers,
    ],
    workerId: config.instanceId,
    concurrency: config.worker.concurrency,
    pollIntervalMs: config.worker.pollIntervalMs,
    leaseMs: config.worker.leaseMs,
    log: logger.child({ component: 'worker' }),
  });
};

/**
 * The project's extensions (shapio.config) for this process: the API and its inline worker share one
 * runtime; a dedicated worker builds its own from the same config. An invalid config fails startup.
 */
export const startExtensions = async (
  config: AppConfig,
  db: Database,
  logger: Logger,
  loaded: LoadedProjectConfig,
): Promise<ExtensionRuntime> => createExtensionRuntime({ loaded, db, config, logger });

/**
 * Starts Shapio: read the project config, migrate (under an advisory lock), set up TLS (none or certificate files), build the app,
 * listen, and start the in-process worker when WORKER_MODE=inline. Installs signal handlers for a
 * graceful shutdown.
 */
export const startServer = async (config: AppConfig): Promise<RunningServer> => {
  const logger = createLogger(config);
  const db = openDatabase(config, 'api', logger);
  let tls: TlsRuntime | undefined;
  let extensions: ExtensionRuntime | undefined;
  try {
    // Before touching the database, so a broken config fails fast.
    const project = await loadProjectConfig({ configPath: config.extensions.configPath });
    await assertDatabaseReachable(db, config.database.url);
    if (config.database.migrateOnStart) {
      await migrateToLatest(db, logger.child({ component: 'migrator' }));
    } else {
      await assertNoPendingMigrations(db);
    }
    tls = await prepareTls({ config, urls: createUrlBuilder(config.server), log: logger });
    const signingSecret = await resolveSigningSecret(db, config.sessionSecret, logger);
    extensions = await startExtensions(config, db, logger, project);
    const app = await buildApp(config, {
      db,
      logger,
      signingSecret,
      extensions,
      schemaListen: config.schema.listen,
      ...(tls.initial ? { tls: tls.initial } : {}),
    });
    const worker =
      config.worker.mode === 'inline'
        ? createConfiguredWorker(config, db, logger, signingSecret, extensions)
        : undefined;

    const tlsRuntime = tls;
    const extensionRuntime = extensions;
    let closing: Promise<void> | undefined;
    const close = () => {
      closing ??= (async () => {
        // In-flight requests and running jobs drain together; the worker gives jobs SHUTDOWN_TIMEOUT_MS.
        await Promise.all([app.close(), worker?.stop(config.shutdownTimeoutMs)]);
        await tlsRuntime.close();
        extensionRuntime.close();
        await db.destroy();
        logger.info('shutdown complete');
      })();
      return closing;
    };
    // Installed before listening, so a signal during startup still shuts down cleanly.
    closeWithGrace({ delay: config.shutdownTimeoutMs + 5000 }, async ({ signal, err }) => {
      if (err) {
        logger.error({ err }, 'shutting down after an unhandled error');
      } else {
        logger.info({ signal }, 'shutting down');
      }
      await close();
    });

    await app.listen({ host: config.server.host, port: config.server.port });
    if (tls.initial) {
      tls.start(app.server as unknown as HttpsServer);
    }
    if (worker) {
      await ensureRetentionScheduled(db);
      await ensureHealthSweepScheduled(db);
      worker.start();
    }
    logStartupSummary(config, logger);
    return { app, worker, httpPort: tls.httpPort, close };
  } catch (error) {
    logger.fatal({ err: error }, 'startup failed');
    extensions?.close();
    await tls?.close();
    await db.destroy();
    throw error;
  }
};
