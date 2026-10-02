import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { UsageConfig } from '../config/usage.js';
import type { Database } from '../db/index.js';
import { writeUsageBatch } from '../services/usage.js';
import { createUsageAggregator, NOOP_USAGE_TRACKER, type UsageTracker } from '../usage/aggregator.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Field usage counters for delivery reads (a no-op with USAGE_TRACKING=false). */
    usage: UsageTracker;
  }
}

type UsagePluginOptions = { config: UsageConfig; db: Database };

/**
 * Field usage from delivery traffic (plan developer-face §5): one in-memory aggregator per instance,
 * flushed on a timer, when it fills up, and when the app closes (so a clean shutdown loses nothing).
 */
export const usagePlugin = fp<UsagePluginOptions>(
  async (app: FastifyInstance, { config, db }) => {
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
    app.decorate('usage', aggregator);
    app.addHook('onClose', async () => {
      await aggregator.close();
    });
  },
  { name: 'shapio-usage' },
);
