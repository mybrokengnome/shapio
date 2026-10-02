import { randomBytes, randomInt } from 'node:crypto';
import { join } from 'node:path';

/**
 * Every run gets its own ID, port, database and artifacts directory, so several runs (two implementers,
 * or CI shards) can share a machine. The ID and port are stored in the environment the first time this
 * module loads (the Playwright runner, via playwright.config.ts), so the worker processes it starts reuse
 * them. SHAPIO_E2E_RUN_ID, SHAPIO_E2E_PORT and SHAPIO_E2E_ARTIFACTS override them.
 */
process.env.SHAPIO_E2E_RUN_ID ??= `shapio-e2e-${process.pid}-${randomBytes(3).toString('hex')}`;
process.env.SHAPIO_E2E_PORT ??= String(randomInt(20_000, 40_000));

export const RUN_ID = process.env.SHAPIO_E2E_RUN_ID;
export const E2E_PORT = Number(process.env.SHAPIO_E2E_PORT);
/** The suite runs under a sub-path to prove BASE_PATH hosting works end to end. */
export const E2E_BASE_PATH = '/cms';
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
export const ADMIN_URL = `${E2E_ORIGIN}${E2E_BASE_PATH}/admin/`;
/** This run's test database (created by global setup, dropped by global teardown). */
export const E2E_DATABASE = RUN_ID.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();

const ARTIFACTS_ROOT = join(import.meta.dirname, '..', '.artifacts');
/** An explicit directory is the caller's: it is never cleared or removed. */
export const ARTIFACTS_OVERRIDDEN = process.env.SHAPIO_E2E_ARTIFACTS !== undefined;
/** Server log, state and media for this run; removed by global teardown unless overridden or kept. */
export const ARTIFACTS_DIR = process.env.SHAPIO_E2E_ARTIFACTS ?? join(ARTIFACTS_ROOT, RUN_ID);
/** SHAPIO_E2E_KEEP_ARTIFACTS=1 keeps the run's directory (server log, media) for debugging. */
export const KEEP_ARTIFACTS = process.env.SHAPIO_E2E_KEEP_ARTIFACTS === '1';
export const SERVER_LOG = join(ARTIFACTS_DIR, 'server.log');
export const SERVER_STATE = join(ARTIFACTS_DIR, 'server.json');
/** Screenshots outlive the run (named by screen), unless SHAPIO_E2E_SCREENSHOTS points elsewhere. */
export const SCREENSHOT_DIR = process.env.SHAPIO_E2E_SCREENSHOTS ?? join(ARTIFACTS_ROOT, 'screenshots');
