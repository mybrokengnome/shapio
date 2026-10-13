import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
// Fixes this run's ID and port in the environment before workers start, so they all agree.
import './e2e/support/constants';
import { shardFilter } from './e2e/support/shards';

const TEST_DIR = join(import.meta.dirname, 'e2e');

/**
 * End-to-end tests against the real API (apps/api run from source) with the production admin build, under
 * a BASE_PATH, on a fresh database per run. Build the admin first: `pnpm --filter @shapio/admin build`.
 * See e2e/support/globalSetup.ts for the environment it needs. Each run has its own port, database and
 * artifacts directory (e2e/support/constants.ts), so runs can go in parallel. CI splits the suite into shards
 * with SHAPIO_E2E_SHARD (e2e/support/shards.ts).
 */
export default defineConfig({
  testDir: TEST_DIR,
  ...shardFilter(TEST_DIR, process.env.SHAPIO_E2E_SHARD),
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/support/globalSetup.ts',
  globalTeardown: './e2e/support/globalTeardown.ts',
  use: {
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1360, height: 900 },
  },
});
