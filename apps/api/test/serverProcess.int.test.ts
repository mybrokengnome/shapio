import { describe, expect, it } from 'vitest';
import { spawnServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('server process', () => {
  const database = useTestDatabase({ empty: true });

  it('migrates an empty database on start, serves /api/ready, and exits cleanly on SIGTERM', async () => {
    const server = await spawnServer({ DATABASE_URL: database.current.url });
    try {
      const response = await fetch(`${server.url}/api/ready`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ready' });
      expect(server.logs.some((line) => line.msg === 'worker started')).toBe(true);
    } finally {
      expect(await server.stop('SIGTERM')).toBe(0);
    }
    expect(server.logs.some((line) => line.msg === 'shutdown complete')).toBe(true);
  });

  it('refuses to start with invalid configuration', async () => {
    const server = spawnServer({ DATABASE_URL: database.current.url, PORT: 'not-a-port' });
    await expect(server).rejects.toThrow(/exited with code 1/);
  });
});
