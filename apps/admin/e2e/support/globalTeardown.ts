import { readFileSync, rmSync } from 'node:fs';
import pg from 'pg';
import { ARTIFACTS_DIR, ARTIFACTS_OVERRIDDEN, KEEP_ARTIFACTS, SERVER_STATE } from './constants';

type ServerState = { pid: number; database: string; maintenanceUrl: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// eslint-disable-next-line import-x/no-default-export -- Playwright loads globalSetup/globalTeardown as default exports
export default async function globalTeardown() {
  const state = JSON.parse(readFileSync(SERVER_STATE, 'utf8')) as ServerState;
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
  await sleep(1500);
  const client = new pg.Client({ connectionString: state.maintenanceUrl });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(state.database)} WITH (FORCE)`);
  await client.end();
  // This run's own directory only (never a caller-chosen one, never the shared screenshots).
  if (!ARTIFACTS_OVERRIDDEN && !KEEP_ARTIFACTS) {
    rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  }
}
