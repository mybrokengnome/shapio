import type { Kysely } from 'kysely';
import {
  Migrator,
  type MigrationResultSet,
  type MigrationResult,
  type MigratorProps,
} from 'kysely/migration';
import { LOCK_NAMESPACE, MIGRATION_LOCK_KEY } from '../constants/lockKeys.js';
import { withSessionAdvisoryLock } from './advisoryLocks.js';
import { migrationProviderFor } from './migrations/index.js';
import { mysqlMigrationHint } from './mysql/errors.js';
import { mysqlDriverOf } from './mysql/index.js';
import { sqliteDriverOf, type SqliteDriver } from './sqlite/index.js';
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
 * SQLite runs every migration step with foreign keys off (`SqliteDriver.withForeignKeysOff`): a migration that
 * rebuilds a table other tables reference needs it, and cannot switch it inside its own transaction. Every
 * reference is checked once the step is done.
 */
class SqliteMigrator extends Migrator {
  readonly #driver: SqliteDriver;

  constructor(props: MigratorProps, driver: SqliteDriver) {
    super(props);
    this.#driver = driver;
  }

  override migrateToLatest(): Promise<MigrationResultSet> {
    return this.#driver.withForeignKeysOff(() => super.migrateToLatest());
  }

  override migrateTo(...args: Parameters<Migrator['migrateTo']>): Promise<MigrationResultSet> {
    return this.#driver.withForeignKeysOff(() => super.migrateTo(...args));
  }

  override migrateUp(): Promise<MigrationResultSet> {
    return this.#driver.withForeignKeysOff(() => super.migrateUp());
  }

  override migrateDown(): Promise<MigrationResultSet> {
    return this.#driver.withForeignKeysOff(() => super.migrateDown());
  }
}

/**
 * Migrations must stay in order; out-of-order additions are rejected (see build plan §2). The list depends
 * on the handle's dialect (SQLite and MySQL start from a baseline).
 */
export const createMigrator = (db: Kysely<DB>): Migrator => {
  const props: MigratorProps = {
    db,
    provider: migrationProviderFor(dialectOfHandle(db)),
    allowUnorderedMigrations: false,
  };
  const sqlite = sqliteDriverOf(db);
  return sqlite ? new SqliteMigrator(props, sqlite) : new Migrator(props);
};

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
