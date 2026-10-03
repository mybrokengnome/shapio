import { describe, expect, it } from 'vitest';
import { getPendingMigrations } from '../src/db/migrator.js';
import { spawnServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

/** Up to the server answering /api/ready (cold tsx start + every migration), on a slow CI runner. */
const READY_TIMEOUT_MS = 30_000;

describe('server process', () => {
  const database = useTestDatabase({ empty: true });

  it('migrates an empty database on start, serves /api/ready, and exits cleanly on SIGTERM', async () => {
    expect(await getPendingMigrations(database.current.db), 'pending migrations before start').not.toEqual(
      [],
    );

    const server = await spawnServer({ DATABASE_URL: database.current.url });
    try {
      const ready = await waitFor(
        async () => {
          const response = await fetch(`${server.url}/api/ready`).catch(() => undefined);
          return response?.status === 200 ? response : undefined;
        },
        {
          timeoutMs: READY_TIMEOUT_MS,
          description: `the server to answer /api/ready with 200 (${server.url})`,
        },
      );
      expect(await ready.json()).toMatchObject({ status: 'ready' });
      // Read after the server says ready: every migration was applied by the server itself.
      expect(await getPendingMigrations(database.current.db), 'pending migrations once ready').toEqual([]);
      // The inline worker starts after the listener does, so wait for its line rather than expect it already.
      await server.waitForLog((line) => line.msg === 'worker started', {
        description: "'worker started' (the inline worker never started)",
      });
    } finally {
      // stop() resolves once the process exited and its output is drained (it rejects after 15 s).
      expect(await server.stop('SIGTERM'), 'exit code after SIGTERM').toBe(0);
    }
    expect(
      server.logs.map((line) => line.msg),
      "the server's log ends its shutdown with 'shutdown complete'",
    ).toContain('shutdown complete');
  }, 60_000);

  it('refuses to start with invalid configuration', async () => {
    const server = spawnServer({ DATABASE_URL: database.current.url, PORT: 'not-a-port' });
    await expect(server).rejects.toThrow(/exited with code 1/);
  });
});
