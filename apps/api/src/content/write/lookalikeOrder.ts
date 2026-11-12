import type { FieldDefinition } from '@shapio/schema';
import type { ContentData } from '../../db/contentData.js';
import { canonicalJson, componentOfItem, type ComponentLookup } from '../itemIds.js';
import { valueWithoutItemIds } from '../withoutItemIds.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isComponentField = (field: FieldDefinition) =>
  field.type === 'component' || field.type === 'dynamiczone';

/**
 * `data` (storage form, every item with its ID) with the items of each component list that are identical in their
 * whole stored content (every value, hidden ones and nested items included, IDs left out) put in the order of
 * their serialized form, IDs included, among the places those items hold. Two saves that differ only in which of
 * two identical items carries which ID compare equal after it; any stored difference between the items, or any
 * other move, still shows. For the unchanged-save check (`isUnchangedSave`), never for what is stored.
 */
export const withLookalikesInIdOrder = (
  data: Readonly<ContentData>,
  fields: readonly FieldDefinition[],
  componentOf: ComponentLookup,
  seesAllStoredIn: (field: FieldDefinition) => boolean = () => true,
): ContentData => {
  const output: ContentData = { ...data };
  for (const field of fields) {
    if (isComponentField(field) && output[field.id] !== undefined) {
      output[field.id] = valueInIdOrder(field, output[field.id], componentOf, seesAllStoredIn);
    }
  }
  return output;
};

const itemInIdOrder = (
  field: FieldDefinition,
  item: unknown,
  componentOf: ComponentLookup,
  seesAllStoredIn: (field: FieldDefinition) => boolean,
): unknown => {
  const component = componentOfItem(field, componentOf, item);
  return component && isRecord(item)
    ? withLookalikesInIdOrder(item, component.fields, componentOf, seesAllStoredIn)
    : item;
};

/** A list's look-alikes in ID order, only where the caller sees everything stored in its items. */
const valueInIdOrder = (
  field: FieldDefinition,
  value: unknown,
  componentOf: ComponentLookup,
  seesAllStoredIn: (field: FieldDefinition) => boolean,
): unknown => {
  if (!Array.isArray(value)) {
    return itemInIdOrder(field, value, componentOf, seesAllStoredIn);
  }
  const items = value.map((item: unknown) => itemInIdOrder(field, item, componentOf, seesAllStoredIn));
  if (!seesAllStoredIn(field)) {
    return items;
  }
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = canonicalJson(valueWithoutItemIds(field, [item], componentOf));
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const output = [...items];
  for (const places of groups.values()) {
    if (places.length < 2) {
      continue;
    }
    const sorted = places
      .map((index) => ({ item: items[index], text: canonicalJson(items[index]) }))
      .sort((left, right) => (left.text < right.text ? -1 : left.text > right.text ? 1 : 0));
    places.forEach((place, at) => {
      output[place] = sorted[at]?.item;
    });
  }
  return output;
};
