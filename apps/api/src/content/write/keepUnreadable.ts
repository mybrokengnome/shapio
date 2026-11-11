import { type ComponentDefinition, type DefinitionLens, type FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { matchesFieldType } from '../compiler/select.js';
import { newItemId, type ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { contentInvalid, pointer } from '../validator/issues.js';
import {
  ADMIN_ACCESS,
  callerViewOf,
  componentOfItem,
  lensFieldSet,
  type CallerAccess,
  type CallerView,
  type ViewScope,
} from './callerView.js';
import { pairComponentItems } from './itemPairing.js';
import { CARRY_MAX_ITEMS, listCapOf, listTooLong, NO_PAIRINGS, type FieldPairings } from './listPairing.js';

/**
 * A component instance is written whole, so a caller that cannot read one of its fields (private to its
 * audience, or deprecated), or through a schema version does not know it (added since) or cannot write it
 * (changed since), would wipe that field's stored value just by sending back what it read. Such fields are
 * carried over from the stored instance the written one continues, in storage form (never through today's
 * input validator), and every written instance keeps that instance's ID (plan item-ids):
 *
 * - Which stored instance each written one continues is decided once per write (`pairComponentItems`, or the
 *   write through a schema version), by the item IDs the client sent, else by what the caller sees of each item.
 * - A single component continues the stored instance. A list item continues the stored item it was paired
 *   with; any other item is new, carries nothing, and gets a new ID. Stored items no item continues are deleted
 *   with what they held.
 * - What is carried is the caller view's (`callerView.ts`): where the caller reads, the fields it cannot read or
 *   write; where it cannot (no read access, or a field above it cannot read), only what it cannot write, and an
 *   explicit null clears, as for any field it writes. Admin writes carry deprecated fields.
 * - A value the read cut down (relation targets or media the caller cannot see) sent back as read keeps what is
 *   behind it (`keepBehindRead`), at the top level and inside items. A value that no longer fits its field reads
 *   as empty and is written over like any other.
 */
export type { ComponentLookup };
export { lensFieldSet };

export type KeepOptions = {
  /** The caller's view. Without one, it is made from `readable` and the options below (tests, admin writes). */
  view?: CallerView;
  /** The caller may read the entry (default true). Without, comparisons use what it may write. */
  mayRead?: boolean;
  /** The body the patch was made from (today's API IDs): tells an explicit null from a field left out. */
  input?: Readonly<Record<string, unknown>>;
  /** Through a schema lens: the version's field set; its pairings must then be given. */
  lens?: DefinitionLens | null;
  /**
   * The pairing of every component value in the patch, made once from what the caller sees. Required through a
   * lens; without one, made here from `before` (refusals thrown as `CONTENT_INVALID`) when left out.
   */
  pairings?: FieldPairings;
  /** An admin write: reads and writes everything not deprecated, never refused, carries deprecated fields. */
  carryNothing?: boolean;
  /** Whether the caller may write a field inside a component (default: any field that is not deprecated). */
  writable?: (field: FieldDefinition) => boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[index] : undefined);

const isListField = (field: FieldDefinition) =>
  (field.type === 'component' && field.settings.repeatable) || field.type === 'dynamiczone';

const isComponentField = (field: FieldDefinition) =>
  field.type === 'component' || field.type === 'dynamiczone';

const zoneComponentOf = (componentOf: ComponentLookup, item: unknown) =>
  isRecord(item) && typeof item[COMPONENT_KEY] === 'string' ? componentOf(item[COMPONENT_KEY]) : undefined;

/**
 * A caller view from the older options (a reader's component-field check, whether it may read the entry, a
 * write check): for tests and callers that do not build a `CallerAccess` themselves.
 */
export const itemViewOf = (
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
  {
    mayRead = true,
    unseen = false,
    topLevelReadable = () => true,
    writable = (field) => !field.deprecated,
    lens = null,
  }: {
    mayRead?: boolean;
    unseen?: boolean;
    topLevelReadable?: (field: FieldDefinition) => boolean;
    writable?: (field: FieldDefinition) => boolean;
    lens?: DefinitionLens | null;
  } = {},
): CallerView => {
  const access: CallerAccess = {
    mayRead,
    seesStored: !unseen,
    readsField: (field) => !field.deprecated && topLevelReadable(field),
    readsComponentField: (field) => !field.deprecated && readable(field),
    writesComponentField: (field) => !field.deprecated && writable(field),
    visibleTargets: null,
    visibleMedia: null,
    neverRefuses: false,
  };
  return callerViewOf(access, componentOf, lensFieldSet(lens));
};

// ---------------------------------------------------------------------------------------------------------
// List sizes: checked with the body, before the write.
// ---------------------------------------------------------------------------------------------------------

const assertCapsIn = (
  componentOf: ComponentLookup,
  fields: readonly FieldDefinition[],
  value: unknown,
  path: string,
): void => {
  if (!isRecord(value)) {
    return;
  }
  for (const field of fields) {
    const written = value[field.id];
    if (!isComponentField(field) || written === undefined) {
      continue;
    }
    const fieldPath = pointer(path, field.apiKey);
    if (isListField(field) && Array.isArray(written)) {
      const cap = listCapOf(field.settings);
      if (written.length > cap) {
        throw listTooLong(fieldPath, cap);
      }
    }
    const items = Array.isArray(written) ? written : [written];
    items.forEach((item: unknown, index) => {
      const component =
        field.type === 'component'
          ? componentOf(field.settings.component)
          : zoneComponentOf(componentOf, item);
      if (component) {
        assertCapsIn(
          componentOf,
          component.fields,
          item,
          Array.isArray(written) ? pointer(fieldPath, index) : fieldPath,
        );
      }
    });
  }
};

/**
 * Every component list and dynamic zone in `patch` (storage form, at any depth) holds at most the items a
 * write pairs (`CARRY_MAX_ITEMS`, or the field's `max` when lower); a longer one is refused with the
 * validator's `TOO_MANY`, its path in today's API IDs. Run with the body, before the write.
 */
export const assertComponentListCaps = (
  patch: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
): void => assertCapsIn(componentOf, fields, patch, '');

// ---------------------------------------------------------------------------------------------------------
// The carry-over and the items' IDs, along a pairing made once.
// ---------------------------------------------------------------------------------------------------------

/** The ID a written instance keeps: the stored instance's it continues, else a new one. */
const idFor = (stored: unknown): string => {
  const id = isRecord(stored) ? stored[ITEM_ID_KEY] : undefined;
  return typeof id === 'string' && id !== '' ? id : newItemId();
};

/**
 * A many-relation or multiple-media value written over a stored one some of whose targets the read left out:
 * the targets the caller can see follow what it sent, the ones it cannot are kept. Each kept target stays right
 * after the nearest target before it (in stored order) that the read showed and the caller sent again, else at
 * the start, in stored order; a target the caller sent itself is not added twice.
 */
const mergeHiddenTargets = (
  sent: readonly unknown[],
  stored: readonly unknown[],
  shown: ReadonlySet<unknown>,
) => {
  const sentSet = new Set(sent);
  const leading: unknown[] = [];
  const after = new Map<unknown, unknown[]>();
  let anchor: unknown = undefined;
  let anchored = false;
  for (const id of stored) {
    if (shown.has(id)) {
      if (sentSet.has(id)) {
        anchor = id;
        anchored = true;
      }
    } else if (!sentSet.has(id)) {
      if (anchored) {
        after.set(anchor, [...(after.get(anchor) ?? []), id]);
      } else {
        leading.push(id);
      }
    }
  }
  const output = [...leading];
  for (const id of sent) {
    output.push(id);
    const group = after.get(id);
    if (group) {
      output.push(...group);
      after.delete(id);
    }
  }
  return output;
};

/**
 * A value written over a stored one the read at `scope` cut down (relation targets or media the caller cannot
 * see): sent back as read, the stored value stays; a many-relation or multiple media keeps the targets the caller
 * cannot see (`mergeHiddenTargets`). Anything else (a stored value that no longer fits its field included) is
 * written as sent.
 */
export const keepBehindRead = (
  view: CallerView,
  scope: ViewScope,
  field: FieldDefinition,
  sent: unknown,
  stored: unknown,
): unknown => {
  if (!scope.reads || isMissingValue(stored)) {
    return sent;
  }
  if (!matchesFieldType(field, stored)) {
    // A stored value that no longer fits its field reads as empty and is simply written over, as before item IDs:
    // kept, it would fail validation on every later write.
    return sent;
  }
  if (field.type !== 'relation' && field.type !== 'media') {
    return sent;
  }
  const many =
    field.type === 'relation' ? field.settings.cardinality === 'many' : Boolean(field.settings.multiple);
  const shown = view.shownValue(scope, field, stored);
  if (!many) {
    return shown === undefined && isMissingValue(sent) ? stored : sent;
  }
  // A many-relation stored as one ID (hand-edited data) is read as a list of one.
  const storedIds: unknown[] = Array.isArray(stored) ? stored : [stored];
  const shownIds = new Set(Array.isArray(shown) ? shown : []);
  if (storedIds.every((id) => shownIds.has(id))) {
    return sent;
  }
  if (!isMissingValue(sent) && !Array.isArray(sent)) {
    return sent;
  }
  return mergeHiddenTargets(Array.isArray(sent) ? sent : [], storedIds, shownIds);
};

type Carry = { view: CallerView; pairings: FieldPairings };

/** One instance written over the stored instance it continues (or none: a new item, nothing carried). */
const keepInInstance = (
  carry: Carry,
  scope: ViewScope,
  component: ComponentDefinition | undefined,
  written: unknown,
  stored: unknown,
  raw: unknown,
  pairings: FieldPairings,
  path: string,
): unknown => {
  if (!component || !isRecord(written)) {
    return written;
  }
  const { view } = carry;
  const output: Record<string, unknown> = { ...written, [ITEM_ID_KEY]: idFor(stored) };
  const sent = isRecord(raw) ? raw : {};
  const continues = isRecord(stored);
  if (continues) {
    // What a field removed since left in the item stays, as it does at the top level (a write names fields, and no
    // caller can name a removed one): sending an item back as read changes nothing.
    const known = new Set(component.fields.map((field) => field.id));
    for (const [key, value] of Object.entries(stored)) {
      if (!known.has(key) && key !== ITEM_ID_KEY && key !== COMPONENT_KEY && !(key in output)) {
        output[key] = value;
      }
    }
  }
  for (const field of component.fields) {
    const storedValue = continues ? stored[field.id] : undefined;
    const explicitNull = Object.hasOwn(sent, field.apiKey) && isMissingValue(sent[field.apiKey]);
    if (view.carried(scope, field) && isMissingValue(output[field.id])) {
      if (!isMissingValue(storedValue) && !(!scope.reads && explicitNull)) {
        output[field.id] = storedValue;
      }
    } else if (isComponentField(field)) {
      if (field.id in output) {
        output[field.id] = keepInValue(
          carry,
          view.inside(scope, field, false),
          field,
          output[field.id],
          storedValue,
          sent[field.apiKey],
          pairings,
          pointer(path, field.apiKey),
        );
      }
    } else if (continues && view.shows(scope, field)) {
      const kept = keepBehindRead(view, scope, field, output[field.id], storedValue);
      if (kept !== output[field.id]) {
        output[field.id] = kept;
      }
    }
  }
  return output;
};

const keepInValue = (
  carry: Carry,
  scope: ViewScope,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  raw: unknown,
  pairings: FieldPairings,
  path: string,
): unknown => {
  const pairing = pairings.get(field.id);
  // A value of the wrong shape is never paired: it goes on as sent, for the validator to refuse.
  if (!pairing || isMissingValue(written)) {
    return written;
  }
  const { view } = carry;
  if (field.type === 'component' && !field.settings.repeatable) {
    if (!isRecord(written)) {
      return written;
    }
    return keepInInstance(
      carry,
      scope,
      view.componentOf(field.settings.component),
      written,
      pairing.pairs[0] === 0 ? stored : undefined,
      raw,
      pairing.inside[0] ?? NO_PAIRINGS,
      path,
    );
  }
  if (!Array.isArray(written)) {
    return written;
  }
  const kept = Array.isArray(stored) ? stored.slice(0, CARRY_MAX_ITEMS) : [];
  return written.map((item: unknown, index) => {
    const pair = pairing.pairs[index] ?? -1;
    return keepInInstance(
      carry,
      scope,
      componentOfItem(field, item, view.componentOf),
      item,
      pair === -1 ? undefined : kept[pair],
      at(raw, index),
      pairing.inside[index] ?? NO_PAIRINGS,
      pointer(path, index),
    );
  });
};

/**
 * `patch` (field IDs, storage form) with every component field the caller cannot see carried over from `before`
 * (what the write starts from, every instance with its ID: `withItemIds`), at any depth, each instance from the
 * stored one `pairings` says it continues, every instance with its ID (the one it continues, or a new one), and
 * values the read cut down kept behind what was sent back (`keepBehindRead`). Top-level fields the patch does not
 * name are untouched: a patch only changes the fields it names.
 */
export const keepUnreadableComponentFields = (
  patch: Readonly<ContentData>,
  before: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
  options: KeepOptions = {},
): ContentData => {
  if (options.lens && !options.pairings) {
    throw new Error('A write through a schema lens carries over along the pairing of its translation');
  }
  const view =
    options.view ??
    (options.carryNothing
      ? callerViewOf(ADMIN_ACCESS, componentOf)
      : itemViewOf(componentOf, readable, {
          mayRead: options.mayRead ?? true,
          ...(options.writable ? { writable: options.writable } : {}),
          lens: options.lens ?? null,
        }));
  let pairings = options.pairings;
  if (!pairings) {
    const result = pairComponentItems(patch, before, fields, view);
    if (result.issues.length > 0) {
      throw contentInvalid(result.issues);
    }
    pairings = result.pairings;
  }
  const carry: Carry = { view, pairings };
  const input = options.input ?? {};
  const output: ContentData = { ...patch };
  for (const field of fields) {
    if (!(field.id in output)) {
      continue;
    }
    const scope = view.inside(view.top, field, true);
    if (isComponentField(field)) {
      output[field.id] = keepInValue(
        carry,
        scope,
        field,
        output[field.id],
        before[field.id],
        input[field.apiKey],
        pairings,
        pointer('', field.apiKey),
      );
    } else if (scope.reads) {
      const kept = keepBehindRead(view, scope, field, output[field.id], before[field.id]);
      if (kept !== output[field.id]) {
        output[field.id] = kept;
      }
    }
  }
  return output;
};
