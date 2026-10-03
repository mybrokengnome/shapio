/**
 * An in-process mutex per key: SQLite's stand-in for PostgreSQL session advisory locks (migrations, index
 * builds). It serialises holders inside one process only; SQLite deployments are single-process.
 */
const TAILS = new Map<string, Promise<void>>();

/** Runs `fn` while holding the lock for `key`; waiters run in arrival order. */
export const withKeyedMutex = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const previous = TAILS.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  TAILS.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (TAILS.get(key) === tail) {
      TAILS.delete(key);
    }
  }
};
