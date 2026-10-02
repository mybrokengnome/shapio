import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
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
};

const warnIdleConnectionError = (error: Error) =>
  process.emitWarning(`PostgreSQL connection lost while idle: ${error.message}`);

export const createDb = ({
  connectionString,
  poolMax,
  applicationName = 'shapio',
  onIdleConnectionError = warnIdleConnectionError,
}: CreateDbOptions): Database => {
  const pool = new pg.Pool({ connectionString, max: poolMax, application_name: applicationName });
  // Without a listener, pg's 'error' event on an idle client would crash the process on a database restart.
  pool.on('error', onIdleConnectionError);
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
