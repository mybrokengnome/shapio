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
  if (text === undefined) {
    return undefined;
  }
  for (const candidate of textCandidates(text, client.type === 'biginteger')) {
    const fitted = check(converted('text', client.type, candidate));
    if (fitted !== undefined) {
      return fitted;
    }
  }
  return undefined;
};

/**
 * The spellings of one text a client field tries, in order, the first that fits its shape winning: the text as
 * written, trimmed, and (when it parses as a number) its exact number text, as a version in between with a
 * number type would read it, without a float (" 7 " → "7", "007" → "7", "012.5" → "12.5"). For an integer
 * client a number with a fraction has no integer spelling.
 */
const textCandidates = (text: string, integer: boolean): string[] => {
  const trimmed = text.trim();
  const number = exactNumberText(text, integer);
  return [...new Set([text, trimmed, ...(number === undefined ? [] : [number])])];
};

/** Numeric text longer than this (after trimming) is not read as a number: no number needs more digits. */
export const MAX_NUMBER_TEXT_LENGTH = 64;
/** An exponent beyond this is not read (every finite double and any practical decimal is within it). */
export const MAX_NUMBER_EXPONENT = 400;
/** The longest exact number text `exactNumberText` can return: digits, zeros the exponent adds, sign, point. */
export const MAX_EXACT_NUMBER_LENGTH = MAX_NUMBER_TEXT_LENGTH + MAX_NUMBER_EXPONENT + 3;

/** Only ever run on at most `MAX_NUMBER_TEXT_LENGTH` characters; no nested quantifiers. */
const DECIMAL_NOTATION = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?)(\d+))?$/;

/**
 * Text that parses as a finite number (as `convertType` text → number would read it), as exact decimal digits:
 * trimmed, sign and leading zeros normalized, an exponent applied by moving the point, never through a float
 * ("99999999999999999999" stays exact). For an integer client a zero fraction is dropped. Notations `Number`
 * reads that are not decimal (hex, binary, octal) go through the number. undefined when it is no number.
 *
 * Bounded before any work: text longer than `MAX_NUMBER_TEXT_LENGTH` after trimming, or an exponent beyond
 * `MAX_NUMBER_EXPONENT` ("1e-400000000", "0e400000000"), is not read as a number, so the result is never longer
 * than `MAX_EXACT_NUMBER_LENGTH`.
 */
export const exactNumberText = (text: string, integer: boolean): string | undefined => {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > MAX_NUMBER_TEXT_LENGTH || !Number.isFinite(Number(trimmed))) {
    return undefined;
  }
  const match = DECIMAL_NOTATION.exec(trimmed);
  if (!match) {
    return plainNumber(Number(trimmed));
  }
  const [, sign = '', whole = '', fraction = '', exponentSign = '', exponentDigits = '0'] = match;
  if (whole === '' && fraction === '') {
    return undefined;
  }
  // The exponent as digits (at most 64 of them): its magnitude is checked before anything is built.
  const magnitudeDigits = exponentDigits.replace(/^0+/, '');
  if (
    magnitudeDigits.length > String(MAX_NUMBER_EXPONENT).length ||
    Number(magnitudeDigits) > MAX_NUMBER_EXPONENT
  ) {
    return undefined;
  }
  const exponent = (exponentSign === '-' ? -1 : 1) * Number(magnitudeDigits || '0');
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  const padded = point <= 0 ? `${'0'.repeat(1 - point)}${digits}` : digits.padEnd(point, '0');
  const at = Math.max(point, 1);
  const integerPart = padded.slice(0, at).replace(/^0+(?=\d)/, '');
  let fractionPart = padded.slice(at);
  if (integer) {
    if (/[1-9]/.test(fractionPart)) {
      return undefined;
    }
    fractionPart = '';
  }
  const zero = /^0*$/.test(integerPart) && /^0*$/.test(fractionPart);
  const result = `${sign === '-' && !zero ? '-' : ''}${integerPart}${fractionPart === '' ? '' : `.${fractionPart}`}`;
  if (result.length > MAX_EXACT_NUMBER_LENGTH) {
    throw new Error(`exactNumberText: ${result.length} characters exceeds its bound`);
  }
  return result;
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
  return text === undefined
    ? undefined
    : textCandidates(text, false).find((candidate) => allowed.has(candidate));
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
