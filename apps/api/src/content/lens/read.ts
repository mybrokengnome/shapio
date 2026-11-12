import type { DefinitionLens, FieldDefinition, FieldLens, NestedLens } from '@shapio/schema';
import { ITEM_ID_KEY } from '../../constants/itemIds.js';
import type { ContentData } from '../../db/contentData.js';
import { COMPONENT_KEY } from '../validator/index.js';
import { fitValue, toCardinality } from './values.js';

/**
 * Stored content (keyed by stable field IDs, in today's shape) read in the shape of the client's schema
 * version (plan schema-lenses), still keyed by field IDs and in storage form: the projection then emits it
 * through the client's field definitions with today's visibility. A field the lens reads as null is left out
 * (the projection emits null or `[]`), and so is any value that does not fit the client's field.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isMissing = (value: unknown) => value === undefined || value === null;

/**
 * One component instance through its component's lens, with its ID (plan item-ids); undefined when the
 * component is gone.
 */
const readInstance = (
  lens: DefinitionLens | null | undefined,
  value: unknown,
): Readonly<ContentData> | undefined => {
  if (!lens || lens.status === 'gone' || !isRecord(value)) {
    return undefined;
  }
  const read = readThroughLens(lens, value);
  return value[ITEM_ID_KEY] === undefined || read === value
    ? read
    : { ...read, [ITEM_ID_KEY]: value[ITEM_ID_KEY] };
};

const readComponent = (
  client: FieldDefinition<'component'>,
  stored: FieldDefinition,
  nested: NestedLens | undefined,
  value: unknown,
): unknown => {
  const lens = nested?.components.get(client.settings.component);
  const repeatable = client.settings.repeatable;
  const shaped =
    stored.type === 'component' && stored.settings.repeatable !== repeatable
      ? toCardinality(value, repeatable)
      : value;
  if (repeatable) {
    return Array.isArray(shaped)
      ? shaped.flatMap((item) => {
          const read = readInstance(lens, item);
          return read ? [read] : [];
        })
      : undefined;
  }
  return readInstance(lens, shaped);
};

/** Items of components the client allows and still knows, each through its component's lens. */
const readZone = (
  client: FieldDefinition<'dynamiczone'>,
  stored: FieldDefinition,
  nested: NestedLens | undefined,
  value: unknown,
) => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  // Allowed by both versions: an item of a component today's zone no longer allows is never shown.
  const today = new Set(stored.type === 'dynamiczone' ? stored.settings.components : []);
  const allowed = new Set(client.settings.components.filter((id) => today.has(id)));
  return value.flatMap((item) => {
    const componentId = isRecord(item) ? item[COMPONENT_KEY] : undefined;
    if (typeof componentId !== 'string' || !allowed.has(componentId)) {
      return [];
    }
    const read = readInstance(nested?.components.get(componentId), item);
    return read ? [{ ...read, [COMPONENT_KEY]: componentId }] : [];
  });
};

/** A `same` field: the value as stored, with the components inside it read through their own lenses. */
const readSame = (field: FieldLens & { kind: 'same' }, value: unknown): unknown => {
  const { client, stored, nested } = field;
  if (client.type === 'component') {
    return readComponent(client, stored, nested, value);
  }
  if (client.type === 'dynamiczone') {
    return readZone(client, stored, nested, value);
  }
  return value;
};

const readField = (field: FieldLens, value: unknown): unknown => {
  switch (field.kind) {
    case 'null':
      return undefined;
    case 'same':
      return readSame(field, value);
    case 'convert': {
      const { client, stored, nested } = field;
      if (client.type === 'component') {
        return readComponent(client, stored, nested, value);
      }
      if (client.type === 'dynamiczone') {
        return readZone(client, stored, nested, value);
      }
      return fitValue(client, stored, value);
    }
  }
};

/**
 * `data` (today's storage, keyed by field IDs) as the client's definition reads it. An identity lens returns
 * `data` itself. A gone definition reads as nothing; callers refuse it before reading (404).
 */
/**
 * Whether a lens holds a dynamic zone that allows fewer components today than in the client's version (at any
 * depth): an identity lens otherwise passes stored data through, which could then hold items of a component
 * today's zone no longer allows.
 */
const narrowsAZone = (lens: DefinitionLens, seen = new Set<string>()): boolean => {
  if (seen.has(lens.definitionId)) {
    return false;
  }
  seen.add(lens.definitionId);
  return lens.fields.some((field) => {
    if (field.kind === 'null') {
      return false;
    }
    const narrowed =
      field.client.type === 'dynamiczone' &&
      field.stored.type === 'dynamiczone' &&
      field.client.settings.components.some(
        (id) => !(field.stored as FieldDefinition<'dynamiczone'>).settings.components.includes(id),
      );
    return (
      narrowed ||
      [...(field.nested?.components.values() ?? [])].some(
        (nested) => nested !== null && narrowsAZone(nested, seen),
      )
    );
  });
};

export const readThroughLens = (lens: DefinitionLens, data: Readonly<ContentData>): Readonly<ContentData> => {
  if (lens.status === 'identity' && !narrowsAZone(lens)) {
    return data;
  }
  const output: ContentData = {};
  for (const field of lens.fields) {
    const value = data[field.fieldId];
    if (isMissing(value)) {
      continue;
    }
    const read = readField(field, value);
    if (!isMissing(read) && !(Array.isArray(read) && read.length === 0)) {
      output[field.fieldId] = read;
    }
  }
  return output;
};
