import { spawnTsProcess, type SpawnedProcess } from './spawnProcess.js';

export type SpawnedServer = SpawnedProcess & { url: string };

const LISTENING = /^Server listening at (https?:\/\/127\.0\.0\.1:\d+)$/;

/**
 * Starts the real server entry (src/main.ts) in a child process on a free port. Used for tests that need
 * process identity (same PID across a live model change) or several instances against one database.
 */
export const spawnServer = async (env: Record<string, string>): Promise<SpawnedServer> => {
  const spawned = spawnTsProcess('src/main.ts', {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'info',
    ...env,
  });
  const line = await spawned.waitForLog((l) => typeof l.msg === 'string' && LISTENING.test(l.msg), {
    description: "'Server listening at …' (it never started listening)",
  });
  const url = LISTENING.exec(line.msg ?? '')?.[1];
  if (!url) {
    throw new Error('Could not determine the server address');
  }
  return { ...spawned, url };
};
