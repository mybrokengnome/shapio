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

export type LruSegment = 'probation' | 'protected';

/**
 * A segmented LRU (plan schema-lenses, review hardening): a new entry enters probation; read again (its
 * second use, the store being the first) it moves to protected. Eviction takes probation's least recently
 * used entry first; protected entries leave only when another promoted entry needs the room, and then drop
 * back to probation rather than out. So versions real clients keep reading stay cached while one-off
 * versions (a caller walking versions) churn among themselves in probation.
 */
export type SegmentedLru<K, V> = Lru<K, V> & {
  /** Whether the key is cached, without counting a use. */
  has: (key: K) => boolean;
  /** Every entry with its segment, least recently used first within each segment (tests). */
  entries: () => Array<[K, V, LruSegment]>;
};

/**
 * An optional weight budget for a segmented LRU (the item ID cache bounds itself by approximate bytes as well as
 * by entries): every entry weighs `weigh(key, value)`; past `maxWeight`, probation's least recently used entries
 * leave first, then protected's. An entry heavier than the whole budget is not stored.
 */
export type LruWeight<K, V> = { weigh: (key: K, value: V) => number; maxWeight: number };

export const createSegmentedLru = <K, V>(
  capacity: {
    probation: number;
    protected: number;
  },
  budget?: LruWeight<K, V>,
): SegmentedLru<K, V> & { readonly weight: number } => {
  const probation = new Map<K, V>();
  const protectedEntries = new Map<K, V>();
  const weights = new Map<K, number>();
  let weight = 0;
  const forget = (key: K) => {
    weight -= weights.get(key) ?? 0;
    weights.delete(key);
  };
  const overWeight = () => budget !== undefined && weight > budget.maxWeight;
  /**
   * Evicts down to the capacities and the budget, oldest first (deleting from a Map while iterating it is safe);
   * `keep`, the entry just stored, is never evicted for weight.
   */
  const trimProbation = (keep?: K) => {
    while (probation.size > capacity.probation) {
      const oldest = probation.keys().next();
      if (oldest.done) {
        break;
      }
      probation.delete(oldest.value);
      forget(oldest.value);
    }
    for (const candidate of probation.keys()) {
      if (!overWeight()) {
        return;
      }
      if (candidate !== keep) {
        probation.delete(candidate);
        forget(candidate);
      }
    }
    for (const candidate of protectedEntries.keys()) {
      if (!overWeight()) {
        return;
      }
      if (candidate !== keep) {
        protectedEntries.delete(candidate);
        forget(candidate);
      }
    }
  };
  const promote = (key: K, value: V) => {
    probation.delete(key);
    protectedEntries.set(key, value);
    while (protectedEntries.size > capacity.protected) {
      const oldest = protectedEntries.entries().next();
      if (oldest.done) {
        break;
      }
      const [demotedKey, demotedValue] = oldest.value;
      protectedEntries.delete(demotedKey);
      probation.set(demotedKey, demotedValue);
    }
    trimProbation();
  };
  const weigh = (key: K, value: V) => {
    if (!budget) {
      return;
    }
    forget(key);
    const entryWeight = budget.weigh(key, value);
    weights.set(key, entryWeight);
    weight += entryWeight;
  };
  return {
    get: (key) => {
      if (protectedEntries.has(key)) {
        const value = protectedEntries.get(key) as V;
        protectedEntries.delete(key);
        protectedEntries.set(key, value);
        return value;
      }
      if (probation.has(key)) {
        const value = probation.get(key) as V;
        promote(key, value);
        return value;
      }
      return undefined;
    },
    has: (key) => protectedEntries.has(key) || probation.has(key),
    set: (key, value) => {
      if (budget && budget.weigh(key, value) > budget.maxWeight) {
        probation.delete(key);
        protectedEntries.delete(key);
        forget(key);
        return;
      }
      weigh(key, value);
      if (protectedEntries.has(key)) {
        protectedEntries.delete(key);
        protectedEntries.set(key, value);
        trimProbation(key);
        return;
      }
      probation.delete(key);
      probation.set(key, value);
      trimProbation(key);
    },
    delete: (key) => {
      probation.delete(key);
      protectedEntries.delete(key);
      forget(key);
    },
    clear: () => {
      probation.clear();
      protectedEntries.clear();
      weights.clear();
      weight = 0;
    },
    get size() {
      return probation.size + protectedEntries.size;
    },
    get weight() {
      return weight;
    },
    entries: () => [
      ...[...probation].map(([key, value]): [K, V, LruSegment] => [key, value, 'probation']),
      ...[...protectedEntries].map(([key, value]): [K, V, LruSegment] => [key, value, 'protected']),
    ],
  };
};
