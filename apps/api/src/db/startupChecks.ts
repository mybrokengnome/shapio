import { sql, type Kysely } from 'kysely';
import { dialectOfUrl, sqliteLocationOfUrl } from './dialect.js';
import { getPendingMigrations } from './migrator.js';
import type { DB } from './types.js';

/** A startup precondition that failed; the message tells the operator what to change. */
export class StartupCheckError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StartupCheckError';
  }
}

/** `host:port/database` (PostgreSQL, MySQL) or the file path (SQLite) from DATABASE_URL, never the credentials. */
export const describeDatabaseTarget = (connectionString: string): string => {
  if (dialectOfUrl(connectionString) === 'sqlite') {
    const location = sqliteLocationOfUrl(connectionString);
    return location.kind === 'memory' ? 'an in-memory database' : location.path;
  }
  try {
    const url = new URL(connectionString);
    const defaultPort = dialectOfUrl(connectionString) === 'mysql' ? '3306' : '5432';
    return `${url.hostname}:${url.port || defaultPort}${url.pathname}`;
  } catch {
    return 'the configured database';
  }
};

const NETWORK_REASONS: Record<string, string> = {
  ECONNREFUSED: 'connection refused',
  ENOTFOUND: 'host not found',
  EAI_AGAIN: 'host not found (DNS lookup failed)',
  ETIMEDOUT: 'connection timed out',
  EHOSTUNREACH: 'host unreachable',
  ECONNRESET: 'connection reset',
};

/** pg reports a refused dual-stack connection as an AggregateError whose parts carry the codes. */
const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { code, errors } = error as { code?: unknown; errors?: unknown };
  if (typeof code === 'string') {
    return code;
  }
  return Array.isArray(errors) ? errors.map(errorCode).find((value) => value !== undefined) : undefined;
};

const connectionFailureReason = (error: unknown): string => {
  const code = errorCode(error);
  const network = code === undefined ? undefined : NETWORK_REASONS[code];
  if (network) {
    return network;
  }
  return error instanceof Error && error.message !== '' ? error.message : String(code ?? error);
};

const unreachable = (error: unknown, connectionString: string): StartupCheckError => {
  if (dialectOfUrl(connectionString) === 'sqlite') {
    return new StartupCheckError(
      `Cannot open the SQLite database at ${describeDatabaseTarget(connectionString)} (DATABASE_URL): ` +
        `${connectionFailureReason(error)}. Check that its directory exists and is writable.`,
      { cause: error },
    );
  }
  if (dialectOfUrl(connectionString) === 'mysql') {
    return new StartupCheckError(
      `Cannot connect to MySQL at ${describeDatabaseTarget(connectionString)} (DATABASE_URL): ` +
        `${connectionFailureReason(error)}. Check that MySQL is running and DATABASE_URL is correct.`,
      { cause: error },
    );
  }
  return new StartupCheckError(
    `Cannot connect to PostgreSQL at ${describeDatabaseTarget(connectionString)} (DATABASE_URL): ` +
      `${connectionFailureReason(error)}. Check that PostgreSQL is running and DATABASE_URL is correct.`,
    { cause: error },
  );
};

/** MySQL 8.4 LTS is the supported version (8.0.23+ untested); MariaDB lacks what Shapio's SQL needs. */
const MYSQL_MINIMUM = [8, 0, 23] as const;

const versionParts = (version: string) => version.split(/[.-]/).slice(0, 3).map(Number);

const atLeast = (actual: readonly number[], minimum: readonly number[]) => {
  for (const [index, part] of minimum.entries()) {
    const value = actual[index] ?? 0;
    if (value !== part) {
      return value > part;
    }
  }
  return true;
};

/**
 * MySQL only: refuses MariaDB and MySQL before 8.0.23 (invisible columns, `JSON_VALUE`,
 * row aliases in upserts, the `utf8mb4_0900_bin` collation). No-op on other databases.
 */
const assertSupportedDatabase = async (db: Kysely<DB>, connectionString: string): Promise<void> => {
  if (dialectOfUrl(connectionString) !== 'mysql') {
    return;
  }
  const { rows } = await sql<{ version: string }>`select version() as version`.execute(db);
  const version = rows[0]?.version ?? '';
  if (/mariadb/i.test(version)) {
    throw new StartupCheckError(
      `DATABASE_URL points at MariaDB ${version}; Shapio supports MySQL 8.4 (see documentation/mysql.md).`,
    );
  }
  if (!atLeast(versionParts(version), MYSQL_MINIMUM)) {
    throw new StartupCheckError(
      `DATABASE_URL points at MySQL ${version}; Shapio needs MySQL 8.4 (see documentation/mysql.md).`,
    );
  }
};

/** Fails with an actionable message when the database cannot be reached with DATABASE_URL. */
export const assertDatabaseReachable = async (db: Kysely<DB>, connectionString: string): Promise<void> => {
  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    throw unreachable(error, connectionString);
  }
  await assertSupportedDatabase(db, connectionString);
};

/** With MIGRATE_ON_START=false the schema must already be current; say how to get there if it is not. */
export const assertNoPendingMigrations = async (db: Kysely<DB>): Promise<void> => {
  const pending = await getPendingMigrations(db);
  if (pending.length > 0) {
    throw new StartupCheckError(
      `The database has ${pending.length} pending migration(s) and MIGRATE_ON_START=false. ` +
        'Run `shapio migrate`, then start Shapio again.',
    );
  }
};
