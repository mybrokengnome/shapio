import { sql, type Kysely } from 'kysely';

/**
 * A round trip to the database that touches no table (readiness checks).
 * PostgreSQL, SQLite and MySQL: `select 1`. Contract: fails when the database is unreachable.
 */
export const pingDatabase = async <T>(executor: Kysely<T>): Promise<void> => {
  await sql`select 1`.execute(executor);
};
