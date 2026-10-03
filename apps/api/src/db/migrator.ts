import type { Kysely } from 'kysely';
import { Migrator, type MigrationResult } from 'kysely/migration';
import { LOCK_NAMESPACE, MIGRATION_LOCK_KEY } from '../constants/lockKeys.js';
import { withSessionAdvisoryLock } from './advisoryLocks.js';
import { migrationProviderFor } from './migrations/index.js';
import { mysqlMigrationHint } from './mysql/errors.js';
import { mysqlDriverOf } from './mysql/index.js';
import { sqliteDriverOf } from './sqlite/index.js';
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

const dialectOfHandle = (db: Kysely<DB>) => {
  if (sqliteDriverOf(db)) {
    return 'sqlite';
  }
  return mysqlDriverOf(db) ? 'mysql' : 'postgres';
};

/**
 * Migrations must stay in order; out-of-order additions are rejected (see build plan §2). The list depends
 * on the handle's dialect (SQLite and MySQL start from a baseline).
 */
export const createMigrator = (db: Kysely<DB>): Migrator =>
  new Migrator({
    db,
    provider: migrationProviderFor(dialectOfHandle(db)),
    allowUnorderedMigrations: false,
  });

/**
 * Runs pending migrations under a session advisory lock so concurrent instances starting together
 * migrate exactly once; the others wait, then find nothing to do.
 */
const runMigrations = (db: Kysely<DB>, log: MigrationLogger): Promise<MigrationResult[]> =>
  withSessionAdvisoryLock(db, LOCK_NAMESPACE.migrations, MIGRATION_LOCK_KEY, async () => {
    const { error, results = [] } = await createMigrator(db).migrateToLatest();
    for (const result of results) {
      log.info({ migration: result.migrationName, status: result.status }, 'migration');
    }
    if (error) {
      const hint = mysqlMigrationHint(error);
      throw new MigrationError(
        hint ? `Database migration failed: ${hint}` : 'Database migration failed',
        results,
        {
          cause: error,
        },
      );
    }
    return results;
  });

/**
 * Runs pending migrations (see `runMigrations`), then refreshes SQLite's planner statistics: new tables and
 * indexes have none yet (`sqlite/driver.ts`).
 */
export const migrateToLatest = async (db: Kysely<DB>, log: MigrationLogger): Promise<MigrationResult[]> => {
  const results = await runMigrations(db, log);
  await sqliteDriverOf(db)?.optimizeStatistics('full');
  return results;
};

/** Names of migrations known to this build that have not run against the database. */
export const getPendingMigrations = async (db: Kysely<DB>): Promise<string[]> => {
  const migrations = await createMigrator(db).getMigrations();
  return migrations.filter((migration) => migration.executedAt === undefined).map((m) => m.name);
};
