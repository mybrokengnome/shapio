/**
 * Item IDs (plan item-ids): the storage key of a component instance's ID, beside `__component`, and the key
 * every API shows it under.
 */
export const ITEM_ID_KEY = '__id';
export const ITEM_ID_FIELD = 'id';
/** The shape of an item ID Shapio makes (`newItemId`, and the IDs derived for items stored without one). */
export const ITEM_ID_PATTERN = /^[0-9A-Za-z]{12}$/;
