import { Kysely, PostgresDialect, type PostgresPool, type TransactionBuilder } from 'kysely';
import pg from 'pg';
import { assertNotNested, withConnectionScope } from './connectionScope.js';
import { dialectOfUrl, setCurrentDialect, sqliteLocationOfUrl } from './dialect.js';
import { createMysqlDb } from './mysql/index.js';
import { DEFAULT_POOL_ACQUIRE_TIMEOUT_MS, pgAcquireError } from './poolAcquire.js';
import { createSqliteDb } from './sqlite/index.js';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

type CreateDbOptions = {
  connectionString: string;
  poolMax: number;
  /**
   * PostgreSQL and MySQL: how long a query waits for a free pooled connection before it fails with a 503
   * (`PoolAcquireTimeoutError`). On PostgreSQL it also bounds opening a new connection (503
   * `DatabaseUnavailableError`). SQLite never waits for a pooled connection: autocommit reads share one
   * reader, and a write that would wait for its own transaction fails at once (`db/sqlite/writeLock.ts`).
   */
  acquireTimeoutMs?: number;
  applicationName?: string;
  /**
   * Called when an idle pooled connection fails (PostgreSQL restarted, a network blip). The pool already
   * discards that connection and opens a new one on demand; this only reports it. Defaults to a process
   * warning, so the error is never silent.
   */
  onIdleConnectionError?: (error: Error) => void;
  /**
   * Tests turn it on. SQLite: fail on computed result columns that look like undecoded timestamps or JSON,
   * so a missing `db/sql/typed` marker is caught. PostgreSQL and MySQL: fail a query that asks the pool for
   * a connection inside an open transaction (`db/connectionScope.ts`).
   */
  strict?: boolean;
};

const warnIdleConnectionError = (error: Error) =>
  process.emitWarning(`PostgreSQL connection lost while idle: ${error.message}`);

/**
 * The pg pool as Kysely sees it: an exhausted pool's queue timeout becomes `PoolAcquireTimeoutError`, a
 * connection that cannot be opened in time `DatabaseUnavailableError`, and in strict mode a nested
 * acquisition fails at once.
 */
const acquiringPool = (
  pool: pg.Pool,
  poolMax: number,
  acquireTimeoutMs: number,
  strict: boolean,
): PostgresPool => ({
  options: pool.options,
  connect: async () => {
    if (strict) {
      assertNotNested();
    }
    try {
      return await pool.connect();
    } catch (error) {
      throw pgAcquireError(error, poolMax, acquireTimeoutMs);
    }
  },
  end: () => pool.end(),
});

/** Kysely on PostgreSQL in strict mode: transactions run in a connection scope (`db/connectionScope.ts`). */
class StrictPostgresKysely<DB> extends Kysely<DB> {
  override transaction(): TransactionBuilder<DB> {
    return withConnectionScope(super.transaction());
  }
}

const warnIdleMysqlConnectionError = (error: Error) =>
  process.emitWarning(`MySQL connection lost while idle: ${error.message}`);

/**
 * The database handle for DATABASE_URL: PostgreSQL through a `pg` pool, MySQL (`mysql://…`) through a
 * `mysql2` pool, or SQLite (`sqlite:<path>`) through Shapio's `node:sqlite` driver, where `poolMax` is the
 * number of read connections (one connection writes).
 * Sets the process dialect (`db/dialect.ts`) that SQL builders read.
 */
export const createDb = ({
  connectionString,
  poolMax,
  acquireTimeoutMs = DEFAULT_POOL_ACQUIRE_TIMEOUT_MS,
  applicationName = 'shapio',
  onIdleConnectionError,
  strict = false,
}: CreateDbOptions): Database => {
  if (dialectOfUrl(connectionString) === 'sqlite') {
    setCurrentDialect('sqlite');
    return createSqliteDb<DB>({ location: sqliteLocationOfUrl(connectionString), readers: poolMax, strict });
  }
  if (dialectOfUrl(connectionString) === 'mysql') {
    setCurrentDialect('mysql');
    return createMysqlDb<DB>({
      url: connectionString,
      poolMax,
      acquireTimeoutMs,
      applicationName,
      onIdleConnectionError: onIdleConnectionError ?? warnIdleMysqlConnectionError,
      strict,
    });
  }
  setCurrentDialect('postgres');
  const pool = new pg.Pool({
    connectionString,
    max: poolMax,
    // Bounds both the wait for a free connection and the opening of a new one.
    connectionTimeoutMillis: acquireTimeoutMs,
    application_name: applicationName,
  });
  // Without a listener, pg's 'error' event on an idle client would crash the process on a database restart.
  pool.on('error', onIdleConnectionError ?? warnIdleConnectionError);
  // pg-pool drops its own listener while a client is checked out, yet a client whose socket dies still emits
  // 'error' (after rejecting its running query, or before the next query of a transaction). Unheard, that is
  // an uncaught exception that takes the process down. The error is not lost: the query or transaction using
  // the client fails with it, and an idle client reports it through onIdleConnectionError above.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  const dialect = new PostgresDialect({
    pool: acquiringPool(pool, poolMax, acquireTimeoutMs, strict),
    // What the pool would use itself; Kysely opens it to cancel a query.
    controlClient: pg.Client,
  });
  return strict ? new StrictPostgresKysely<DB>({ dialect }) : new Kysely<DB>({ dialect });
};

/**
 * The process-wide database handle used as the default executor by repositories.
 * `buildApp` sets it; tests and child processes each run in their own process, so one handle per process holds.
 */
export let db: Database = undefined as unknown as Database;

export const setDb = (instance: Database): void => {
  db = instance;
};

/** Whether this process has its database handle yet (a server in the same process set it first). */
export const hasDb = (): boolean => (db as Database | undefined) !== undefined;

/** Unsets the process handle if it is `instance` (its owner is closing it); leaves any other handle alone. */
export const clearDb = (instance: Database): void => {
  if (db === instance) {
    db = undefined as unknown as Database;
  }
};
