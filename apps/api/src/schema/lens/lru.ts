/**
 * A small least-recently-used map: `get` refreshes an entry, `set` past `capacity` drops the oldest. Lens
 * views and compiled lenses are bounded with it, so a client walking versions cannot grow memory.
 */
export type Lru<K, V> = {
  get: (key: K) => V | undefined;
  set: (key: K, value: V) => void;
  delete: (key: K) => void;
  clear: () => void;
  readonly size: number;
};

export const createLru = <K, V>(capacity: number): Lru<K, V> => {
  const entries = new Map<K, V>();
  return {
    get: (key) => {
      if (!entries.has(key)) {
        return undefined;
      }
      const value = entries.get(key) as V;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set: (key, value) => {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done) {
          break;
        }
        entries.delete(oldest.value);
      }
    },
    delete: (key) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
};
