import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dialectOfUrl, sqliteLocationOfUrl } from '../dialect.js';

/**
 * One long-running Shapio process per SQLite file (documentation/sqlite.md, "One process"): locks,
 * schema-change notifications and the job queue's coordination do not cross processes. `shapio start` holds
 * an exclusive SQLite lock on a sidecar file (`<database>-shapio.lock`) for its whole life; a second one gets
 * SQLITE_BUSY at once and refuses to start. The operating system drops the lock when the process ends, even on
 * a crash or `kill -9`, so nothing stale is left behind (a PID file would be, and containers reuse PID 1).
 * Short commands (`shapio migrate`, `backup`, `admin create`) never take it.
 */
export class SqliteFileInUseError extends Error {
  constructor(databasePath: string) {
    super(
      `Another Shapio process already serves ${databasePath}. Run one Shapio process per SQLite file ` +
        '(the job worker runs inside it); see documentation/sqlite.md.',
    );
    this.name = 'SqliteFileInUseError';
  }
}

export type ProcessLock = { release: () => void };

const NO_LOCK: ProcessLock = { release: () => undefined };

/** SQLITE_BUSY and SQLITE_LOCKED: another connection holds the lock. */
const isLocked = (error: unknown) => {
  const code = (error as { errcode?: number }).errcode;
  return code === 5 || code === 6;
};

/** Takes the file's process lock; a no-op for PostgreSQL, MySQL and `sqlite::memory:`. */
export const acquireProcessLock = (connectionString: string): ProcessLock => {
  if (dialectOfUrl(connectionString) !== 'sqlite') {
    return NO_LOCK;
  }
  const location = sqliteLocationOfUrl(connectionString);
  if (location.kind === 'memory') {
    return NO_LOCK;
  }
  const lockFile = new DatabaseSync(`${resolve(location.path)}-shapio.lock`);
  try {
    lockFile.exec('pragma busy_timeout = 0');
    lockFile.exec('pragma locking_mode = exclusive');
    // Nothing worth journaling: no rollback journal file beside the lock.
    lockFile.exec('pragma journal_mode = memory');
    // The first write takes the exclusive lock; exclusive locking mode keeps it until the connection closes.
    lockFile.exec('begin exclusive');
    lockFile.exec('create table if not exists process_lock (held integer)');
    lockFile.exec('commit');
  } catch (error) {
    lockFile.close();
    throw isLocked(error) ? new SqliteFileInUseError(location.path) : error;
  }
  return { release: () => lockFile.close() };
};

/** `shapio worker` on SQLite: the job worker always runs inside `shapio start` there. */
export class SqliteDedicatedWorkerError extends Error {
  constructor() {
    super(
      'shapio worker needs PostgreSQL or MySQL: on SQLite the job worker runs inside `shapio start` ' +
        '(WORKER_MODE=inline), so the server already runs the jobs.',
    );
    this.name = 'SqliteDedicatedWorkerError';
  }
}
