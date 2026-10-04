// Test project for the operations tests: a slow route and a slow job, so a test can send SIGTERM while a
// request and a job are in flight and check that both finish before the process exits.
import { defineConfig } from '@shapio/cms/config';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const durationFrom = (value: unknown): number => {
  const ms = Number(value);
  return Number.isInteger(ms) && ms >= 0 && ms <= 10_000 ? ms : 0;
};

export const config = defineConfig({
  routes: [
    {
      prefix: 'ops',
      plugin: async (app) => {
        app.get<{ Querystring: { ms?: string } }>('/slow', async (request) => {
          request.log.info('slow request started');
          await pause(durationFrom(request.query.ms));
          return { done: true };
        });
      },
    },
  ],
  jobs: {
    // Deliberately ignores the abort signal: shutdown must wait for it, within SHUTDOWN_TIMEOUT_MS.
    slow: async ({ payload, logger }) => {
      logger.info('slow job started');
      await pause(durationFrom(payload.ms));
      return { done: true };
    },
  },
});
