import type { MediaAsset } from '@shapio/client';
import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import {
  COMPONENT_KEY,
  isEmptyValue,
  isRecord,
  isSameContent,
  stripClientKeys,
  withClientKey,
  type FormValues,
  type ItemValues,
} from './values';

/**
 * Conversion between the admin API's entry data and the form's values. Reads return media fields as asset
 * views (`{ id, url, ... }`); the form and every write use asset IDs, so editors (custom ones included)
 * always see the same value the server validates.
 */
export type ComponentLookup = ReadonlyMap<string, ComponentDefinition>;

type Collect = (asset: MediaAsset) => void;

const isAssetView = (value: unknown): value is MediaAsset =>
  isRecord(value) && typeof value.id === 'string' && typeof value.url === 'string';

const mediaIdOf = (value: unknown, collect: Collect | undefined): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (isAssetView(value)) {
    collect?.(value);
    return value.id;
  }
  return null;
};

export const liveFields = (fields: readonly FieldDefinition[]) => fields.filter((field) => !field.deprecated);

const componentOfItem = (
  field: FieldDefinition<'dynamiczone'>,
  item: ItemValues,
  components: ComponentLookup,
): ComponentDefinition | undefined =>
  field.settings.components
    .map((id) => components.get(id))
    .find((component) => component?.apiKey === item[COMPONENT_KEY]);

const fromApiValue = (
  field: FieldDefinition,
  value: unknown,
  components: ComponentLookup,
  collect: Collect | undefined,
): unknown => {
  if (value === undefined || value === null) {
    return null;
  }
  switch (field.type) {
    case 'media':
      return Array.isArray(value)
        ? value.map((item) => mediaIdOf(item, collect)).filter((id): id is string => id !== null)
        : mediaIdOf(value, collect);
    case 'component': {
      const component = components.get(field.settings.component);
      const convert = (item: unknown) =>
        withClientKey(
          component && isRecord(item) ? toFormValues(component.fields, item, components, collect) : {},
        );
      return field.settings.repeatable ? (Array.isArray(value) ? value.map(convert) : []) : convert(value);
    }
    case 'dynamiczone':
      return (Array.isArray(value) ? value : []).filter(isRecord).map((item) => {
        const component = componentOfItem(field, item, components);
        return withClientKey({
          [COMPONENT_KEY]: item[COMPONENT_KEY],
          ...(component ? toFormValues(component.fields, item, components, collect) : {}),
        });
      });
    default:
      return value;
  }
};

/** API data (one model or component level) → form values. `collect` receives every media asset view seen. */
export function toFormValues(
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  components: ComponentLookup,
  collect?: Collect,
): FormValues {
  const values: FormValues = {};
  for (const field of liveFields(fields)) {
    values[field.apiKey] = fromApiValue(field, data[field.apiKey], components, collect);
  }
  return values;
}

/** Initial values for a new entry or component item: each field's default, or empty. */
export const defaultFormValues = (fields: readonly FieldDefinition[]): FormValues =>
  Object.fromEntries(
    liveFields(fields).map((field) => [field.apiKey, structuredClone(field.defaultValue ?? null) as unknown]),
  );

export const newComponentItem = (component: ComponentDefinition, zoned: boolean): ItemValues =>
  withClientKey({
    ...(zoned ? { [COMPONENT_KEY]: component.apiKey } : {}),
    ...defaultFormValues(component.fields),
  });

/** A form value as the API takes it: client keys stripped, empty values sent as null (= clear). */
export const toInputValue = (value: unknown): unknown =>
  isEmptyValue(value) ? null : stripClientKeys(value);

/** Top-level API keys whose value differs from the baseline (what the last load or save returned). */
export const dirtyKeysOf = (values: FormValues, baseline: FormValues): string[] =>
  Object.keys(values).filter((key) => !isSameContent(values[key], baseline[key]));

/** The PUT body's `data`: changed fields only (the API treats it as a patch). */
export const buildPatch = (values: FormValues, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((key) => [key, toInputValue(values[key])]));

/** Every non-empty value, for creating an entry. */
export const buildCreateData = (values: FormValues): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => !isEmptyValue(value))
      .map(([key, value]) => [key, stripClientKeys(value)]),
  );

/**
 * After a save: the server's values become the baseline. Fields the person did not touch while the save
 * was in flight take the server's (canonical) value, keeping the current object when the content is the
 * same so list items keep their client keys; fields edited meanwhile keep the newer local value.
 */
export const mergeSaved = (
  current: FormValues,
  sent: FormValues,
  saved: FormValues,
): { values: FormValues; baseline: FormValues } => {
  const values: FormValues = { ...current };
  const baseline: FormValues = { ...saved };
  for (const key of Object.keys(saved)) {
    const editedMeanwhile = !Object.is(current[key], sent[key]);
    if (editedMeanwhile) {
      continue;
    }
    if (isSameContent(current[key], saved[key])) {
      baseline[key] = current[key];
    } else {
      values[key] = saved[key];
    }
  }
  return { values, baseline };
};
