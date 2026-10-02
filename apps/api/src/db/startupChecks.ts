import { sql, type Kysely } from 'kysely';
import { getPendingMigrations } from './migrator.js';
import type { DB } from './types.js';

/** A startup precondition that failed; the message tells the operator what to change. */
export class StartupCheckError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StartupCheckError';
  }
}

/** `host:port/database` from DATABASE_URL, never the credentials. */
export const describeDatabaseTarget = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
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

/** Fails with an actionable message when PostgreSQL cannot be reached with DATABASE_URL. */
export const assertDatabaseReachable = async (db: Kysely<DB>, connectionString: string): Promise<void> => {
  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    throw new StartupCheckError(
      `Cannot connect to PostgreSQL at ${describeDatabaseTarget(connectionString)} (DATABASE_URL): ` +
        `${connectionFailureReason(error)}. Check that PostgreSQL is running and DATABASE_URL is correct.`,
      { cause: error },
    );
  }
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
