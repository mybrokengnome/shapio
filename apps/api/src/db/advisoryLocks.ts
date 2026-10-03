import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { sleep } from '../helpers/sleep.js';
import { isMysql, isSqlite } from './dialect.js';
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

/** MySQL: the `GET_LOCK` name of a (namespace, key) pair in this database (at most 64 characters). */
const mysqlLockName = (namespace: number, key: number) =>
  sql`concat('shapio:', left(sha2(database(), 256), 16), ':', ${namespace}, ':', ${key})`;

const mysqlSessionLock = <T>(
  db: Kysely<DB>,
  namespace: number,
  key: number,
  fn: () => Promise<T>,
  pollMs: number | undefined,
): Promise<T> =>
  db.connection().execute(async (connection) => {
    const name = mysqlLockName(namespace, key);
    const tryLock = async (timeout: number) =>
      String(
        (await sql<{ locked: unknown }>`select get_lock(${name}, ${timeout}) as locked`.execute(connection))
          .rows[0]?.locked,
      ) === '1';
    if (pollMs === undefined) {
      if (!(await tryLock(-1))) {
        throw new Error(`Could not take MySQL lock ${namespace}:${key}`);
      }
    } else {
      while (!(await tryLock(0))) {
        await sleep(pollMs);
      }
    }
    try {
      return await fn();
    } finally {
      await sql`select release_lock(${name})`.execute(connection);
    }
  });

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
  (isMysql() ? mysqlSessionLock(db, namespace, key, fn, undefined) : undefined) ??
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
  (isMysql() ? mysqlSessionLock(db, namespace, key, fn, pollMs) : undefined) ??
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

/** MySQL: an exclusive row lock on the pair's row (created if missing), held until commit or rollback. */
const mysqlExclusiveRowLock = async (trx: Transaction<DB>, namespace: number, key: number) => {
  await sql`insert into advisory_locks (namespace, lock_key) values (${namespace}, ${key})
    on duplicate key update lock_key = lock_key`.execute(trx);
};

/**
 * MySQL: a shared row lock on the pair's row. The first lock of a pair creates its row, which takes the
 * row exclusively for that one transaction (stronger than shared, so still correct).
 */
const mysqlSharedRowLock = async (trx: Transaction<DB>, namespace: number, key: number) => {
  const { rows } = await sql`select 1 from advisory_locks
    where namespace = ${namespace} and lock_key = ${key} for share`.execute(trx);
  if (rows.length === 0) {
    await mysqlExclusiveRowLock(trx, namespace, key);
  }
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
  if (isMysql()) {
    return mysqlExclusiveRowLock(trx, namespace, key);
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
  if (isMysql()) {
    return mysqlSharedRowLock(trx, namespace, key);
  }
  await sql`select pg_advisory_xact_lock_shared(${namespace}::int4, ${key}::int4)`.execute(trx);
};
