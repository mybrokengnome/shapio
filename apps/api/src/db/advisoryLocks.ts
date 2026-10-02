import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import { sleep } from '../helpers/sleep.js';
import type { DB } from './types.js';

/**
 * PostgreSQL advisory-lock primitives. Kept in `db/` beside the Kysely instance so no other module
 * writes lock SQL. Keys are (namespace, key) int4 pairs; see constants/lockKeys.ts.
 */

/** Stable 32-bit signed key for a string ID (e.g. a model UUID). Collisions only cost extra serialization. */
export const lockKeyFromId = (id: string): number => createHash('sha256').update(id).digest().readInt32BE(0);

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
 * its own job holds the lock — a wait cycle PostgreSQL does not detect.
 */
export const withPolledSessionAdvisoryLock = async <T>(
  db: Kysely<DB>,
  namespace: number,
  key: number,
  fn: () => Promise<T>,
  pollMs = 200,
): Promise<T> =>
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

/** Exclusive transaction-level lock, released at commit/rollback. */
export const acquireXactLock = async (
  trx: Transaction<DB>,
  namespace: number,
  key: number,
): Promise<void> => {
  await sql`select pg_advisory_xact_lock(${namespace}::int4, ${key}::int4)`.execute(trx);
};

/** Shared transaction-level lock: many holders at once, blocks (and is blocked by) the exclusive form. */
export const acquireXactLockShared = async (
  trx: Transaction<DB>,
  namespace: number,
  key: number,
): Promise<void> => {
  await sql`select pg_advisory_xact_lock_shared(${namespace}::int4, ${key}::int4)`.execute(trx);
};
