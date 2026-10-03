import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { sqliteDriverOf } from './sqlite/index.js';
import type { DB } from './types.js';

/** A backup request Shapio cannot serve; the message says what to do instead. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Writes a consistent copy of a SQLite database to `target` with `VACUUM INTO` while Shapio keeps running
 * (it reads one moment of the database and briefly holds the write lock). Refuses an existing target,
 * PostgreSQL and MySQL, whose backups are `pg_dump`'s and `mysqldump`'s job (documentation/backup-restore.md).
 * Returns the absolute path.
 */
export const backupDatabase = async (db: Kysely<DB>, target: string): Promise<string> => {
  if (!sqliteDriverOf(db)) {
    throw new BackupError(
      'shapio backup copies SQLite databases. Back up PostgreSQL with pg_dump and MySQL with ' +
        'mysqldump --single-transaction (see documentation/backup-restore.md).',
    );
  }
  const path = resolve(target);
  if (existsSync(path)) {
    throw new BackupError(`${path} already exists; choose a new file name`);
  }
  await sql`vacuum into ${path}`.execute(db);
  return path;
};
