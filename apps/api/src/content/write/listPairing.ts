import { createHash } from 'node:crypto';
import { ITEM_ID_FIELD, ITEM_ID_KEY, ITEM_ID_PATTERN } from '../../constants/itemIds.js';
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
  /**
   * Per sent item that is new, values it carries in storage form (by field ID) from the item another head the
   * caller may read shows under the ID it sent: through a schema version, the fields it cannot write there and
   * sent back exactly as that head shows them (lens/write.ts, `copiedFrom`). Nothing else is carried to a new item.
   */
  copied?: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>;
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
 * items a head the caller may read shows here that the draft no longer holds (`shownIds`). `notHere`: an ID no
 * head shows, sent while the write also replaces stored items (`deferredRefusals`).
 */
export type ListIssue = {
  index: number | null;
  code: ItemIssueCode;
  draftAhead?: boolean;
  notHere?: boolean;
};

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
 * An item ID the draft written does not hold at this position (plan item-ids). Decided from the caller's view,
 * the schema, the draft's IDs (membership only), and the IDs of the entry's heads the caller may read; never
 * from a value the caller cannot read. Any ID the draft holds pairs; malformed, repeated, and re-typed IDs, and an
 * ID two draft items share, answer as before.
 *
 * | caller sees the draft | list can hold values hidden from it | ID a readable head shows | ID no head shows  |
 * | --------------------- | ----------------------------------- | ------------------------ | ----------------- |
 * | yes                   | no                                  | new                      | new               |
 * | yes                   | yes                                 | new                      | see below *       |
 * | no                    | no                                  | new                      | new               |
 * | no                    | yes                                 | AMBIGUOUS_ITEMS          | UNKNOWN_ITEM_ID   |
 *
 * Always new: on an admin write (`neverRefuses`), for a caller that may read drafts (`readsDrafts`: it sees every
 * head, so what it sends replaces the draft's items as on main, as a deleted item's values go), and where nothing
 * is stored (`fresh`: under a new item, or a localized list of a new locale). "New" is a new ID with nothing
 * carried over, unless the item continues the one draft item no other sent item names that equals it in everything the caller sees, when that is certain
 * (`withForeignContinued`). On a list that holds nothing hidden from the caller a well-formed ID is never refused
 * (nothing can be lost). Where items can hold hidden values and the caller sees the draft, an ID no head shows
 * (a stale read, or an item copied from another entry or field) is new when every stored item is still claimed,
 * by an ID or by a match on what the caller sees (the write only adds items, so nothing hidden can be lost);
 * otherwise UNKNOWN_ITEM_ID (`deferredRefusals`), since the item it named may be one the write replaces, holding
 * values the caller cannot see, and reading again gives current IDs. Where the caller cannot see the draft, it is
 * UNKNOWN_ITEM_ID outright.
 * A caller that cannot see the draft (no draft access, the draft ahead) is refused rather than replace items it
 * never saw where they can hold what it cannot see (`AMBIGUOUS_ITEMS`, "replaces items this caller cannot read").
 * A caller that may read drafts always sees the draft. (*) New for a caller that may read drafts.
 */
const shownElsewhere = (policy: ListPolicy, index: number | null): ListIssue | null =>
  policy.unseen && policy.hidden && !policy.fresh && !policy.neverRefuses && !policy.readsDrafts
    ? { index, code: 'AMBIGUOUS_ITEMS', draftAhead: true }
    : null;

/** An ID no head of the entry shows (the table above): null when it is a new item, else the refusal. */
const shownNowhere = (policy: ListPolicy, id: string, index: number | null): ListIssue | null =>
  ITEM_ID_PATTERN.test(id) &&
  (policy.neverRefuses === true || policy.fresh === true || policy.readsDrafts === true || !policy.hidden)
    ? null
    : { index, code: 'UNKNOWN_ITEM_ID' };

/**
 * Whether the refusal of an ID no head shows waits for the content pairing (the table above): in a list, for a
 * caller that sees the draft, where items can hold hidden values. Decided from the policy and the ID's shape only.
 */
const defersUnknown = (policy: ListPolicy, id: string): boolean => ITEM_ID_PATTERN.test(id) && !policy.unseen;

/**
 * The deferred IDs (`defersUnknown`) still new after the content pairing, refused when some stored item is left
 * unclaimed (the write replaces it, with what it holds that the caller cannot see); none when every stored item
 * is claimed (the write only adds). Claims come from IDs and from what the caller sees, never from hidden values.
 */
const deferredRefusals = (pairs: readonly number[], deferred: readonly number[], storedCount: number) => {
  const claimed = new Set(pairs.filter((pair) => pair !== -1));
  const left = deferred.filter((index) => pairs[index] === -1);
  return claimed.size === storedCount
    ? []
    : left.map((index): ListIssue => ({ index, code: 'UNKNOWN_ITEM_ID', notHere: true }));
};

/**
 * The IDs the client sent that the draft holds pair with those items: certain. A repeated or re-typed ID is
 * refused, and so is an ID two stored items share (which one the client meant cannot be told). An ID the draft
 * lacks that the table above does not refuse is left to the content pairing (`pairByContent`), with the stored
 * items no sent ID claims; `id: null` and an item without an `id` are new.
 */
const resolveIds = (
  sides: ListSides,
  policy: ListPolicy,
): { pairs: number[]; issues: ListIssue[]; deferred: number[] } => {
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
  const deferred: number[] = [];
  const pairs = sides.sentIds.map((id, index) => {
    if (typeof id !== 'string') {
      return -1;
    }
    if ((sentCount.get(id) ?? 0) > 1) {
      issues.push({ index, code: 'DUPLICATE_ITEM_ID' });
      return -1;
    }
    const at = stored.get(id);
    if (at === undefined) {
      const shown = sides.shownIds?.has(id) === true;
      const refused = shared.has(id)
        ? { index, code: 'UNKNOWN_ITEM_ID' as const }
        : shown
          ? shownElsewhere(policy, null)
          : shownNowhere(policy, id, index);
      if (refused && !shared.has(id) && !shown && defersUnknown(policy, id)) {
        deferred.push(index);
      } else if (refused && !(refused.draftAhead && issues.some((issue) => issue.draftAhead))) {
        issues.push(refused);
      }
      return -1;
    }
    if (sides.sent.kinds[index] !== sides.stored.kinds[at]) {
      issues.push({ index, code: 'ITEM_COMPONENT_CHANGED' });
      return -1;
    }
    return at;
  });
  return { pairs, issues, deferred };
};

/** Whether keys were made for both sides of a list (`ListSide.keys`: one per item). */
const keyed = (sides: ListSides): boolean =>
  sides.sent.keys.length === sides.sentIds.length && sides.stored.keys.length === sides.storedIds.length;

/**
 * The one content pairing (plan item-ids): for a list sent without IDs, every item; for a list that names IDs,
 * every sent item whose ID the draft lacks (and the table accepts), against the stored items no sent ID claims.
 * In both: the same keys (what the caller sees of each item; whole items, targets it cannot see cut, where it
 * cannot see the draft but writes every field; none where it can do neither) and the same outcomes. Where nothing in the items is hidden from the caller, and on an admin write:
 * `pairCertain`. Where items can hold hidden values: `pairDistinct` (null: it cannot be certain). Without keys:
 * every item is new.
 */
const pairByContent = (
  sent: ListSide,
  stored: ListSide,
  policy: ListPolicy,
  hasKeys: boolean,
): number[] | null => {
  if (!hasKeys) {
    return sent.keys.map(() => -1);
  }
  return !policy.hidden || policy.neverRefuses ? pairCertain(sent, stored) : pairDistinct(sent, stored);
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
 * The one pairing of a written list (plan item-ids). First the IDs the draft holds (`resolveIds`, with the table
 * above for those it lacks); then every other sent item and every unclaimed stored item go through the one
 * content pairing (`pairByContent`). A list sent without any ID can be refused as a whole: where the caller cannot
 * see the stored items and they can hold values it cannot write (`unseenItemsPolicy`), and where items can hold
 * hidden values and the content pairing cannot be certain (`AMBIGUOUS_ITEMS`). In a list that names IDs, an item
 * the content pairing cannot place for certain is new.
 */
export const pairList = (sides: ListSides, policy: ListPolicy): { pairs: number[]; issues: ListIssue[] } => {
  const namesIds = sides.sentIds.some((id) => id !== undefined);
  if (sides.sentIds.length === 0) {
    return { pairs: [], issues: [] };
  }
  if (!namesIds) {
    const unseen = unseenItemsPolicy(policy, sides.sentIds.length);
    if (unseen.length > 0) {
      return { pairs: sides.sentIds.map(() => -1), issues: unseen };
    }
  }
  const resolved = namesIds
    ? resolveIds(sides, policy)
    : { pairs: sides.sentIds.map(() => -1), issues: [] as ListIssue[], deferred: [] as number[] };
  if (resolved.issues.length > 0) {
    return { pairs: resolved.pairs, issues: resolved.issues };
  }
  const claimed = new Set(resolved.pairs.filter((pair) => pair !== -1));
  // In a list that names IDs, only items whose ID is a string the draft lacks (and the table accepts) are matched
  // by content; `id: null` and an item without an `id` are new, as the client declared.
  const rest = resolved.pairs.flatMap((pair, index) =>
    pair === -1 && (!namesIds || typeof sides.sentIds[index] === 'string') ? [index] : [],
  );
  const free = sides.storedIds.flatMap((_, index) => (claimed.has(index) ? [] : [index]));
  const hasKeys = keyed(sides);
  const continued = pairByContent(
    { keys: rest.map((index) => (hasKeys ? (sides.sent.keys[index] ?? null) : null)), kinds: [] },
    { keys: free.map((index) => (hasKeys ? (sides.stored.keys[index] ?? null) : null)), kinds: [] },
    policy,
    hasKeys,
  );
  if (continued === null && !namesIds) {
    return { pairs: resolved.pairs, issues: [{ index: null, code: 'AMBIGUOUS_ITEMS' }] };
  }
  const pairs = [...resolved.pairs];
  continued?.forEach((at, position) => {
    if (at !== -1) {
      pairs[rest[position] as number] = free[at] as number;
    }
  });
  return { pairs, issues: deferredRefusals(pairs, resolved.deferred, sides.storedIds.length) };
};

/**
 * A single (not repeatable) component always continues the stored instance when its ID is not refused: its own ID,
 * or one the table above accepts (shown by another head the caller may read, or by none); never new while an
 * instance is stored. Without `shown` (no table), any other ID is unknown.
 */
export const pairSingle = (
  sentId: string | null | undefined,
  storedId: string | null,
  stored: boolean,
  shown: { ids: ReadonlySet<string>; policy: ListPolicy } | null = null,
): { pairs: number[]; issues: ListIssue[] } => {
  const continues = { pairs: [stored ? 0 : -1], issues: [] };
  if (typeof sentId !== 'string' || sentId === storedId) {
    return continues;
  }
  const refused = !shown
    ? ({ index: null, code: 'UNKNOWN_ITEM_ID' } as const)
    : shown.ids.has(sentId)
      ? shownElsewhere(shown.policy, null)
      : shownNowhere(shown.policy, sentId, null);
  return refused ? { pairs: [-1], issues: [refused] } : continues;
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

const NOT_HERE_MESSAGE =
  'is not an item of this list. If the list changed since you read it, read it again; to add an item copied from elsewhere, send it with "id": null.';

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
    : issue.notHere
      ? NOT_HERE_MESSAGE
      : issue.code === 'AMBIGUOUS_ITEMS' && unseen
        ? UNSEEN_MESSAGE
        : ITEM_MESSAGES[issue.code],
});
