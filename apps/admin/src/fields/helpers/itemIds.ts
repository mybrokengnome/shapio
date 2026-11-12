import { isUnparsed } from './unparsed';
import { CLIENT_KEY, COMPONENT_KEY, ITEM_ID_KEY, isRecord, withClientKey } from './values';

/**
 * Component item IDs in form values. A component item is a record carrying a client key (`__key`, given
 * by `withClientKey` to every item the form holds); its `id` is the server's stable ID for it. The form
 * keeps the IDs and sends them back, so the server pairs each sent item with the stored one it continues.
 */

const isItem = (value: Record<string, unknown>) => typeof value[CLIENT_KEY] === 'string';

type ItemMapper = (item: Record<string, unknown>) => Record<string, unknown>;

/** Rebuilds the value, passing every item (and the root record, when `rootIsItem`) through `onItem`. */
const mapItems = (value: unknown, onItem: ItemMapper, rootIsItem = false) => {
  const walk = (node: unknown, isRoot = false): unknown => {
    if (isUnparsed(node)) {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((child) => walk(child));
    }
    if (!isRecord(node)) {
      return node;
    }
    const children = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return isItem(node) || (isRoot && rootIsItem) ? onItem(children) : children;
  };
  return walk(value, true);
};

const renew: ItemMapper = (item) => {
  const { [ITEM_ID_KEY]: _id, [CLIENT_KEY]: _key, ...rest } = item;
  return withClientKey(rest);
};

/**
 * A copy of an item (a duplicate) as a new item: no `id` and a fresh client key, nested items included, so
 * the server creates them instead of moving the originals, and no client key is shared with the original.
 */
export const asNewItem = <T>(item: T): T => mapItems(item, renew, true) as T;

/** Every component item in a value (any field's) as a new item, like `asNewItem`; other values unchanged. */
export const asNewItems = <T>(value: T): T => mapItems(value, renew) as T;

/** The value without item IDs: for comparing content only (what a restore would change). */
export const withoutItemIds = (value: unknown): unknown =>
  mapItems(value, (item) => {
    const { [ITEM_ID_KEY]: _id, ...rest } = item;
    return rest;
  });

/**
 * The IDs the server gave the items of a save: each sent item's client key → the `id` of the item at the
 * same place in the saved values. The server keeps the order it was sent, so places match; a list whose
 * length differs, or an item whose component differs, is skipped.
 */
export const savedItemIds = (sent: unknown, saved: unknown): Map<string, string> => {
  const ids = new Map<string, string>();
  const pair = (left: unknown, right: unknown) => {
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length === right.length) {
        left.forEach((item, index) => pair(item, right[index]));
      }
      return;
    }
    if (!isRecord(left) || !isRecord(right) || isUnparsed(left)) {
      return;
    }
    if (isItem(left)) {
      if (left[COMPONENT_KEY] !== right[COMPONENT_KEY]) {
        return;
      }
      const id = right[ITEM_ID_KEY];
      if (typeof id === 'string') {
        ids.set(left[CLIENT_KEY] as string, id);
      }
    }
    for (const key of Object.keys(left)) {
      if (Object.hasOwn(right, key)) {
        pair(left[key], right[key]);
      }
    }
  };
  pair(sent, saved);
  return ids;
};

/**
 * The value with saved IDs given to the items that have none yet (found by client key), keeping every
 * client key so no item remounts. Returns the same object when nothing changes.
 */
export const withItemIds = <T>(value: T, ids: ReadonlyMap<string, string>): T => {
  if (ids.size === 0) {
    return value;
  }
  const walk = (node: unknown): unknown => {
    if (isUnparsed(node)) {
      return node;
    }
    if (Array.isArray(node)) {
      const next = node.map(walk);
      return next.every((item, index) => item === node[index]) ? node : next;
    }
    if (!isRecord(node)) {
      return node;
    }
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      next[key] = walk(child);
      changed ||= next[key] !== child;
    }
    const id =
      isItem(node) && node[ITEM_ID_KEY] === undefined ? ids.get(node[CLIENT_KEY] as string) : undefined;
    if (id !== undefined) {
      return { ...next, [ITEM_ID_KEY]: id };
    }
    return changed ? next : node;
  };
  return walk(value) as T;
};
