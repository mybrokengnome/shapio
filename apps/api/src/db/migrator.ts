import type { Kysely } from 'kysely';
import { Migrator, type MigrationResult } from 'kysely/migration';
import { LOCK_NAMESPACE, MIGRATION_LOCK_KEY } from '../constants/lockKeys.js';
import { withSessionAdvisoryLock } from './advisoryLocks.js';
import { staticMigrationProvider } from './migrations/index.js';
import type { DB } from './types.js';

type MigrationLogger = {
  info: (obj: object, msg: string) => void;
};

export class MigrationError extends Error {
  readonly results: readonly MigrationResult[];

  constructor(message: string, results: readonly MigrationResult[], options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationError';
    this.results = results;
  }
}

/** Migrations must stay in order; out-of-order additions are rejected (see build plan §2). */
export const createMigrator = (db: Kysely<DB>): Migrator =>
  new Migrator({ db, provider: staticMigrationProvider, allowUnorderedMigrations: false });

/**
 * Runs pending migrations under a session advisory lock so concurrent instances starting together
 * migrate exactly once; the others wait, then find nothing to do.
 */
export const migrateToLatest = async (db: Kysely<DB>, log: MigrationLogger): Promise<MigrationResult[]> =>
  withSessionAdvisoryLock(db, LOCK_NAMESPACE.migrations, MIGRATION_LOCK_KEY, async () => {
    const { error, results = [] } = await createMigrator(db).migrateToLatest();
    for (const result of results) {
      log.info({ migration: result.migrationName, status: result.status }, 'migration');
    }
    if (error) {
      throw new MigrationError('Database migration failed', results, { cause: error });
    }
    return results;
  });

/** Names of migrations known to this build that have not run against the database. */
export const getPendingMigrations = async (db: Kysely<DB>): Promise<string[]> => {
  const migrations = await createMigrator(db).getMigrations();
  return migrations.filter((migration) => migration.executedAt === undefined).map((m) => m.name);
};
