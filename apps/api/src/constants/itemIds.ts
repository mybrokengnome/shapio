/**
 * Item IDs (plan item-ids): the storage key of a component instance's ID, beside `__component`, and the key
 * every API shows it under.
 */
export const ITEM_ID_KEY = '__id';
export const ITEM_ID_FIELD = 'id';
/** The shape of an item ID Shapio makes (`newItemId`, and the IDs derived for items stored without one). */
export const ITEM_ID_PATTERN = /^[0-9A-Za-z]{12}$/;

/**
 * The item ID cache (content/itemIdCache.ts), per process: entries (one per top-level component field value of a
 * head or revision read that had IDs to derive) in each segment, and an approximate byte budget for all of them.
 */
export const ITEM_ID_CACHE_PROBATION_ENTRIES = 20_000;
export const ITEM_ID_CACHE_PROTECTED_ENTRIES = 20_000;
export const ITEM_ID_CACHE_MAX_BYTES = 32 * 1024 * 1024;
