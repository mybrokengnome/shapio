import { AsyncLocalStorage } from 'node:async_hooks';
import type { TransactionBuilder } from 'kysely';

/**
 * Nested pool acquisition (PostgreSQL and MySQL). Code inside a transaction that queries through the pool
 * (`db`) instead of the transaction (`trx`) holds one pooled connection while it waits for a second. When as
 * many requests as the pool has connections do that at once, each waits for the others forever. Strict mode
 * (tests) runs every transaction in a scope and fails such an acquisition at once with
 * `NestedPoolAcquireError`, the way SQLite fails a nested write (`db/sqlite/writeLock.ts`).
 */
type ConnectionScope = { acquired: boolean; parent: ConnectionScope | undefined };

const scopes = new AsyncLocalStorage<ConnectionScope>();

export class NestedPoolAcquireError extends Error {
  constructor() {
    super(
      'A query inside an open transaction asked the pool for a second connection; under load every ' +
        'connection waits for another. Run it on the transaction (trx) instead.',
    );
    this.name = 'NestedPoolAcquireError';
  }
}

const holdsConnection = (scope: ConnectionScope | undefined): boolean => {
  for (let current = scope; current; current = current.parent) {
    if (current.acquired) {
      return true;
    }
  }
  return false;
};

/**
 * Called by a driver before it takes a pooled connection. The first acquisition of a scope is the
 * transaction's own connection; any later one, or one inside a scope that already holds a connection, is
 * nested.
 */
export const assertNotNested = (): void => {
  const scope = scopes.getStore();
  if (!scope) {
    return;
  }
  if (holdsConnection(scope)) {
    throw new NestedPoolAcquireError();
  }
  scope.acquired = true;
};

/**
 * Runs `fn` as if no transaction were open: for work that does not belong to the enclosing transaction and
 * that it never waits for (notifications published at commit, a test's independent request).
 */
export const outsideConnectionScope = <T>(fn: () => T): T => scopes.exit(fn);

/** Runs every `execute` of a transaction builder (and of the builders it returns) in a connection scope. */
export const withConnectionScope = <DB>(builder: TransactionBuilder<DB>): TransactionBuilder<DB> =>
  new Proxy(builder, {
    get(target, property, receiver) {
      if (property === 'execute') {
        return <T>(callback: Parameters<TransactionBuilder<DB>['execute']>[0]) =>
          scopes.run(
            { acquired: false, parent: scopes.getStore() },
            () => target.execute(callback) as Promise<T>,
          );
      }
      if (property === 'setIsolationLevel' || property === 'setAccessMode') {
        return (value: never) => withConnectionScope(target[property](value));
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
