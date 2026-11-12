import { hash } from 'node:crypto';
import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import {
  ITEM_ID_CACHE_MAX_BYTES,
  ITEM_ID_CACHE_PROBATION_ENTRIES,
  ITEM_ID_CACHE_PROTECTED_ENTRIES,
} from '../constants/itemIds.js';
import type { ContentData } from '../db/contentData.js';
import { createSegmentedLru } from '../schema/lens/lru.js';
import {
  componentLookupOf,
  DerivedIdsExhausted,
  fieldValueWithItemIds,
  itemIdsBy,
  type ComponentLookup,
  type ItemIdScope,
} from './itemIds.js';

/**
 * The item ID cache (plan item-ids-perf): what reads derive for component instances stored without an ID (content
 * saved before 0.9.0), remembered per process so a repeated read of the same stored value skips the keyed hashing.
 *
 * Why an entry can never be stale: it is keyed by everything the derivation reads, never by which writer wrote the
 * value or when.
 * - the stored value itself: a SHA-256 of its JSON text as read (same text, same parsed value, same derivation);
 * - the instance key (one cache per key object) and the entry (the derivation's secret);
 * - the scope's locale (set for localized fields of localized content types, absent for shared ones);
 * - the top-level field (its ID, which is the walk's path, its type, cardinality and component);
 * - every part of the schema the walk reads below it: the content type's components, each with its component and
 *   zone fields (ID, type, cardinality, component).
 * Whatever writes `entry_heads.data` (or serves a revision), a value whose bytes differ gets another key. A changed
 * schema gets another key. What is cached is only the derived IDs, in the walk's order; replaying them through the
 * same walk (`fieldValueWithItemIds`) gives exactly what deriving gives (content/itemIdCache.test.ts).
 *
 * Only reads use it (content/read.ts). The write path derives as before, through the same walk, so a read and a
 * write always agree on an item's ID.
 */

type CachedIds = readonly string[];

/** Approximate bytes an entry holds: its key and IDs as UTF-16 strings, plus per-string and per-entry overhead. */
const weighEntry = (key: string, ids: CachedIds): number =>
  64 + key.length * 2 + ids.reduce((total, id) => total + 32 + id.length * 2, 0);

const createCache = () =>
  createSegmentedLru<string, CachedIds>(
    { probation: ITEM_ID_CACHE_PROBATION_ENTRIES, protected: ITEM_ID_CACHE_PROTECTED_ENTRIES },
    { weigh: weighEntry, maxWeight: ITEM_ID_CACHE_MAX_BYTES },
  );

type Cache = ReturnType<typeof createCache>;

/** One cache per instance key (the key read once per database, `itemIdKeyOf`). */
const caches = new WeakMap<Buffer, Cache>();

const cacheFor = (key: Buffer): Cache => {
  let cache = caches.get(key);
  if (!cache) {
    cache = createCache();
    caches.set(key, cache);
  }
  return cache;
};

let enabled = true;
const counters = { hits: 0, misses: 0, stored: 0, digests: 0 };

/** Turns the cache on or off (tests compare bodies with it on and off). On by default. */
export const setItemIdCacheEnabled = (on: boolean): void => {
  enabled = on;
};

export const isItemIdCacheEnabled = (): boolean => enabled;

/** Drops every cached entry of this key (tests). */
export const clearItemIdCache = (key: Buffer): void => {
  caches.get(key)?.clear();
};

/** What the cache did in this process so far (tests count work, never time it). */
export const itemIdCacheStats = (): Readonly<typeof counters> => ({ ...counters });

/** The cache of a key, for tests that inspect size, weight and segments. */
export const itemIdCacheOf = (key: Buffer): Cache => cacheFor(key);

const componentFieldSignature = (field: FieldDefinition): string =>
  field.type === 'component'
    ? `${field.id}:c:${field.settings.repeatable ? 1 : 0}:${field.settings.component}`
    : field.type === 'dynamiczone'
      ? `${field.id}:z`
      : '';

const isComponentField = (field: FieldDefinition) =>
  field.type === 'component' || field.type === 'dynamiczone';

/**
 * The part of a content type's schema the walk reads below a top-level field: every component it can look up,
 * with its component and zone fields. Memoized per components map (a schema snapshot builds each once).
 */
const signatures = new WeakMap<object, string>();

export const componentsSignatureOf = (
  components: ReadonlyMap<string, { definition: ComponentDefinition }>,
): string => {
  const known = signatures.get(components);
  if (known !== undefined) {
    return known;
  }
  const text = [...components.entries()]
    .map(
      ([id, { definition }]) =>
        `${id}=${definition.id}[${definition.fields.filter(isComponentField).map(componentFieldSignature).join(',')}]`,
    )
    .sort()
    .join(';');
  const signature = hash('sha256', text, 'base64url');
  signatures.set(components, signature);
  return signature;
};

/** The value's digest: a SHA-256 of its JSON text (one native serialization, one hash). */
const digestOf = (value: unknown): string => {
  counters.digests += 1;
  return hash('sha256', JSON.stringify(value) ?? 'undefined', 'base64url');
};

const keyOf = (signature: string, scope: ItemIdScope, field: FieldDefinition, value: unknown) =>
  `${signature}\u0000${scope.entryId}\u0000${scope.locale ?? ''}\u0000${componentFieldSignature(field)}\u0000${digestOf(value)}`;

/** The field's value with IDs replayed from `ids`, or undefined when they do not fit it exactly. */
const replayed = (
  scope: ItemIdScope,
  field: FieldDefinition,
  value: unknown,
  componentOf: ComponentLookup,
  ids: CachedIds,
): { value: unknown } | undefined => {
  const source = { replay: ids, next: 0 };
  try {
    const output = fieldValueWithItemIds(scope, field, value, componentOf, source);
    return source.next === ids.length ? { value: output } : undefined;
  } catch (error) {
    if (error instanceof DerivedIdsExhausted) {
      return undefined;
    }
    throw error;
  }
};

const cachedFieldValue = (
  cache: Cache,
  signature: string,
  componentOf: ComponentLookup,
  scope: ItemIdScope,
  field: FieldDefinition,
  value: unknown,
): unknown => {
  // Every instance stores its ID: nothing to derive, nothing to cache (the walk with no IDs to replay).
  const stored = replayed(scope, field, value, componentOf, []);
  if (stored) {
    return stored.value;
  }
  const key = keyOf(signature, scope, field, value);
  const ids = cache.get(key);
  if (ids) {
    const hit = replayed(scope, field, value, componentOf, ids);
    if (hit) {
      counters.hits += 1;
      return hit.value;
    }
  }
  counters.misses += 1;
  const record: string[] = [];
  const output = fieldValueWithItemIds(scope, field, value, componentOf, { record });
  cache.set(key, record);
  counters.stored += 1;
  return output;
};

/**
 * `withItemIds` (content/itemIds.ts) for a read: the same result, with the IDs of instances stored without one
 * taken from the cache when the same stored value was read before under the same schema and scope.
 */
export const withItemIdsCached = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  components: ReadonlyMap<string, { definition: ComponentDefinition }>,
  scope: ItemIdScope,
): ContentData => {
  const componentOf = componentLookupOf(components);
  if (!enabled) {
    return itemIdsBy(data, fields, scope, (fieldScope, field, value) =>
      fieldValueWithItemIds(fieldScope, field, value, componentOf),
    );
  }
  const cache = cacheFor(scope.key);
  const signature = componentsSignatureOf(components);
  return itemIdsBy(data, fields, scope, (fieldScope, field, value) =>
    cachedFieldValue(cache, signature, componentOf, fieldScope, field, value),
  );
};
