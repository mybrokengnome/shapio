import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The single writer (ADR 0001, "Dialect boundary"): SQLite allows one write transaction at a time, and a
 * second connection asking for it would block the whole event loop in `busy_timeout`. So every write in
 * this process queues here first, and only the holder talks to the write connection.
 *
 * On PostgreSQL, code inside a transaction may still write through the pool (another connection). On SQLite
 * that write would wait for the transaction that is waiting for it: a silent hang. Transactions therefore run
 * inside a `TransactionScope`, and a write that would queue behind its own enclosing write transaction fails
 * at once with `SqliteNestedWriteError` instead.
 */
export type TransactionScope = { holdsWriteLock: boolean; parent: TransactionScope | undefined };

const scopes = new AsyncLocalStorage<TransactionScope>();

/** Runs `fn` (a Kysely transaction, including its begin) in a fresh transaction scope. */
export const runInTransactionScope = <T>(fn: () => Promise<T>): Promise<T> =>
  scopes.run({ holdsWriteLock: false, parent: scopes.getStore() }, fn);

/** Whether `scope` or a transaction enclosing it holds the write lock. */
const insideWriter = (scope: TransactionScope | undefined): boolean => {
  for (let current = scope; current; current = current.parent) {
    if (current.holdsWriteLock) {
      return true;
    }
  }
  return false;
};

export const currentTransactionScope = (): TransactionScope | undefined => scopes.getStore();

export class SqliteNestedWriteError extends Error {
  constructor(statement: string) {
    super(
      'A write outside the open SQLite write transaction would wait for that transaction forever. ' +
        `Run it on the transaction (trx) instead: ${statement.slice(0, 200)}`,
    );
    this.name = 'SqliteNestedWriteError';
  }
}

export class WriteLock {
  #tail: Promise<void> = Promise.resolve();
  #holder: TransactionScope | undefined;

  /**
   * Waits for the write lock and returns its release function. `scope` is the transaction taking it (it
   * then holds the lock until commit or rollback), or undefined for one autocommit statement.
   */
  async acquire(statement: string, scope: TransactionScope | undefined): Promise<() => void> {
    if (this.#holder !== undefined && insideWriter(scopes.getStore())) {
      throw new SqliteNestedWriteError(statement);
    }
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.#holder = scope;
    if (scope) {
      scope.holdsWriteLock = true;
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      if (scope) {
        scope.holdsWriteLock = false;
      }
      this.#holder = undefined;
      release();
    };
  }
}
