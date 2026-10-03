import { sql, type Kysely, type RawBuilder } from 'kysely';
import { isMysql } from './dialect.js';
import type { DB } from './types.js';

/**
 * MySQL errors that mean a DDL statement's work is already done: the column or index exists (1060, 1061),
 * or there is nothing to drop (1091). MySQL has no `IF [NOT] EXISTS` for these statements.
 */
const MYSQL_ALREADY_DONE = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_CANT_DROP_FIELD_OR_KEY']);

const isAlreadyDone = (error: unknown): boolean =>
  isMysql() &&
  typeof error === 'object' &&
  error !== null &&
  MYSQL_ALREADY_DONE.has(String((error as { code?: unknown }).code));

/**
 * MySQL: how long a DDL statement waits for the table's metadata lock. Even an online index build takes it
 * briefly, and while it waits every new query on the table queues behind it, so it gives up early (the
 * caller's job retries) instead of stalling the table behind one long transaction.
 */
const MYSQL_DDL_LOCK_WAIT_SECONDS = 10;

const executeMysqlDdl = (db: Kysely<DB>, statement: RawBuilder<unknown>): Promise<void> =>
  db.connection().execute(async (connection) => {
    await sql`set session lock_wait_timeout = ${sql.lit(MYSQL_DDL_LOCK_WAIT_SECONDS)}`.execute(connection);
    try {
      await statement.execute(connection);
    } finally {
      await sql`set session lock_wait_timeout = default`.execute(connection);
    }
  });

/**
 * Runs an idempotent DDL statement (null: nothing to run). PostgreSQL and SQLite spell idempotency with
 * `IF [NOT] EXISTS`; on MySQL "already exists" and "nothing to drop" count as done.
 */
export const executeIdempotentDdl = async (
  db: Kysely<DB>,
  statement: RawBuilder<unknown> | null,
): Promise<void> => {
  if (!statement) {
    return;
  }
  try {
    await (isMysql() ? executeMysqlDdl(db, statement) : statement.execute(db));
  } catch (error) {
    if (!isAlreadyDone(error)) {
      throw error;
    }
  }
};
