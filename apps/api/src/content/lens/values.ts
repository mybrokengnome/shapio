import { RICHTEXT_FORMAT, type FieldDefinition } from '@shapio/schema';
import { convertType } from '../migration/convert.js';
import { checkScalar } from '../validator/scalars.js';

/**
 * One stored value presented as a client field's type (schema lenses). Every value is converted (by the
 * planner's own `convertType`, which goes by the value) and then re-checked against the client's field: a
 * value that does not fit the client's type reads as absent (`undefined`), never as a value of the wrong type.
 * Only the API shape is checked (type, integer-ness, formats, enum membership, list or single); length, range
 * and pattern rules are validation, not shape. Components, dynamic zones and relations are the caller's
 * (`read.ts`), which recurses with the nested lenses.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Settings that decide a value's shape; the rest (lengths, ranges, patterns, precision) are dropped. */
const SHAPE_SETTINGS = new Set(['values', 'multiple', 'formatVersion', 'language']);

const shapeOnly = (field: FieldDefinition): FieldDefinition =>
  ({
    ...field,
    settings: Object.fromEntries(
      Object.entries(field.settings as Record<string, unknown>).filter(([key]) => SHAPE_SETTINGS.has(key)),
    ),
  }) as FieldDefinition;

/** A list read as one value takes its first item; one value read as a list becomes a one-item list. */
export const toCardinality = (value: unknown, list: boolean): unknown => {
  if (list) {
    return Array.isArray(value) ? value : [value];
  }
  return Array.isArray(value) ? value[0] : value;
};

const isStringOrStrings = (value: unknown, list: boolean) =>
  list ? Array.isArray(value) && value.every((item) => typeof item === 'string') : typeof value === 'string';

const fitRichText = (client: FieldDefinition<'richtext'>, stored: FieldDefinition, value: unknown) => {
  const conversion = convertType(stored.type, 'richtext', value);
  const converted =
    conversion.kind === 'set' ? conversion.value : conversion.kind === 'keep' ? value : undefined;
  return isRecord(converted) &&
    converted.format === RICHTEXT_FORMAT &&
    converted.version === client.settings.formatVersion &&
    isRecord(converted.doc)
    ? converted
    : undefined;
};

const fitScalar = (client: FieldDefinition, stored: FieldDefinition, value: unknown): unknown => {
  const conversion = convertType(stored.type, client.type, value);
  if (conversion.kind === 'clear' || conversion.kind === 'fail') {
    return undefined;
  }
  const converted = conversion.kind === 'set' ? conversion.value : value;
  if (client.type === 'code') {
    return typeof converted === 'string' ? converted : undefined;
  }
  const outcome = checkScalar(shapeOnly(client), converted);
  return outcome.ok ? outcome.value : undefined;
};

/**
 * A present stored value of a scalar, rich-text, JSON, media or relation field as the client's field reads it;
 * undefined when it does not fit. Relation IDs are kept as IDs: which targets the client may see (its own
 * relation target, today's policies) is decided where targets are fetched.
 */
export const fitValue = (client: FieldDefinition, stored: FieldDefinition, value: unknown): unknown => {
  switch (client.type) {
    case 'json':
      return stored.type === 'json' ? value : undefined;
    case 'richtext':
      return fitRichText(client, stored, value);
    case 'relation': {
      const list = client.settings.cardinality === 'many';
      const shaped = toCardinality(value, list);
      return shaped === undefined || !isStringOrStrings(shaped, list) ? undefined : shaped;
    }
    case 'media': {
      const shaped = toCardinality(value, client.settings.multiple);
      return shaped === undefined || !isStringOrStrings(shaped, client.settings.multiple)
        ? undefined
        : shaped;
    }
    case 'enum': {
      // `convertType` turns text into a one-value list whatever the enum; list or single is decided here.
      const shaped = toCardinality(value, client.settings.multiple);
      if (shaped === undefined) {
        return undefined;
      }
      const outcome = checkScalar(shapeOnly(client), shaped);
      return outcome.ok ? outcome.value : undefined;
    }
    case 'component':
    case 'dynamiczone':
      return undefined;
    default:
      return fitScalar(client, stored, value);
  }
};
