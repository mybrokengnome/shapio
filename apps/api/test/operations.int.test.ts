import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/index.js';
import { enqueueJob } from '../src/jobs/queue.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import {
  connectionIdsOf,
  dialectSkipReason,
  isMysqlRun,
  isSqliteRun,
  withSkipReason,
} from './helpers/dialect.js';
import { API_ROOT } from './helpers/env.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { startTcpProxy, type TcpProxy } from './helpers/tcpProxy.js';
import { createTestDatabase, useTestDatabase, type TestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const OPERATIONS_CONFIG = resolve(import.meta.dirname, 'fixtures/operationsProject/shapio.config.ts');
/** Shutdown budget for the graceful-shutdown test: far above the slow job, so only a hang reaches it. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

/** Connections a process opened to `database`, by its application name. */
const connectionsOf = async (database: TestDatabase, applicationName: string) =>
  (await connectionIdsOf(database.db, database.name, applicationName)).length;

/** Runs `shapio <args>` (the real bin entry) to completion. */
const runCli = async (args: string[], env: Record<string, string>) => {
  const child = spawn(
    process.execPath,
    ['--conditions=@shapio/source', '--import', 'tsx', 'src/cli.ts', ...args],
    {
      cwd: API_ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LOG_PRETTY: 'false', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  // 'close', not 'exit': only then is all of stdout/stderr read.
  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stdout, stderr };
};

describe('graceful shutdown', { timeout: 60_000 }, () => {
  const database = useTestDatabase();
  let server: SpawnedServer;

  beforeAll(async () => {
    server = await spawnServer({
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      SHAPIO_CONFIG_PATH: OPERATIONS_CONFIG,
      SHUTDOWN_TIMEOUT_MS: String(SHUTDOWN_TIMEOUT_MS),
      WORKER_POLL_INTERVAL_MS: '50',
    });
  });
  afterAll(async () => {
    await server?.stop('SIGKILL');
  });

  it('finishes in-flight requests and running jobs, then closes the pool and exits 0', async () => {
    const { db } = database.current;
    // Long enough that both are still running when the signal goes out, even on a slow runner.
    const { job } = await enqueueJob({ type: 'ext.slow', payload: { ms: 4000 } }, db);
    await server.waitForLog((line) => line.msg === 'slow job started', { description: "'slow job started'" });

    const inFlight = fetch(`${server.url}/api/ext/ops/slow?ms=2500`);
    await server.waitForLog((line) => line.msg === 'slow request started', {
      description: "'slow request started'",
    });
    // PostgreSQL only: SQLite has no server-side connection list.
    if (!isSqliteRun()) {
      expect(await connectionsOf(database.current, 'shapio-api')).toBeGreaterThan(0);
    }

    // The job is mid-run when the signal goes out, so a succeeded job below means shutdown waited for it.
    expect(await jobsRepository.findById(job.id, db), 'the slow job when SIGTERM is sent').toMatchObject({
      status: 'running',
    });
    const started = Date.now();
    const exited = server.stop('SIGTERM', { timeoutMs: SHUTDOWN_TIMEOUT_MS + 15_000 });

    // The request that was running when the signal arrived still gets its answer.
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
    // New connections are refused once the listener has closed.
    await expect(fetch(`${server.url}/api/health`)).rejects.toThrow();

    expect(await exited, 'exit code after SIGTERM').toBe(0);
    // It waited for the job rather than aborting it (aborted jobs go back to pending), and did not hang
    // until the shutdown timeout.
    expect(Date.now() - started).toBeLessThan(SHUTDOWN_TIMEOUT_MS);
    expect(await jobsRepository.findById(job.id, db)).toMatchObject({ status: 'succeeded', attempts: 1 });
    const messages = server.logs.map((line) => line.msg);
    expect(messages.indexOf('shutting down')).toBeGreaterThan(-1);
    expect(messages.indexOf('shutdown complete')).toBeGreaterThan(messages.indexOf('shutting down'));
    // Every pooled connection was closed (the pool ended, not the process). The database drops a closed
    // session from its list a moment after the client hangs up, so poll for it.
    if (!isSqliteRun()) {
      await waitFor(async () => (await connectionsOf(database.current, 'shapio-api')) === 0, {
        timeoutMs: 10_000,
        description: "the server's database connections to be gone after it exited",
      });
    }
  });
});

const outageSkip = dialectSkipReason(import.meta.url, 'database outage');

describe.skipIf(outageSkip)(withSkipReason('database outage', outageSkip), { timeout: 60_000 }, () => {
  const database = useTestDatabase();
  let proxy: TcpProxy;
  let server: SpawnedServer;

  beforeAll(async () => {
    const target = new URL(database.current.url);
    proxy = await startTcpProxy({ host: target.hostname, port: Number(target.port || 5432) });
    const viaProxy = new URL(database.current.url);
    viaProxy.hostname = '127.0.0.1';
    viaProxy.port = String(proxy.port);
    server = await spawnServer({
      DATABASE_URL: viaProxy.toString(),
      MIGRATE_ON_START: 'false',
      WORKER_POLL_INTERVAL_MS: '100',
    });
  });
  afterAll(async () => {
    await server?.stop('SIGKILL');
    await proxy?.close();
  });

  /** A request to the server; if it cannot connect, the failure says whether and how the process ended. */
  const get = async (path: string) => {
    try {
      return await fetch(`${server.url}${path}`);
    } catch (error) {
      const tail = server.logs.slice(-20).map((line) => JSON.stringify(line).slice(0, 500));
      throw new Error(
        `GET ${path} failed (server exit code ${String(server.child.exitCode)}, signal ` +
          `${String(server.child.signalCode)}). Last log lines:\n${tail.join('\n')}`,
        { cause: error },
      );
    }
  };

  it('stays up, reports not ready while the database is gone, and recovers on its own', async () => {
    // Several requests so the pool holds idle connections when the database goes away.
    const warm = await Promise.all(Array.from({ length: 4 }, () => get('/api/ready')));
    expect(warm.map((response) => response.status)).toEqual([200, 200, 200, 200]);

    await proxy.interrupt();

    // Readiness depends on the database, with a clear reason, once the process notices it is gone.
    const down = await waitFor(
      async () => {
        const response = await get('/api/ready');
        return response.status === 503 ? response : undefined;
      },
      {
        timeoutMs: 15_000,
        intervalMs: 100,
        description: '/api/ready to answer 503 while the database is gone',
      },
    );
    // Liveness does not depend on the database.
    expect((await get('/api/health')).status).toBe(200);
    expect(await down.json()).toMatchObject({
      error: { code: 'NOT_READY', details: { checks: { database: 'failing' } } },
    });

    await proxy.resume();
    await waitFor(async () => (await get('/api/ready')).status === 200, {
      timeoutMs: 15_000,
      intervalMs: 100,
      description: '/api/ready to answer 200 again after the database came back',
    });

    // Same process throughout: dropped connections never crashed it.
    expect(server.child.exitCode).toBeNull();
    expect(server.child.signalCode).toBeNull();
    expect(server.logs.filter((line) => line.msg?.startsWith('Server listening'))).toHaveLength(1);
  });
});

describe.skipIf(outageSkip)(withSkipReason('a connection that dies while checked out', outageSkip), () => {
  const database = useTestDatabase();

  it('fails the transaction using it, and never surfaces as an uncaught exception', async () => {
    const target = new URL(database.current.url);
    const proxy = await startTcpProxy({ host: target.hostname, port: Number(target.port || 5432) });
    const viaProxy = new URL(database.current.url);
    viaProxy.hostname = '127.0.0.1';
    viaProxy.port = String(proxy.port);
    const idleErrors: Error[] = [];
    const db = createDb({
      connectionString: viaProxy.toString(),
      poolMax: 2,
      onIdleConnectionError: (error) => idleErrors.push(error),
    });
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const transaction = db.transaction().execute(async (trx) => {
        await sql`select 1`.execute(trx);
        // The client is checked out and between queries when the connection goes away.
        await proxy.interrupt();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await sql`select 1`.execute(trx);
      });
      await expect(transaction).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      await db.destroy().catch(() => undefined);
      await proxy.close();
    }
  });
});

describe('startup', { timeout: 60_000 }, () => {
  const database = useTestDatabase();

  it('logs one summary line with version, mode, URL, storage driver and worker mode, and no secrets', async () => {
    const secret = 'summary-test-secret-0123456789abcdefghijkl';
    const server = await spawnServer({
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      SESSION_SECRET: secret,
      PUBLIC_URL: 'http://cms.example.test:4300',
    });
    try {
      const summary = await server.waitForLog((line) => line.msg?.startsWith('Shapio ') === true, {
        description: "the 'Shapio … running at …' startup summary",
      });
      expect(summary).toMatchObject({
        version: expect.any(String) as unknown,
        mode: 'test',
        url: 'http://cms.example.test:4300/',
        storage: 'local',
        worker: 'inline',
        tls: 'off',
      });
      expect(summary?.msg).toMatch(
        /^Shapio \S+ running at \S+ \(mode test, storage local, worker inline, tls off\)$/,
      );
      const everything = server.logs.map((line) => JSON.stringify(line)).join('\n');
      expect(everything).not.toContain(secret);
      expect(everything).not.toContain(new URL(database.current.url).password || '\u0000');
    } finally {
      expect(await server.stop('SIGTERM'), 'exit code after SIGTERM').toBe(0);
    }
  });

  it('with MIGRATE_ON_START=false refuses to start on pending migrations, and starts after `shapio migrate`', async () => {
    const empty = await createTestDatabase({ empty: true });
    try {
      const env = { DATABASE_URL: empty.url, MIGRATE_ON_START: 'false' };
      await expect(spawnServer(env)).rejects.toThrow(/pending migration\(s\).*shapio migrate/s);

      const migrated = await runCli(['migrate'], { NODE_ENV: 'test', ...env });
      expect(migrated).toMatchObject({
        code: 0,
        stdout: expect.stringMatching(/Applied \d+ migration\(s\)/) as unknown,
      });
      expect(await runCli(['migrate'], { NODE_ENV: 'test', ...env })).toMatchObject({
        code: 0,
        stdout: 'Database is up to date.\n',
      });

      const server = await spawnServer(env);
      try {
        expect((await fetch(`${server.url}/api/ready`)).status).toBe(200);
      } finally {
        expect(await server.stop('SIGTERM'), 'exit code after SIGTERM').toBe(0);
      }
    } finally {
      await empty.drop();
    }
  });

  /** The test server's address and credentials with another database name (SQLite: a missing directory). */
  const missingDatabaseUrl = () => {
    if (isSqliteRun()) {
      return 'sqlite:/nonexistent-shapio-directory/shapio_no_such_database.db';
    }
    const url = new URL(database.current.url);
    url.pathname = '/shapio_no_such_database';
    return url.toString();
  };

  it.each([
    {
      name: 'an unreachable database',
      env: () => ({ DATABASE_URL: 'postgres://shapio:hunter2pass@127.0.0.1:1/shapio' }),
      message: /Cannot connect to PostgreSQL at 127\.0\.0\.1:1\/shapio \(DATABASE_URL\): connection refused/,
    },
    {
      name: 'a DATABASE_URL that is not a URL',
      env: () => ({ DATABASE_URL: 'notaurl' }),
      message: /DATABASE_URL must be a postgres:\/\/ URL/,
    },
    {
      name: 'a database that does not exist',
      env: () => ({ DATABASE_URL: missingDatabaseUrl() }),
      message: () => {
        if (isSqliteRun()) {
          return /Cannot open the SQLite database at \S+\/shapio_no_such_database\.db \(DATABASE_URL\): .*Check that its directory exists/;
        }
        return isMysqlRun()
          ? /Cannot connect to MySQL at \S+\/shapio_no_such_database \(DATABASE_URL\): Unknown database 'shapio_no_such_database'/
          : /Cannot connect to PostgreSQL at \S+\/shapio_no_such_database \(DATABASE_URL\): database "shapio_no_such_database" does not exist/;
      },
    },
    {
      name: 'production without PUBLIC_URL',
      env: () => ({ NODE_ENV: 'production', DATABASE_URL: 'postgres://127.0.0.1/x' }),
      message: /PUBLIC_URL is required in production/,
    },
    {
      name: 'a certificate without its key',
      env: () => ({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://127.0.0.1/x',
        PUBLIC_URL: 'https://cms.example.com',
        TLS_CERT_FILE: '/etc/ssl/cms.example.com/fullchain.pem',
      }),
      message: /TLS_CERT_FILE and TLS_KEY_FILE must be set together/,
    },
  ])('fails fast with an actionable message for $name', async ({ env, message }) => {
    const result = await runCli(['start'], { NODE_ENV: 'test', PORT: '0', ...env() });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(typeof message === 'function' ? message() : message);
    // Credentials in DATABASE_URL never reach the output.
    expect(result.stdout + result.stderr).not.toContain('hunter2pass');
  });
});
