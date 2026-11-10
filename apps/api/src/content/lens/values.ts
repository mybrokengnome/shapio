import { RICHTEXT_FORMAT, type FieldDefinition } from '@shapio/schema';
import { plainNumber } from '../../helpers/plainNumber.js';
import { convertType } from '../migration/convert.js';
import { checkScalar } from '../validator/scalars.js';

export { plainNumber };

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

/** The candidates a stored value offers a client field: a list's items in order when the client holds one. */
const candidatesOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

/** One value converted (`convertType`) to `to`; undefined when it has no conversion. */
const converted = (from: FieldDefinition['type'], to: FieldDefinition['type'], value: unknown): unknown => {
  if (typeof value === 'number' && (to === 'decimal' || to === 'biginteger')) {
    return plainNumber(value);
  }
  const conversion = convertType(from, to, value);
  if (conversion.kind === 'clear' || conversion.kind === 'fail') {
    return undefined;
  }
  return conversion.kind === 'set' ? conversion.value : value;
};

/** One stored item as text, the hub every chain of type changes passes through; undefined when it has none. */
const asText = (from: FieldDefinition['type'], value: unknown): string | undefined => {
  const text = converted(from, 'text', value);
  return typeof text === 'string' ? text : undefined;
};

/** One item as a single-value scalar client field, directly or through text; undefined when it does not fit. */
const fitScalarItem = (client: FieldDefinition, from: FieldDefinition['type'], value: unknown): unknown => {
  const check = (candidate: unknown): unknown => {
    if (candidate === undefined) {
      return undefined;
    }
    if (client.type === 'code') {
      return typeof candidate === 'string' ? candidate : undefined;
    }
    const outcome = checkScalar(shapeOnly(client), candidate);
    return outcome.ok ? outcome.value : undefined;
  };
  const direct = check(converted(from, client.type, value));
  if (direct !== undefined) {
    return direct;
  }
  const text = asText(from, value);
  return text === undefined ? undefined : check(converted('text', client.type, text));
};

const fitRichTextItem = (
  client: FieldDefinition<'richtext'>,
  from: FieldDefinition['type'],
  value: unknown,
) => {
  const fits = (candidate: unknown) =>
    isRecord(candidate) &&
    candidate.format === RICHTEXT_FORMAT &&
    candidate.version === client.settings.formatVersion &&
    isRecord(candidate.doc)
      ? candidate
      : undefined;
  const direct = fits(converted(from, 'richtext', value));
  if (direct !== undefined) {
    return direct;
  }
  const text = asText(from, value);
  return text === undefined ? undefined : fits(converted('text', 'richtext', text));
};

/** An enum value: a string the client allows, directly or as text. */
const fitEnumItem = (client: FieldDefinition<'enum'>, from: FieldDefinition['type'], value: unknown) => {
  const allowed = new Set(client.settings.values.map((entry) => entry.value));
  const text = typeof value === 'string' ? value : asText(from, value);
  return text !== undefined && allowed.has(text) ? text : undefined;
};

/**
 * Every item that fits, in order and once each, for a list client ("the values that fit"); the first item
 * that fits for a single one. undefined when none does (the read then shows null, or [] for a list).
 */
const fitItems = (list: boolean, value: unknown, fit: (item: unknown) => unknown): unknown => {
  if (!list) {
    for (const item of candidatesOf(value)) {
      const fitted = fit(item);
      if (fitted !== undefined) {
        return fitted;
      }
    }
    return undefined;
  }
  const seen = new Set<string>();
  const kept = candidatesOf(value).flatMap((item) => {
    const fitted = fit(item);
    const key = JSON.stringify(fitted);
    if (fitted === undefined || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [fitted];
  });
  return kept.length > 0 ? kept : undefined;
};

const asId = (item: unknown): unknown => (typeof item === 'string' ? item : undefined);

/**
 * A present stored value of a scalar, rich-text, JSON, media or relation field as the client's field reads it;
 * undefined when nothing of it fits. A list client keeps the items that fit and drops the rest; a single client
 * reads the first item that fits. Conversions go directly where `convertType` has one, else through text
 * (`lensCanRead`). Relation IDs are kept as IDs: which targets the client may see (its own relation target,
 * today's policies) is decided where targets are fetched.
 */
export const fitValue = (client: FieldDefinition, stored: FieldDefinition, value: unknown): unknown => {
  switch (client.type) {
    case 'json':
      return stored.type === 'json' ? value : undefined;
    case 'richtext':
      return fitItems(false, value, (item) => fitRichTextItem(client, stored.type, item));
    case 'relation': {
      // IDs of another target than the client's (at any depth): not entries its version can read.
      if (stored.type !== 'relation' || stored.settings.target !== client.settings.target) {
        return undefined;
      }
      return fitItems(client.settings.cardinality === 'many', value, asId);
    }
    case 'media':
      return fitItems(client.settings.multiple, value, asId);
    case 'enum':
      return fitItems(client.settings.multiple, value, (item) => fitEnumItem(client, stored.type, item));
    case 'component':
    case 'dynamiczone':
      return undefined;
    default:
      return fitItems(false, value, (item) => fitScalarItem(client, stored.type, item));
  }
};
