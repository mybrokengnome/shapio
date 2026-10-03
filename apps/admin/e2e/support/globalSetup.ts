import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import {
  ARTIFACTS_DIR,
  E2E_BASE_PATH,
  E2E_DATABASE,
  E2E_ORIGIN,
  E2E_PORT,
  SERVER_LOG,
  SERVER_STATE,
} from './constants';
import { waitForLog } from './serverLog';
import { createDatabase, databaseUrlOf } from './testDatabases';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const API_DIR = join(REPO_ROOT, 'apps', 'api');

const isPortFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });

/**
 * Creates a fresh database, starts the API from source with the built admin under BASE_PATH, and waits
 * until it listens. The server's log is the e2e suite's mailbox (console email).
 */
// eslint-disable-next-line import-x/no-default-export -- Playwright loads globalSetup/globalTeardown as default exports
export default async function globalSetup() {
  if (!(await isPortFree(E2E_PORT))) {
    throw new Error(`e2e port ${E2E_PORT} is in use; set SHAPIO_E2E_PORT to a free port`);
  }
  // Only this run's own directory, which is new; a caller-chosen SHAPIO_E2E_ARTIFACTS is left as it is.
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const database = E2E_DATABASE;
  await createDatabase(database);

  const log = createWriteStream(SERVER_LOG);
  const server = spawn(process.execPath, ['--conditions=@shapio/source', '--import', 'tsx', 'src/main.ts'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(E2E_PORT),
      BASE_PATH: E2E_BASE_PATH,
      PUBLIC_URL: E2E_ORIGIN,
      DATABASE_URL: databaseUrlOf(database),
      MIGRATE_ON_START: 'true',
      LOG_LEVEL: 'info',
      LOG_PRETTY: 'false',
      RATE_LIMIT_MAX: '5000',
      EMAIL_TRANSPORT: 'console',
      // App users (package I): confirmation emails link to the user's site; console email logs them.
      APP_AUTH_CONFIRM_EMAIL_URL: 'https://site.example.com/confirm-email',
      MEDIA_PATH: join(ARTIFACTS_DIR, 'media'),
      // publishing.spec.ts runs its webhook and build receivers on loopback; webhooks opt in per hook.
      OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: '127.0.0.1/32',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  writeFileSync(SERVER_STATE, JSON.stringify({ pid: server.pid, database }));
  server.unref();

  await waitForLog(/Server listening/, 60_000);
}
