import { describe, expect, it } from 'vitest';
import { createDb, type Database } from '../src/db/index.js';
import { sleep } from '../src/helpers/sleep.js';
import { createSchemaRegistry } from '../src/schema/registry.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const CLOSE_LIMIT_MS = 5000;
const RELOAD_WAIT_MS = 500;

/** Resolves with 'closed', or 'timed out' when the pool is still waiting for a connection after the limit. */
const destroyWithin = async (db: Database, limitMs: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), limitMs);
  });
  try {
    return await Promise.race([db.destroy().then(() => 'closed' as const), timedOut]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Shutdown with a background schema reload in flight (a NOTIFY or the listener's first connect arrives as the
 * app closes). A reload still acquiring a pooled connection when the pool ends never returns it, so
 * `db.destroy()` waits forever; `registry.close()` must drain it first. On CI the listener's first connect
 * (password auth) lands right as a fast suite closes, which hung the database teardown.
 */
describe('schema registry shutdown', () => {
  const database = useTestDatabase();
  const newPool = () => createDb({ connectionString: database.current.url, poolMax: 2 });

  it('waits for a background reload, so the pool closes afterwards', async () => {
    const db = newPool();
    const registry = createSchemaRegistry({ db, log: silentLogger });
    // A fresh pool: the reload is still opening its connection when close() is called.
    registry.hint();
    await registry.close();
    expect(await destroyWithin(db, CLOSE_LIMIT_MS)).toBe('closed');
    expect(registry.peek()).toBeDefined();
  });

  it('ignores hints after close', async () => {
    const db = newPool();
    const registry = createSchemaRegistry({ db, log: silentLogger });
    await registry.close();
    registry.hint();
    registry.hint(1);
    // Long enough for a reload to finish had one started.
    await sleep(RELOAD_WAIT_MS);
    expect(registry.peek()).toBeUndefined();
    expect(await destroyWithin(db, CLOSE_LIMIT_MS)).toBe('closed');
  });
});
