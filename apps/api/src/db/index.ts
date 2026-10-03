import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { dialectOfUrl, setCurrentDialect, sqliteLocationOfUrl } from './dialect.js';
import { createMysqlDb } from './mysql/index.js';
import { createSqliteDb } from './sqlite/index.js';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

type CreateDbOptions = {
  connectionString: string;
  poolMax: number;
  applicationName?: string;
  /**
   * Called when an idle pooled connection fails (PostgreSQL restarted, a network blip). The pool already
   * discards that connection and opens a new one on demand; this only reports it. Defaults to a process
   * warning, so the error is never silent.
   */
  onIdleConnectionError?: (error: Error) => void;
  /**
   * SQLite only: fail on computed result columns that look like undecoded timestamps or JSON (tests turn it
   * on, so a missing `db/sql/typed` marker is caught).
   */
  strict?: boolean;
};

const warnIdleConnectionError = (error: Error) =>
  process.emitWarning(`PostgreSQL connection lost while idle: ${error.message}`);

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
      applicationName,
      onIdleConnectionError: onIdleConnectionError ?? warnIdleMysqlConnectionError,
    });
  }
  setCurrentDialect('postgres');
  const pool = new pg.Pool({ connectionString, max: poolMax, application_name: applicationName });
  // Without a listener, pg's 'error' event on an idle client would crash the process on a database restart.
  pool.on('error', onIdleConnectionError ?? warnIdleConnectionError);
  // pg-pool drops its own listener while a client is checked out, yet a client whose socket dies still emits
  // 'error' (after rejecting its running query, or before the next query of a transaction). Unheard, that is
  // an uncaught exception that takes the process down. The error is not lost: the query or transaction using
  // the client fails with it, and an idle client reports it through onIdleConnectionError above.
  pool.on('connect', (client) => {
    client.on('error', () => undefined);
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
};

/**
 * The process-wide database handle used as the default executor by repositories.
 * `buildApp` sets it; tests and child processes each run in their own process, so one handle per process holds.
 */
export let db: Database = undefined as unknown as Database;

export const setDb = (instance: Database): void => {
  db = instance;
};
