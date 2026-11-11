import { type ComponentDefinition, type DefinitionLens, type FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { newItemId, type ComponentLookup } from '../itemIds.js';
import { COMPONENT_KEY, isMissingValue } from '../validator/index.js';
import { contentInvalid, pointer } from '../validator/issues.js';
import { pairComponentItems, type ItemView } from './itemPairing.js';
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
 * - What is carried: the fields the caller cannot read. A caller that may not read the entry at all sees
 *   nothing, so only what it cannot write (deprecated fields) is carried: a sub-field it leaves out, or sends as
 *   an explicit null, is cleared, as for any field it writes.
 *
 * Admin writes carry nothing (admins read everything), but keep their items' IDs the same way.
 */
export type { ComponentLookup };

export type KeepOptions = {
  /** The caller may read the entry (default true). Without, comparisons use what it may write. */
  mayRead?: boolean;
  /** The body the patch was made from (today's API IDs): tells an explicit null from a field left out. */
  input?: Readonly<Record<string, unknown>>;
  /**
   * Through a schema lens: fields the client's version does not know or cannot write are carried too, and the
   * items are paired by the lens's write (`writeThroughLens`'s `pairings`, which must then be given).
   */
  lens?: DefinitionLens | null;
  /**
   * The pairing of every component value in the patch, made once from what the caller sees. Required through a
   * lens; without one, made here from `before` (refusals thrown as `CONTENT_INVALID`) when left out.
   */
  pairings?: FieldPairings;
  /** Carry nothing (admin writes): only the items' IDs are kept. */
  carryNothing?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const at = (value: unknown, index: number): unknown => (Array.isArray(value) ? value[index] : undefined);

/** Component fields, at any depth, a lens says the client does not know or cannot write: carried, never sent. */
export const lensCarriedIds = (lens: DefinitionLens | null | undefined): Set<string> => {
  const ids = new Set<string>();
  const seen = new Set<string>();
  const walk = (current: DefinitionLens, nested: boolean) => {
    if (seen.has(current.definitionId)) {
      return;
    }
    seen.add(current.definitionId);
    if (nested) {
      current.addedFieldIds.forEach((id) => ids.add(id));
    }
    for (const field of current.fields) {
      const writable = field.kind === 'same' && field.client.localized === field.stored.localized;
      if (nested && !writable) {
        ids.add(field.fieldId);
      }
      if (field.kind !== 'null') {
        for (const component of field.nested?.components.values() ?? []) {
          if (component) {
            walk(component, true);
          }
        }
      }
    }
  };
  if (lens) {
    walk(lens, false);
  }
  return ids;
};

type Rules = {
  componentOf: ComponentLookup;
  /** Carried from storage when the caller leaves it out. */
  carried: (field: FieldDefinition) => boolean;
  /** An explicit null clears (a caller that read nothing cannot have read the value it would keep). */
  nullClears: boolean;
};

const zoneComponentOf = (componentOf: ComponentLookup, item: unknown) =>
  isRecord(item) && typeof item[COMPONENT_KEY] === 'string' ? componentOf(item[COMPONENT_KEY]) : undefined;

const isListField = (field: FieldDefinition) =>
  (field.type === 'component' && field.settings.repeatable) || field.type === 'dynamiczone';

const isComponentField = (field: FieldDefinition) =>
  field.type === 'component' || field.type === 'dynamiczone';

/**
 * What a caller sees and cannot see of an item, for the pairing: reads only what it may read (deprecated
 * fields never); with no read access, nothing is seen and only what it cannot write is hidden.
 */
export const itemViewOf = (
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
  {
    mayRead = true,
    unseen = false,
    lensIds = new Set<string>(),
  }: {
    mayRead?: boolean;
    unseen?: boolean;
    lensIds?: ReadonlySet<string>;
  } = {},
): ItemView => ({
  componentOf,
  seen: (field) => mayRead && readable(field) && !lensIds.has(field.id),
  hidden: (field) => (mayRead ? !readable(field) : field.deprecated) || lensIds.has(field.id),
  unseen: unseen || !mayRead,
});

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

const missingPairing = (path: string) =>
  new Error(`A component value at ${path || '/'} was written without its item pairing`);

/** The ID a written instance keeps: the stored instance's it continues, else a new one. */
const idFor = (stored: unknown): string => {
  const id = isRecord(stored) ? stored[ITEM_ID_KEY] : undefined;
  return typeof id === 'string' && id !== '' ? id : newItemId();
};

/** One instance written over the stored instance it continues (or none: a new item, nothing carried). */
const keepInInstance = (
  rules: Rules,
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
  const output: Record<string, unknown> = { ...written, [ITEM_ID_KEY]: idFor(stored) };
  const sent = isRecord(raw) ? raw : {};
  for (const field of component.fields) {
    const storedValue = isRecord(stored) ? stored[field.id] : undefined;
    const explicitNull = Object.hasOwn(sent, field.apiKey) && isMissingValue(sent[field.apiKey]);
    if (rules.carried(field) && isMissingValue(output[field.id])) {
      if (!isMissingValue(storedValue) && !(rules.nullClears && explicitNull)) {
        output[field.id] = storedValue;
      }
    } else if (field.id in output) {
      output[field.id] = keepInValue(
        rules,
        field,
        output[field.id],
        storedValue,
        sent[field.apiKey],
        pairings,
        pointer(path, field.apiKey),
      );
    }
  }
  return output;
};

const keepInValue = (
  rules: Rules,
  field: FieldDefinition,
  written: unknown,
  stored: unknown,
  raw: unknown,
  pairings: FieldPairings,
  path: string,
): unknown => {
  if (!isComponentField(field) || (field.type === 'dynamiczone' && !Array.isArray(written))) {
    return written;
  }
  if (isMissingValue(written)) {
    return written;
  }
  const pairing = pairings.get(field.id);
  if (!pairing) {
    throw missingPairing(path);
  }
  if (field.type === 'component' && !Array.isArray(written)) {
    return keepInInstance(
      rules,
      rules.componentOf(field.settings.component),
      written,
      pairing.pairs[0] === 0 ? stored : undefined,
      raw,
      pairing.inside[0] ?? NO_PAIRINGS,
      path,
    );
  }
  const list = written as unknown[];
  const kept = Array.isArray(stored) ? stored.slice(0, CARRY_MAX_ITEMS) : [];
  return list.map((item: unknown, index) => {
    const pair = pairing.pairs[index] ?? -1;
    const component =
      field.type === 'component'
        ? rules.componentOf(field.settings.component)
        : zoneComponentOf(rules.componentOf, item);
    return keepInInstance(
      rules,
      component,
      item,
      pair === -1 ? undefined : kept[pair],
      at(raw, index),
      pairing.inside[index] ?? NO_PAIRINGS,
      pointer(path, index),
    );
  });
};

/**
 * `patch` (field IDs, storage form) with every component field the caller cannot read (or, through a lens,
 * does not know or cannot write) carried over from `before` (what the write starts from, every instance with
 * its ID: `withItemIds`), at any depth, each instance from the stored one `pairings` says it continues, and
 * every instance with its ID (the one it continues, or a new one). Top-level fields are untouched: a patch only
 * changes the fields it names.
 */
export const keepUnreadableComponentFields = (
  patch: Readonly<ContentData>,
  before: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  readable: (field: FieldDefinition) => boolean,
  options: KeepOptions = {},
): ContentData => {
  const mayRead = options.mayRead ?? true;
  if (options.lens && !options.pairings) {
    throw new Error('A write through a schema lens carries over along the pairing of its translation');
  }
  const lensIds = lensCarriedIds(options.lens);
  const rules: Rules = {
    componentOf,
    // What the caller cannot read; with no read access, what it cannot write (it sees nothing, so what it
    // leaves out of a field it may write is cleared, as for any field it writes).
    carried: options.carryNothing
      ? () => false
      : (field) => (mayRead ? !readable(field) : field.deprecated) || lensIds.has(field.id),
    nullClears: !mayRead,
  };
  let pairings = options.pairings;
  if (!pairings) {
    const result = pairComponentItems(patch, before, fields, itemViewOf(componentOf, readable, { mayRead }));
    if (result.issues.length > 0) {
      throw contentInvalid(result.issues);
    }
    pairings = result.pairings;
  }
  const input = options.input ?? {};
  const output: ContentData = { ...patch };
  for (const field of fields) {
    if (field.id in output && isComponentField(field)) {
      output[field.id] = keepInValue(
        rules,
        field,
        output[field.id],
        before[field.id],
        input[field.apiKey],
        pairings,
        pointer('', field.apiKey),
      );
    }
  }
  return output;
};
