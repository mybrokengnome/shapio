import type { ContentFilter, ContentFilterOperator } from '@shapio/client';
import type { FieldDefinition } from '@shapio/schema';
import { fromDateTimeInput } from '@/fields/helpers/dates';

/**
 * Which filter operators the list offers per field. Mirrors the content compiler's allowlist
 * (`apps/api/src/content/compiler/operators.ts`), which stays the enforcement: equality on every scalar
 * type; ranges only on filterable or sortable fields (they need an index); text matches only on
 * filterable ones.
 */
type Family = 'text' | 'temporal' | 'number' | 'boolean' | 'list' | 'reference' | 'none';

const familyOf = (field: FieldDefinition): Family => {
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
    case 'decimal':
    case 'biginteger':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'relation':
    case 'media':
      return 'reference';
    default:
      return 'none';
  }
};

const EQUALITY: readonly ContentFilterOperator[] = ['$eq', '$ne', '$in', '$nin', '$null', '$notNull'];
const RANGE: readonly ContentFilterOperator[] = ['$lt', '$lte', '$gt', '$gte'];
const TEXT_MATCH: readonly ContentFilterOperator[] = [
  '$containsi',
  '$contains',
  '$notContains',
  '$startsWith',
  '$endsWith',
];

const BY_FAMILY: Readonly<Record<Family, readonly ContentFilterOperator[]>> = {
  text: [...EQUALITY, ...RANGE, ...TEXT_MATCH],
  temporal: [...EQUALITY, ...RANGE],
  number: [...EQUALITY, ...RANGE],
  boolean: ['$eq', '$ne', '$null', '$notNull'],
  list: EQUALITY,
  reference: EQUALITY,
  none: [],
};

/** System attributes every entry can be filtered and sorted by. */
export const SYSTEM_FILTER_FIELDS = ['createdAt', 'updatedAt'] as const;
const SYSTEM_OPERATORS: readonly ContentFilterOperator[] = ['$eq', '$ne', '$lt', '$lte', '$gt', '$gte'];

export const operatorsFor = (
  field: FieldDefinition | 'createdAt' | 'updatedAt',
): readonly ContentFilterOperator[] => {
  if (typeof field === 'string') {
    return SYSTEM_OPERATORS;
  }
  return BY_FAMILY[familyOf(field)].filter(
    (operator) =>
      (!RANGE.includes(operator) || field.filterable || field.sortable) &&
      (!TEXT_MATCH.includes(operator) || field.filterable),
  );
};

/** Fields that can be sorted by: sortable scalars (an expression index exists for them). */
export const isSortableField = (field: FieldDefinition) =>
  field.sortable && !['none', 'list', 'reference'].includes(familyOf(field));

export const OPERATOR_LABEL_KEYS = {
  $eq: 'content.filters.operators.eq',
  $ne: 'content.filters.operators.ne',
  $in: 'content.filters.operators.in',
  $nin: 'content.filters.operators.nin',
  $lt: 'content.filters.operators.lt',
  $lte: 'content.filters.operators.lte',
  $gt: 'content.filters.operators.gt',
  $gte: 'content.filters.operators.gte',
  $contains: 'content.filters.operators.contains',
  $notContains: 'content.filters.operators.notContains',
  $containsi: 'content.filters.operators.containsi',
  $startsWith: 'content.filters.operators.startsWith',
  $endsWith: 'content.filters.operators.endsWith',
  $null: 'content.filters.operators.null',
  $notNull: 'content.filters.operators.notNull',
} as const satisfies Record<ContentFilterOperator, string>;

/** Operators that need no value. */
export const isValueless = (operator: ContentFilterOperator) =>
  operator === '$null' || operator === '$notNull';

export type ListFilter = { field: string; operator: ContentFilterOperator; value?: string };

/** The list's filter rows → the API's filter tree (rows on the same field are combined with `$and`). */
export const toContentFilter = (filters: readonly ListFilter[]): ContentFilter | undefined => {
  if (filters.length === 0) {
    return undefined;
  }
  const conditions = filters.map((filter): ContentFilter => {
    const value = isValueless(filter.operator)
      ? true
      : filter.operator === '$in' || filter.operator === '$nin'
        ? (filter.value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : (SYSTEM_FILTER_FIELDS as readonly string[]).includes(filter.field)
          ? // System timestamps are typed in local time and compared as UTC instants.
            (fromDateTimeInput(filter.value ?? '', false) ?? filter.value ?? '')
          : (filter.value ?? '');
    return { [filter.field]: { [filter.operator]: value } };
  });
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};
