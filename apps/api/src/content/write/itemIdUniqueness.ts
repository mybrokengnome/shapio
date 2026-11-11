import type { FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { componentOfItem, renewedItemId, type ComponentLookup } from '../itemIds.js';

/**
 * Item IDs are unique within one head's data (one locale's field tree, plan item-ids): a write continues an
 * item by its ID, so two instances under one ID could never be told apart. Data Shapio persists from a source
 * it did not make itself (an import bundle, an older revision restored or republished, a conversion, a copy)
 * may repeat an ID; the first instance keeps it and every later one gets a renewed ID, derived from the
 * repeated ID so the same data is renewed the same way wherever it is written (a draft and its published
 * version, a head and its revision, every locale of a shared field).
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const storedIdOf = (item: Readonly<Record<string, unknown>>): string | undefined => {
  const id = item[ITEM_ID_KEY];
  return typeof id === 'string' && id !== '' ? id : undefined;
};

type Visit = { fields: readonly FieldDefinition[]; container: Readonly<Record<string, unknown>> };

/** Every component instance under `fields` of `data`, at any depth, in a fixed order (without recursion). */
const instancesUnder = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
): Array<Readonly<Record<string, unknown>>> => {
  const found: Array<Readonly<Record<string, unknown>>> = [];
  const stack: Visit[] = [{ fields, container: data }];
  for (let visit = stack.pop(); visit; visit = stack.pop()) {
    const next: Visit[] = [];
    for (const field of visit.fields) {
      if (field.type !== 'component' && field.type !== 'dynamiczone') {
        continue;
      }
      const held = visit.container[field.id];
      for (const item of Array.isArray(held) ? held : [held]) {
        if (!isRecord(item)) {
          continue;
        }
        found.push(item);
        const component = componentOfItem(field, componentOf, item);
        if (component) {
          next.push({ fields: component.fields, container: item });
        }
      }
    }
    // Depth first, in field order: the stack takes the last pushed first.
    stack.push(...next.reverse());
  }
  return found;
};

/**
 * Every component instance of `data`, shared fields' (with everything inside them) first: they are the same in
 * every locale, so they keep their IDs over a localized repeat, and every locale renews them alike.
 */
const instancesOf = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
): Array<Readonly<Record<string, unknown>>> => [
  ...instancesUnder(
    data,
    fields.filter((field) => !field.localized),
    componentOf,
  ),
  ...instancesUnder(
    data,
    fields.filter((field) => field.localized),
    componentOf,
  ),
];

/** The renewed ID of every later instance repeating an ID, by instance; empty when every ID is unique. */
const renewals = (
  instances: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Map<Readonly<Record<string, unknown>>, string> => {
  const taken = new Set<string>();
  const repeated: Array<{ item: Readonly<Record<string, unknown>>; id: string }> = [];
  for (const item of instances) {
    const id = storedIdOf(item);
    if (id === undefined) {
      continue;
    }
    if (taken.has(id)) {
      repeated.push({ item, id });
    } else {
      taken.add(id);
    }
  }
  const renewed = new Map<Readonly<Record<string, unknown>>, string>();
  for (const { item, id } of repeated) {
    let attempt = 1;
    let candidate = renewedItemId(id, attempt);
    while (taken.has(candidate)) {
      attempt += 1;
      candidate = renewedItemId(id, attempt);
    }
    taken.add(candidate);
    renewed.set(item, candidate);
  }
  return renewed;
};

/** `container` with the renewed IDs, copying only what holds a renewed instance (component nesting is bounded). */
const rebuilt = (
  fields: readonly FieldDefinition[],
  container: Readonly<Record<string, unknown>>,
  renewed: ReadonlyMap<Readonly<Record<string, unknown>>, string>,
  componentOf: ComponentLookup,
): Readonly<Record<string, unknown>> => {
  let output: Record<string, unknown> | undefined;
  const instance = (field: FieldDefinition, item: unknown): unknown => {
    if (!isRecord(item)) {
      return item;
    }
    const component = componentOfItem(field, componentOf, item);
    const inner = component ? rebuilt(component.fields, item, renewed, componentOf) : item;
    const id = renewed.get(item);
    return id === undefined ? inner : { ...inner, [ITEM_ID_KEY]: id };
  };
  for (const field of fields) {
    if (field.type !== 'component' && field.type !== 'dynamiczone') {
      continue;
    }
    const held = container[field.id];
    const next = Array.isArray(held)
      ? held.map((item: unknown) => instance(field, item))
      : instance(field, held);
    const changed = Array.isArray(held)
      ? (next as unknown[]).some((item, index) => item !== held[index])
      : next !== held;
    if (changed) {
      output ??= { ...container };
      output[field.id] = next;
    }
  }
  return output ?? container;
};

/**
 * `data` (storage form, one head's) with every component instance's ID unique: the first instance with an ID
 * keeps it, a later one repeating it gets a renewed ID. `data` itself when every ID is already unique.
 */
export const withUniqueItemIds = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
): ContentData => {
  const renewed = renewals(instancesOf(data, fields, componentOf));
  return renewed.size === 0 ? data : rebuilt(fields, data, renewed, componentOf);
};
