import { createHash } from 'node:crypto';
import { ITEM_ID_FIELD, ITEM_ID_KEY } from '../../constants/itemIds.js';
import { canonicalJson } from '../itemIds.js';
import { contentInvalid, pointer, type ContentIssue } from '../validator/issues.js';

/**
 * Which stored item each item of a written component list continues (delivery-api.md, "Writing components").
 * A component instance is written whole, so what a caller cannot see or write inside one is carried over from
 * the stored item it continues. That pairing is made exactly once per list per write, from what the caller sees
 * of each item, and every step that needs it (the lens's sent-back check, the carry-over of hidden, unknown and
 * unwritable fields) takes it as an argument and never pairs on its own.
 */
export type Pairing = {
  /**
   * Per sent item, the index of the stored item it continues, or -1 for a new item. A single (non-repeatable)
   * component has one entry: 0 when there is a stored instance.
   */
  pairs: readonly number[];
  /** Per sent item, the pairings of the component fields inside it, by field ID. */
  inside: ReadonlyArray<FieldPairings>;
};

/** Pairings of the component fields of one object (an entry, or a component instance), by field ID. */
export type FieldPairings = ReadonlyMap<string, Pairing>;

export const NO_PAIRINGS: FieldPairings = new Map();

/**
 * Items a carried-over list may hold (a list's own `max` when lower). A longer one is refused with the
 * validator's own `TOO_MANY`, checked with the body, before the write.
 */
export const CARRY_MAX_ITEMS = 50_000;

/** The `TOO_MANY` refusal the validator answers, for a list longer than the carry-over considers. */
export const listTooLong = (path: string, max: number) =>
  contentInvalid([{ path, code: 'TOO_MANY', message: `allows at most ${max} item(s)` }]);

/** The most items a list field may be written with when its items are paired: its `max`, at most the cap. */
export const listCapOf = (settings: unknown): number => {
  const max = (settings as { max?: unknown } | undefined)?.max;
  return typeof max === 'number' && max < CARRY_MAX_ITEMS ? max : CARRY_MAX_ITEMS;
};

let keysComputed = 0;

/**
 * The key an item is paired by: a SHA-256 of a canonical serialization of what the caller sees of it (keys sorted,
 * built without recursion, so no depth of a value can exhaust the stack). One pass over the item, whatever its
 * size; a cryptographic hash, so a body cannot be crafted to make two different items collide (a fast hash would
 * need a full comparison on every collision, which a crafted body could make quadratic).
 */
export const itemKey = (view: unknown): string => {
  keysComputed += 1;
  return createHash('sha256').update(canonicalJson(view)).digest('base64');
};

/**
 * Item keys computed in this process so far: how tests show a write did no work on its items (a stale version is
 * answered before any), by counting, never by timing.
 */
export const itemKeysComputed = (): number => keysComputed;

/** A compact canonical serialization: object keys sorted, no whitespace, at any depth. */
export const compactCanonical = (value: unknown): string => canonicalJson(value);

export type ItemIssueCode =
  'UNKNOWN_ITEM_ID' | 'DUPLICATE_ITEM_ID' | 'ITEM_COMPONENT_CHANGED' | 'AMBIGUOUS_ITEMS';

/**
 * A refusal of a written list: about one sent item (`index`), or the whole list (null). `draftAhead`: it names
 * items a head the caller may read shows here that the draft no longer holds (`shownIds`).
 */
export type ListIssue = { index: number | null; code: ItemIssueCode; draftAhead?: boolean };

/** One side of a written list: what the caller sees of each item, and the component each holds. */
export type ListSide = {
  /** Each item's key (what the caller sees of it); null: never matched by content. */
  keys: ReadonlyArray<string | null>;
  /** The component each item holds. */
  kinds: ReadonlyArray<string | null>;
};

/** One written list and the stored one it replaces. */
export type ListSides = {
  /**
   * The ID each sent item names: a string, null for an item sent as new (`id: null`), undefined when it sends
   * none. A list where any item names an ID or null is paired by IDs; otherwise it is aligned.
   */
  sentIds: ReadonlyArray<string | null | undefined>;
  sent: ListSide;
  /** Every stored item's ID (stored, or derived: `withItemIds`). */
  storedIds: ReadonlyArray<string | null>;
  stored: ListSide;
  /**
   * The IDs another head the caller may read on this route shows at this same position (`shownItemsAt`): for a
   * caller that reads the published head while the draft is ahead, the IDs that read gave it.
   */
  shownIds?: ReadonlySet<string>;
};

/** What decides whether a list may be refused, from the caller's view and the schema only (never values). */
export type ListPolicy = {
  /** The list's components can hold, at any depth, a value this caller cannot see (or, with no read, write). */
  hidden: boolean;
  /** The caller cannot see the stored items: it may not read the entry, the draft written, or a field above. */
  unseen: boolean;
  /** Never refused (admin writes): items continue stored ones only where that is certain, the rest are new. */
  neverRefuses?: boolean;
  /** Nothing is stored here or below (under a new item): nothing can be lost, so nothing is refused for it. */
  fresh?: boolean;
  /** The caller may read drafts on its route: the draft's items were never unseen by it (`shownElsewhere`). */
  readsDrafts?: boolean;
};

/**
 * A list written without item IDs by a caller that cannot see the items it replaces, when they can hold values
 * it cannot see: refused as a whole (owner decision pending; plan item-ids, decision 1). The one place that
 * decides it, so it can change in one place (the 0.8 behavior would carry nothing over instead).
 */
export const unseenItemsPolicy = (policy: ListPolicy, sentCount: number): ListIssue[] =>
  policy.unseen && policy.hidden && !policy.neverRefuses && sentCount > 0
    ? [{ index: null, code: 'AMBIGUOUS_ITEMS' }]
    : [];

/**
 * An ID the draft does not hold at this position, but which another head of the entry the caller may read shows
 * here (any locale; the published head while the draft has unpublished changes, another locale it copied from):
 * the server gave it to this caller, so it is never an unknown ID. The item is new (a new ID, nothing carried
 * over), as the list replaced on main, where nothing it can hold is hidden from the caller, where nothing is
 * stored (a new item, a localized list of a new locale), or for a caller that may read drafts (it saw the
 * draft's items: what it sends replaces them, as on main). Otherwise replacing the draft's items would drop what
 * the caller never saw: refused, saying why. Decided from the IDs of heads the caller may read, the draft's IDs
 * (membership only), and the schema; never from a value the caller cannot read.
 */
const shownElsewhere = (policy: ListPolicy, index: number | null): ListIssue | null =>
  policy.hidden && !policy.fresh && !policy.neverRefuses && !policy.readsDrafts
    ? { index, code: 'AMBIGUOUS_ITEMS', draftAhead: true }
    : null;

/**
 * Pairs by the IDs the client sent: certain; an unknown, repeated or re-typed ID is refused. A stored ID that two
 * stored items share names neither (it is unknown): which one the client meant cannot be told. An ID only a head
 * the caller may read holds here: `shownElsewhere`.
 */
const pairByIds = (sides: ListSides, policy: ListPolicy): { pairs: number[]; issues: ListIssue[] } => {
  const stored = new Map<string, number>();
  const shared = new Set<string>();
  sides.storedIds.forEach((id, index) => {
    if (id === null) {
      return;
    }
    if (stored.has(id)) {
      shared.add(id);
    } else {
      stored.set(id, index);
    }
  });
  shared.forEach((id) => stored.delete(id));
  const sentCount = new Map<string, number>();
  sides.sentIds.forEach((id) => {
    if (typeof id === 'string') {
      sentCount.set(id, (sentCount.get(id) ?? 0) + 1);
    }
  });
  const issues: ListIssue[] = [];
  const pairs = sides.sentIds.map((id, index) => {
    if (typeof id !== 'string') {
      return -1;
    }
    if ((sentCount.get(id) ?? 0) > 1) {
      issues.push({ index, code: 'DUPLICATE_ITEM_ID' });
      return -1;
    }
    const at = stored.get(id);
    if (at === undefined && !shared.has(id) && sides.shownIds?.has(id)) {
      const refused = shownElsewhere(policy, null);
      if (refused && !issues.some((issue) => issue.draftAhead)) {
        issues.push(refused);
      }
      return -1;
    }
    if (at === undefined) {
      issues.push({ index, code: 'UNKNOWN_ITEM_ID' });
      return -1;
    }
    if (sides.sent.kinds[index] !== sides.stored.kinds[at]) {
      issues.push({ index, code: 'ITEM_COMPONENT_CHANGED' });
      return -1;
    }
    return at;
  });
  return { pairs, issues };
};

/**
 * A list sent without IDs whose items can hold values the caller cannot see (plan item-ids, never guess): no
 * alignment at all. The sent list continues the stored one item by item when they are equal in everything the
 * caller sees (identity), and every item is new when nothing is stored; otherwise it is accepted only when every
 * item is distinct by what the caller sees, on
 * both sides, and the change only reorders, deletes, or only adds: an item equal to a stored one continues it
 * (wherever it moved), a stored item no sent item equals is deleted, a sent item no stored item equals is new
 * and carries nothing. Deleting and adding in one write, any edit, and any look-alikes in a changed list need
 * the items' IDs. Hashing and set comparison: O(n).
 */
const pairDistinct = (sent: ListSide, stored: ListSide): number[] | null => {
  // Nothing stored (a new list, or a list under a new item): every item is new, nothing to keep or move.
  if (stored.keys.length === 0) {
    return sent.keys.map(() => -1);
  }
  if (
    sent.keys.length === stored.keys.length &&
    sent.keys.every((key, index) => key !== null && key === stored.keys[index])
  ) {
    return sent.keys.map((_, index) => index);
  }
  const storedAt = new Map<string, number>();
  for (const [index, key] of stored.keys.entries()) {
    if (key === null || storedAt.has(key)) {
      return null;
    }
    storedAt.set(key, index);
  }
  const seen = new Set<string>();
  const pairs: number[] = [];
  for (const key of sent.keys) {
    if (key === null || seen.has(key)) {
      return null;
    }
    seen.add(key);
    pairs.push(storedAt.get(key) ?? -1);
  }
  const added = pairs.some((pair) => pair === -1);
  const deleted = pairs.filter((pair) => pair !== -1).length < stored.keys.length;
  return added && deleted ? null : pairs;
};

/** Both sides hold the same keys in the same order (none of them null). */
const sameKeys = (sent: ListSide, stored: ListSide) =>
  sent.keys.length > 0 &&
  sent.keys.length === stored.keys.length &&
  sent.keys.every((key, index) => key !== null && key === stored.keys[index]);

/**
 * Items paired only where that is certain (lists that hold nothing the caller cannot see, admin writes): the whole
 * list when it is sent exactly as stored, else each item whose key appears exactly once on each side; every other
 * item is new (a new ID), never an existing item's.
 */
const pairCertain = (sent: ListSide, stored: ListSide): number[] => {
  if (
    sent.keys.length === stored.keys.length &&
    sent.keys.every((key, index) => key !== null && key === stored.keys[index])
  ) {
    return sent.keys.map((_, index) => index);
  }
  const count = (keys: ReadonlyArray<string | null>) => {
    const counts = new Map<string, { count: number; at: number }>();
    keys.forEach((key, index) => {
      if (key !== null) {
        const known = counts.get(key);
        counts.set(key, { count: (known?.count ?? 0) + 1, at: known?.at ?? index });
      }
    });
    return counts;
  };
  const storedCounts = count(stored.keys);
  const sentCounts = count(sent.keys);
  return sent.keys.map((key) => {
    const onStored = key === null ? undefined : storedCounts.get(key);
    return key !== null && onStored?.count === 1 && sentCounts.get(key)?.count === 1 ? onStored.at : -1;
  });
};

/**
 * The one pairing of a written list (plan item-ids): by item ID when the client sends any. Without IDs:
 * - where the caller cannot see the stored items, a list that can hold a value it cannot write is refused without
 *   any comparison (`unseenItemsPolicy`); any other (it writes every field of every item) continues item by item
 *   when sent exactly as stored, whole items compared, and is new items otherwise;
 * - a list that can hold a value outside the caller's view continues only on certainty (`pairDistinct`), else
 *   it is refused;
 * - any other list (and every admin write) keeps an item's ID only where that is certain (`pairCertain`).
 */
export const pairList = (sides: ListSides, policy: ListPolicy): { pairs: number[]; issues: ListIssue[] } => {
  if (sides.sentIds.some((id) => id !== undefined)) {
    return pairByIds(sides, policy);
  }
  const none = sides.sentIds.map(() => -1);
  if (sides.sentIds.length === 0) {
    return { pairs: none, issues: [] };
  }
  if (policy.unseen) {
    const unseen = unseenItemsPolicy(policy, sides.sentIds.length);
    if (unseen.length > 0) {
      return { pairs: none, issues: unseen };
    }
    // Nothing compared but the whole items (keys given only for a list the caller can write in full): the same
    // list sent back continues item by item, a no-op as before item IDs; anything else is new items.
    return {
      pairs: sameKeys(sides.sent, sides.stored) ? sides.sentIds.map((_, index) => index) : none,
      issues: [],
    };
  }
  if (!policy.hidden || policy.neverRefuses) {
    return { pairs: pairCertain(sides.sent, sides.stored), issues: [] };
  }
  const pairs = pairDistinct(sides.sent, sides.stored);
  return pairs ? { pairs, issues: [] } : { pairs: none, issues: [{ index: null, code: 'AMBIGUOUS_ITEMS' }] };
};

/**
 * A single (not repeatable) component always continues the stored instance; an ID it sends must be that one's,
 * or one another head the caller may read shows there (`shownElsewhere`: a new instance, or refused).
 */
export const pairSingle = (
  sentId: string | null | undefined,
  storedId: string | null,
  stored: boolean,
  shown: { ids: ReadonlySet<string>; policy: ListPolicy } | null = null,
): { pairs: number[]; issues: ListIssue[] } => {
  if (typeof sentId !== 'string' || sentId === storedId) {
    return { pairs: [stored ? 0 : -1], issues: [] };
  }
  if (shown?.ids.has(sentId)) {
    const refused = shownElsewhere(shown.policy, null);
    return { pairs: [-1], issues: refused ? [refused] : [] };
  }
  return { pairs: [-1], issues: [{ index: null, code: 'UNKNOWN_ITEM_ID' }] };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An item's ID in a head read with every item's ID (`withItemIds`). */
const idOf = (item: unknown): string | null =>
  isRecord(item) && typeof item[ITEM_ID_KEY] === 'string' && item[ITEM_ID_KEY] !== ''
    ? item[ITEM_ID_KEY]
    : null;

/** Items other heads the caller may read show at one position, by item ID (each head's item with that ID). */
export type ShownItems = ReadonlyMap<string, ReadonlyArray<Readonly<Record<string, unknown>>>>;

/**
 * What the other heads the caller may read show at one position (a list, or a single component), by item ID:
 * empty where the caller does not read that position. `values`: each head's value there, items with their IDs.
 */
export const shownItemsAt = (values: readonly unknown[], reads: boolean): ShownItems => {
  const shown = new Map<string, Array<Readonly<Record<string, unknown>>>>();
  if (!reads) {
    return shown;
  }
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const id = idOf(item);
      if (id !== null && isRecord(item)) {
        shown.set(id, [...(shown.get(id) ?? []), item]);
      }
    }
  }
  return shown;
};

/**
 * The counterparts, in those heads, of a written item: the items they show under the ID sent, else under the ID
 * of the stored item it continues (the same parent chain, by ID).
 */
export const shownCounterparts = (
  shown: ShownItems,
  sentId: string | null | undefined,
  continued: unknown,
): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  const continuedId = idOf(continued);
  return (
    (typeof sentId === 'string' ? shown.get(sentId) : undefined) ??
    (continuedId === null ? undefined : shown.get(continuedId)) ??
    []
  );
};

const ITEM_MESSAGES: Readonly<Record<ItemIssueCode, string>> = {
  UNKNOWN_ITEM_ID:
    'is not the ID of an item this list holds; send back the id of each item as you read it, and leave the id out for a new item',
  DUPLICATE_ITEM_ID:
    "is sent for more than one item; send each item's id once, and leave the id out for a new item",
  ITEM_COMPONENT_CHANGED: 'names an item that holds another component; to replace the item, leave its id out',
  AMBIGUOUS_ITEMS:
    'cannot be matched to the stored items with certainty, and its items can hold values this caller cannot see; send back the id of each item as you read it (without IDs, a write may only reorder, delete, or add items that differ from each other, never edit one)',
};

// The "replaces items this caller cannot read" family, for IDs a published read gave while the draft is ahead.
const DRAFT_AHEAD_MESSAGE =
  'replaces items this caller cannot read (the entry has unpublished changes since what it read), and they can hold values it cannot see; leave the field out to keep it, or send an empty list to clear it';

const UNSEEN_MESSAGE =
  'replaces items this caller cannot read, and they can hold values it cannot see; send back the id of each item as you read it, leave the field out to keep it, or send an empty list to clear it';

/**
 * A list refusal as a `CONTENT_INVALID` issue: an item's at its `id` (`/cards/2/id`), the list's at the list.
 * `listPath` is a JSON pointer in the caller's API IDs; `unseen` words the list refusal for a caller that
 * cannot see the stored items.
 */
export const itemIssueOf = (
  issue: ListIssue,
  listPath: string,
  { unseen = false }: { unseen?: boolean } = {},
): ContentIssue => ({
  path:
    issue.code === 'AMBIGUOUS_ITEMS'
      ? listPath
      : pointer(issue.index === null ? listPath : pointer(listPath, issue.index), ITEM_ID_FIELD),
  code: issue.code,
  message: issue.draftAhead
    ? DRAFT_AHEAD_MESSAGE
    : issue.code === 'AMBIGUOUS_ITEMS' && unseen
      ? UNSEEN_MESSAGE
      : ITEM_MESSAGES[issue.code],
});
