import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { sleep } from '../helpers/sleep.js';
import { isSqlite } from './dialect.js';
import { sqliteDriverOf } from './sqlite/index.js';
import { withKeyedMutex } from './sqlite/keyedMutex.js';
import type { DB } from './types.js';

/**
 * Advisory-lock primitives. Kept in `db/` beside the Kysely instance so no other module writes lock SQL.
 * Keys are (namespace, key) int4 pairs; see constants/lockKeys.ts.
 *
 * PostgreSQL: advisory locks. SQLite (single process): session locks are an in-process mutex per database
 * and key; transaction locks are checks only, because every write transaction already holds SQLite's single
 * write lock, so no other transaction can run while one holds them.
 */

/** Stable 32-bit signed key for a string ID (e.g. a model UUID). Collisions only cost extra serialization. */
export const lockKeyFromId = (id: string): number => createHash('sha256').update(id).digest().readInt32BE(0);

/** The in-process mutex standing in for a session lock on a SQLite handle, or undefined on PostgreSQL. */
const sqliteSessionLock = <T>(
  db: Kysely<DB>,
  namespace: number,
  key: number,
  fn: () => Promise<T>,
): Promise<T> | undefined => {
  const driver = sqliteDriverOf(db);
  return driver && withKeyedMutex(`${driver.databaseKey}:${namespace}:${key}`, fn);
};

/**
 * Holds a session-level advisory lock on a dedicated pooled connection while `fn` runs, then releases it.
 * `fn` may use the pool freely (it does not run on the locking connection). Blocks until the lock is free.
 */
export const withSessionAdvisoryLock = async <T>(
  db: Kysely<DB>,
  namespace: number,
  key: number,
  fn: () => Promise<T>,
): Promise<T> =>
  sqliteSessionLock(db, namespace, key, fn) ??
  db.connection().execute(async (connection) => {
    await sql`select pg_advisory_lock(${namespace}::int4, ${key}::int4)`.execute(connection);
    try {
      return await fn();
    } finally {
      await sql`select pg_advisory_unlock(${namespace}::int4, ${key}::int4)`.execute(connection);
    }
  });

/**
 * Like `withSessionAdvisoryLock`, but waits by polling `pg_try_advisory_lock` between pauses instead of
 * blocking inside a statement. Use it around `CREATE INDEX CONCURRENTLY`: a session blocked in
 * `pg_advisory_lock` is an open transaction with a snapshot, which a concurrent index build waits for while
 * its own job holds the lock — a wait cycle PostgreSQL does not detect. (SQLite has no such cycle: the
 * plain mutex.)
 */
export const withPolledSessionAdvisoryLock = async <T>(
  db: Kysely<DB>,
  namespace: number,
  key: number,
  fn: () => Promise<T>,
  pollMs = 200,
): Promise<T> =>
  sqliteSessionLock(db, namespace, key, fn) ??
  db.connection().execute(async (connection) => {
    const tryLock = async () =>
      (
        await sql<{
          locked: boolean;
        }>`select pg_try_advisory_lock(${namespace}::int4, ${key}::int4) as locked`.execute(connection)
      ).rows[0]?.locked === true;
    while (!(await tryLock())) {
      await sleep(pollMs);
    }
    try {
      return await fn();
    } finally {
      await sql`select pg_advisory_unlock(${namespace}::int4, ${key}::int4)`.execute(connection);
    }
  });

/** On SQLite a transaction lock only checks that `trx` is a write transaction (see above). */
const assertSqliteWriteTransaction = async (trx: Transaction<DB>): Promise<void> => {
  await sql`select shapio_assert_write_transaction()`.execute(trx);
};

/** Exclusive transaction-level lock, released at commit/rollback. */
export const acquireXactLock = async (
  trx: Transaction<DB>,
  namespace: number,
  key: number,
): Promise<void> => {
  if (isSqlite()) {
    return assertSqliteWriteTransaction(trx);
  }
  await sql`select pg_advisory_xact_lock(${namespace}::int4, ${key}::int4)`.execute(trx);
};

/** Shared transaction-level lock: many holders at once, blocks (and is blocked by) the exclusive form. */
export const acquireXactLockShared = async (
  trx: Transaction<DB>,
  namespace: number,
  key: number,
): Promise<void> => {
  if (isSqlite()) {
    return assertSqliteWriteTransaction(trx);
  }
  await sql`select pg_advisory_xact_lock_shared(${namespace}::int4, ${key}::int4)`.execute(trx);
};
