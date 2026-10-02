import { newStableId } from '@/helpers/stableId';

/**
 * Field values as the entry form holds them: keyed by API key, like the admin API. List items of
 * repeatable components and dynamic zones carry a client-only `__key` so React can keep each item's
 * state (collapsed, focus) across reorders and saves; it is stripped before anything is sent.
 */
export const CLIENT_KEY = '__key';
/** A dynamic-zone item's component API key (the API's `__component`). */
export const COMPONENT_KEY = '__component';

export type FormValues = Record<string, unknown>;
export type ItemValues = Record<string, unknown>;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rich text with no text and no image/table/rule is empty, like the server's `isEmptyRichText`. */
const isEmptyRichText = (value: Record<string, unknown>): boolean => {
  const doc = value.doc;
  if (!isRecord(doc)) {
    return true;
  }
  const content = Array.isArray(doc.content) ? (doc.content as unknown[]) : [];
  return content.every(
    (node) =>
      isRecord(node) &&
      node.type === 'paragraph' &&
      (!Array.isArray(node.content) || node.content.length === 0),
  );
};

/** Absent, null, empty text, empty list or empty rich text: the server does not store these. */
export const isEmptyValue = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (isRecord(value) && value.format === 'shapio-richtext') {
    return isEmptyRichText(value);
  }
  return false;
};

/** Deep structural equality for JSON-like values (key order does not matter). */
export const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => isDeepEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && isDeepEqual(left[key], right[key]))
    );
  }
  return false;
};

/** The value without client-only keys, ready to send or compare. */
export const stripClientKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripClientKeys);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== CLIENT_KEY)
        .map(([key, child]) => [key, stripClientKeys(child)]),
    );
  }
  return value;
};

/** Two values hold the same content (client keys and empty-vs-missing differences ignored). */
export const isSameContent = (left: unknown, right: unknown): boolean =>
  (isEmptyValue(left) && isEmptyValue(right)) || isDeepEqual(stripClientKeys(left), stripClientKeys(right));

export const withClientKey = (item: ItemValues): ItemValues => ({ ...item, [CLIENT_KEY]: newStableId() });

export const clientKeyOf = (item: unknown, fallback: number): string =>
  isRecord(item) && typeof item[CLIENT_KEY] === 'string' ? item[CLIENT_KEY] : `item-${fallback}`;

/** Moves an item within a list (keyboard reordering). Out-of-range moves return the list unchanged. */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= items.length || from === to) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
};

/** A list value as an array (a single value becomes a one-item list, empty becomes []). */
export const toList = <T = unknown>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }
  return value === undefined || value === null ? [] : [value as T];
};
