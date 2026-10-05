import closeWithGrace from 'close-with-grace';
import type { AppConfig } from './config/index.js';
import { createDb } from './db/index.js';
import { getPendingMigrations } from './db/migrator.js';
import { assertDatabaseReachable } from './db/startupChecks.js';
import { loadProjectConfig } from './extensions/loader.js';
import { ensureHealthSweepScheduled } from './jobs/contentHealth.js';
import { ensureRetentionScheduled } from './jobs/retention.js';
import { createLogger } from './logger.js';
import { createConfiguredWorker, startExtensions } from './server.js';
import { resolveSigningSecret } from './services/signingSecret.js';

/**
 * Runs the job worker as its own process (WORKER_MODE=dedicated on the API, `shapio worker` here).
 * It never migrates: it refuses to start until the API has brought the schema up to date.
 */
export const startDedicatedWorker = async (config: AppConfig) => {
  const logger = createLogger(config);
  // Same project config as the API, so hooks and jobs behave identically in a dedicated worker.
  const project = await loadProjectConfig({ configPath: config.extensions.configPath });
  const db = createDb({
    connectionString: config.database.url,
    poolMax: Math.max(2, config.worker.concurrency + 1),
    acquireTimeoutMs: config.database.acquireTimeoutMs,
    applicationName: 'shapio-worker',
    onIdleConnectionError: (error) =>
      logger.warn({ err: error }, 'database connection lost; it will be replaced on the next query'),
  });
  try {
    await assertDatabaseReachable(db, config.database.url);
  } catch (error) {
    await db.destroy();
    throw error;
  }
  const pending = await getPendingMigrations(db);
  if (pending.length > 0) {
    logger.fatal(
      { pending },
      'database migrations are pending; start the API (or run `shapio migrate`) first',
    );
    await db.destroy();
    throw new Error('Pending migrations');
  }
  const signingSecret = await resolveSigningSecret(db, config.sessionSecret, logger);
  const extensions = await startExtensions(config, db, logger, project);
  const worker = await createConfiguredWorker(config, db, logger, signingSecret, extensions);
  await ensureRetentionScheduled(db);
  await ensureHealthSweepScheduled(db);
  worker.start();
  closeWithGrace({ delay: config.shutdownTimeoutMs + 5000 }, async ({ signal, err }) => {
    if (err) {
      logger.error({ err }, 'worker shutting down after an unhandled error');
    } else {
      logger.info({ signal }, 'worker shutting down');
    }
    await worker.stop(config.shutdownTimeoutMs);
    extensions.close();
    await db.destroy();
  });
  return worker;
};
