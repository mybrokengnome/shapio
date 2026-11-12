import type { FieldDefinition } from '@shapio/schema';
import { ITEM_ID_KEY, type ComponentLookup } from './itemIds.js';
import { COMPONENT_KEY } from './validator/index.js';

/**
 * A stored value with every component instance's ID (`__id`, plan item-ids) removed, at any depth, by the
 * schema: only component and zone items lose the key, so a `json` field holding a `__id` of its own is left
 * as it is. For callers that compare content (a review diff) or move items to where their IDs mean nothing
 * (a translation proposed for another locale). Values that do not match their field are returned as they are.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const withoutInstanceId = (
  fields: readonly FieldDefinition[] | undefined,
  item: unknown,
  componentOf: ComponentLookup,
): unknown => {
  if (!isRecord(item)) {
    return item;
  }
  const { [ITEM_ID_KEY]: _id, ...rest } = item;
  return fields ? fieldsWithoutItemIds(fields, rest, componentOf) : rest;
};

/** One field's value without item IDs. */
export const valueWithoutItemIds = (
  field: FieldDefinition,
  value: unknown,
  componentOf: ComponentLookup,
): unknown => {
  if (field.type === 'component') {
    const fields = componentOf(field.settings.component)?.fields;
    return Array.isArray(value)
      ? value.map((item: unknown) => withoutInstanceId(fields, item, componentOf))
      : withoutInstanceId(fields, value, componentOf);
  }
  if (field.type === 'dynamiczone' && Array.isArray(value)) {
    return value.map((item: unknown) =>
      withoutInstanceId(
        isRecord(item) && typeof item[COMPONENT_KEY] === 'string'
          ? componentOf(item[COMPONENT_KEY])?.fields
          : undefined,
        item,
        componentOf,
      ),
    );
  }
  return value;
};

/** A stored document (or component item) without item IDs on the instances its `fields` hold. */
export function fieldsWithoutItemIds(
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  componentOf: ComponentLookup,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if ((field.type === 'component' || field.type === 'dynamiczone') && data[field.id] !== undefined) {
      output[field.id] = valueWithoutItemIds(field, data[field.id], componentOf);
    }
  }
  return output;
}
