import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { UsageConfig } from '../config/usage.js';
import type { Database } from '../db/index.js';
import { writeUsageBatch } from '../services/usage.js';
import { createUsageAggregator, NOOP_USAGE_TRACKER, type UsageTracker } from '../usage/aggregator.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Field usage counters for delivery reads (a no-op with USAGE_TRACKING=false). `flush` first waits for
     * the recordings `recordUsageAfterResponse` has queued.
     */
    usage: UsageTracker;
    /**
     * Records a read's usage off the response path: the task starts once the current I/O phase (which sends
     * the response) is over. Failures are logged, never surfaced to the caller.
     */
    recordUsageAfterResponse: (log: FastifyBaseLogger, task: () => Promise<void>) => void;
  }
}

/** Starts queued recordings after the response and lets `flush` and shutdown wait for them. */
const createAfterResponseQueue = () => {
  const pending = new Set<Promise<void>>();
  const run = (log: FastifyBaseLogger, task: () => Promise<void>) => {
    const started = new Promise<void>((resolve) => setImmediate(resolve))
      .then(task)
      .catch((error: unknown) => {
        log.error({ err: error }, 'recording field usage failed');
      })
      .finally(() => pending.delete(started));
    pending.add(started);
  };
  const settled = async () => {
    await Promise.all([...pending]);
  };
  return { run, settled };
};

type UsagePluginOptions = { config: UsageConfig; db: Database };

/**
 * Field usage from delivery traffic (plan developer-face §5): one in-memory aggregator per instance,
 * flushed on a timer, when it fills up, and when the app closes (so a clean shutdown loses nothing).
 */
export const usagePlugin = fp<UsagePluginOptions>(
  async (app: FastifyInstance, { config, db }) => {
    const queue = createAfterResponseQueue();
    app.decorate('recordUsageAfterResponse', queue.run);
    if (!config.enabled) {
      app.decorate('usage', NOOP_USAGE_TRACKER);
      return;
    }
    const log = app.log.child({ component: 'usage' });
    const aggregator = createUsageAggregator({
      write: (batch) => writeUsageBatch(db, batch),
      flushIntervalMs: config.flushIntervalMs,
      log,
    });
    app.decorate('usage', {
      ...aggregator,
      flush: async () => {
        await queue.settled();
        await aggregator.flush();
      },
    });
    app.addHook('onClose', async () => {
      await queue.settled();
      await aggregator.close();
    });
  },
  { name: 'shapio-usage' },
);
