import { isStableId, type DataType, type FieldDefinition } from '@shapio/schema';
import {
  canonicalBigInteger,
  canonicalDate,
  canonicalDatetime,
  canonicalDecimal,
  canonicalTime,
} from '../validator/scalars.js';
import { queryInvalid, type FilterOperator, type FilterTarget } from './types.js';

/**
 * Which operators each data type accepts, and how query text becomes a typed value (ADR 0001):
 * - equality (`$eq $ne $in $nin`) works on every filterable type: it compiles to `data @> …`, which the GIN
 *   index serves, so no per-field index is needed. On list values (multiple enums, `many` relations,
 *   multiple media) `$eq x` means "contains x".
 * - `$null`/`$notNull` test for a missing value (absent, null, "" or []).
 * - ranges (`$lt $lte $gt $gte`) need an expression index, so only fields marked filterable or sortable
 *   accept them; text matches (`$contains`…) are unindexed scans and need `filterable`.
 * Values are canonicalized exactly like stored values, so `2026-10-01T10:00:00+02:00` finds
 * `2026-10-01T08:00:00.000Z`.
 */

type TypeFamily =
  'text' | 'temporal' | 'number' | 'numericString' | 'boolean' | 'list' | 'reference' | 'none';

const familyOf = (field: FieldDefinition): TypeFamily => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'slug':
    case 'email':
    case 'url':
    case 'uid':
      return 'text';
    case 'enum':
      return field.settings.multiple ? 'list' : 'text';
    case 'date':
    case 'datetime':
    case 'time':
      return 'temporal';
    case 'number':
    case 'integer':
      return 'number';
    case 'decimal':
    case 'biginteger':
      return 'numericString';
    case 'boolean':
      return 'boolean';
    case 'relation':
    case 'media':
      return 'reference';
    default:
      return 'none';
  }
};

const EQUALITY: readonly FilterOperator[] = ['$eq', '$ne', '$in', '$nin', '$null', '$notNull'];
const RANGE: readonly FilterOperator[] = ['$lt', '$lte', '$gt', '$gte'];
const TEXT_MATCH: readonly FilterOperator[] = [
  '$contains',
  '$notContains',
  '$containsi',
  '$startsWith',
  '$endsWith',
];

export const OPERATORS_BY_FAMILY: Readonly<Record<TypeFamily, readonly FilterOperator[]>> = {
  text: [...EQUALITY, ...RANGE, ...TEXT_MATCH],
  temporal: [...EQUALITY, ...RANGE],
  number: [...EQUALITY, ...RANGE],
  numericString: [...EQUALITY, ...RANGE],
  boolean: ['$eq', '$ne', '$null', '$notNull'],
  list: EQUALITY,
  reference: EQUALITY,
  none: [],
};

export const isRangeOperator = (operator: FilterOperator) => RANGE.includes(operator);
export const isTextMatchOperator = (operator: FilterOperator) => TEXT_MATCH.includes(operator);
export const isListOperator = (operator: FilterOperator) => operator === '$in' || operator === '$nin';
export const isNullOperator = (operator: FilterOperator) => operator === '$null' || operator === '$notNull';

/** Whether the field holds a list (equality means "contains"). */
export const isListValued = (field: FieldDefinition): boolean =>
  (field.type === 'enum' && field.settings.multiple) ||
  (field.type === 'relation' && field.settings.cardinality === 'many') ||
  (field.type === 'media' && field.settings.multiple);

/** Types whose stored JSON string is not unique per value, so equality compares numerically. */
export const NUMERIC_STRING_TYPES: ReadonlySet<DataType> = new Set(['decimal', 'biginteger']);

const SYSTEM_OPERATORS: Readonly<Record<string, readonly FilterOperator[]>> = {
  id: ['$eq', '$ne', '$in', '$nin'],
  createdAt: ['$eq', '$ne', '$in', '$nin', ...RANGE],
  updatedAt: ['$eq', '$ne', '$in', '$nin', ...RANGE],
};

/** Throws 400 unless the operator is allowed for the target. */
export const assertOperatorAllowed = (target: FilterTarget, operator: FilterOperator, label: string) => {
  if (target.kind === 'system') {
    if (!(SYSTEM_OPERATORS[target.name] ?? []).includes(operator)) {
      throw queryInvalid(`Operator ${operator} is not supported on "${label}"`);
    }
    return;
  }
  const { field } = target;
  if (!OPERATORS_BY_FAMILY[familyOf(field)].includes(operator)) {
    throw queryInvalid(`Operator ${operator} is not supported on "${label}" (${field.type})`);
  }
  if (isRangeOperator(operator) && !field.filterable && !field.sortable) {
    throw queryInvalid(`"${label}" is not filterable: mark it filterable to use ${operator}`);
  }
  if (isTextMatchOperator(operator) && !field.filterable) {
    throw queryInvalid(`"${label}" is not filterable: mark it filterable to use ${operator}`);
  }
};

/** Whether a field can be sorted on: an expression index exists only for sortable/filterable scalars. */
export const isSortable = (field: FieldDefinition) =>
  field.sortable &&
  familyOf(field) !== 'none' &&
  familyOf(field) !== 'list' &&
  familyOf(field) !== 'reference';

const coerceBoolean = (raw: unknown, label: string): boolean => {
  if (raw === true || raw === 'true') {
    return true;
  }
  if (raw === false || raw === 'false') {
    return false;
  }
  throw queryInvalid(`"${label}" needs true or false`);
};

const coerceText = (raw: unknown, label: string): string => {
  if (typeof raw !== 'string') {
    throw queryInvalid(`"${label}" needs a single text value`);
  }
  return raw;
};

const coerceOrFail = <T>(value: T | undefined, label: string, expected: string): T => {
  if (value === undefined) {
    throw queryInvalid(`"${label}" needs ${expected}`);
  }
  return value;
};

/** One comparison value for a field, canonicalized like stored values. */
const coerceFieldValue = (field: FieldDefinition, raw: unknown, label: string): unknown => {
  switch (familyOf(field)) {
    case 'number': {
      const number = Number(coerceText(raw, label));
      if (!Number.isFinite(number) || (raw as string).trim() === '') {
        throw queryInvalid(`"${label}" needs a number`);
      }
      return number;
    }
    case 'numericString':
      return coerceOrFail(
        field.type === 'decimal'
          ? canonicalDecimal(coerceText(raw, label))
          : canonicalBigInteger(coerceText(raw, label)),
        label,
        'a number',
      );
    case 'temporal': {
      const text = coerceText(raw, label);
      const canonical =
        field.type === 'date'
          ? canonicalDate(text)
          : field.type === 'datetime'
            ? canonicalDatetime(text)
            : canonicalTime(text);
      return coerceOrFail(canonical, label, `a valid ${field.type}`);
    }
    case 'boolean':
      return coerceBoolean(raw, label);
    case 'reference': {
      const id = coerceText(raw, label);
      if (!isStableId(id)) {
        throw queryInvalid(`"${label}" needs an ID`);
      }
      return id;
    }
    default:
      return coerceText(raw, label);
  }
};

const coerceSystemValue = (name: string, raw: unknown, label: string): unknown => {
  const text = coerceText(raw, label);
  if (name === 'id') {
    if (!isStableId(text)) {
      throw queryInvalid(`"${label}" needs an entry ID`);
    }
    return text;
  }
  return coerceOrFail(canonicalDatetime(text), label, 'an ISO-8601 date-time with a time zone');
};

/** Turns the raw operand of `operator` into typed value(s); lists for `$in`/`$nin`, a boolean for `$null`. */
export const coerceOperand = (
  target: FilterTarget,
  operator: FilterOperator,
  raw: unknown,
  label: string,
  maxListLength: number,
): unknown => {
  if (isNullOperator(operator)) {
    return coerceBoolean(raw, label);
  }
  const coerceOne = (value: unknown) =>
    target.kind === 'system'
      ? coerceSystemValue(target.name, value, label)
      : coerceFieldValue(target.field, value, label);
  if (isListOperator(operator)) {
    if (!Array.isArray(raw)) {
      throw queryInvalid(`"${label}" ${operator} needs a list`);
    }
    if (raw.length > maxListLength) {
      throw queryInvalid(`"${label}" ${operator} accepts at most ${maxListLength} values`);
    }
    return raw.map(coerceOne);
  }
  if (isTextMatchOperator(operator)) {
    const text = coerceText(raw, label);
    if (text.length === 0) {
      throw queryInvalid(`"${label}" ${operator} needs a non-empty value`);
    }
    return text;
  }
  return coerceOne(raw);
};

/** Every operator a field accepts right now (documentation and generated filter types). */
export const operatorsFor = (field: FieldDefinition): FilterOperator[] =>
  OPERATORS_BY_FAMILY[familyOf(field)].filter(
    (operator) =>
      !(isRangeOperator(operator) && !field.filterable && !field.sortable) &&
      !(isTextMatchOperator(operator) && !field.filterable),
  );
