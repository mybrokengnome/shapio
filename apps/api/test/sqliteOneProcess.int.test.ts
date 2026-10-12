import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_ROOT } from './helpers/env.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';

const run = promisify(execFile);

/**
 * documentation/sqlite.md, "One process": one serving Shapio process per SQLite file. A second `shapio start`
 * and `shapio worker` are refused; short commands still run beside the server. Uses its own SQLite file, so it
 * runs the same on every test database.
 */
describe('one Shapio process per SQLite file', { timeout: 120_000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'shapio-sqlite-one-process-'));
  const databaseUrl = `sqlite:${join(directory, 'shapio.db')}`;
  const env = {
    DATABASE_URL: databaseUrl,
    MEDIA_PATH: join(directory, 'media'),
    SESSION_SECRET: 'sqlite-one-process-test-secret-0123456789abcdef',
  };
  let server: SpawnedServer | undefined;

  const cli = async (args: string[], extra: Record<string, string> = {}) => {
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        ['--conditions=@shapio/source', '--import', 'tsx', 'src/cli.ts', ...args],
        {
          cwd: API_ROOT,
          timeout: 60_000,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            HOST: '127.0.0.1',
            PORT: '0',
            ...env,
            ...extra,
          },
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };

  beforeAll(async () => {
    server = await spawnServer({ ...env, MIGRATE_ON_START: 'true' });
  });

  afterAll(async () => {
    await server?.stop('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
  });

  it('refuses a second shapio start on the same file', async () => {
    const second = await cli(['start']);
    expect(second.code).toBe(1);
    expect(second.stderr).toContain('Another Shapio process already serves');
  });

  it('refuses shapio worker on SQLite, whatever WORKER_MODE says', async () => {
    const worker = await cli(['worker']);
    expect(worker.code).toBe(1);
    expect(worker.stderr).toContain('shapio worker needs PostgreSQL or MySQL');
  });

  it('still runs short commands beside the server: migrate, backup and admin create', async () => {
    expect(await cli(['migrate'])).toMatchObject({ code: 0 });
    const backup = join(directory, 'backup.db');
    const backedUp = await cli(['backup', backup]);
    expect(backedUp, backedUp.stderr).toMatchObject({ code: 0 });
    expect(existsSync(backup)).toBe(true);
    const admin = await cli(['admin', 'create', '--email', 'ops@example.com'], {
      SHAPIO_ADMIN_PASSWORD: 'long enough password',
    });
    expect(admin, admin.stderr).toMatchObject({ code: 0 });
  });

  it('frees the file when the server stops, also after a crash', async () => {
    await server?.stop('SIGKILL');
    server = await spawnServer({ ...env });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await server.stop('SIGTERM');
    server = await spawnServer({ ...env });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
