import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import {
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  type GraphQLInputFieldConfigMap,
} from 'graphql';
import { isSortable } from '../../../content/compiler/operators.js';
import { FILTER_OPERATORS, queryInvalid, type FilterOperator } from '../../../content/compiler/types.js';
import { liveFields } from '../../../content/model.js';
import { describeDefinition } from './descriptions.js';
import { operatorFieldName, type FilterTypeName, type FixedTypes } from './fixedTypes.js';
import { modelTypeName } from './names.js';

/**
 * `XFilter` and `XSort` inputs, and their translation to the REST querystring the content compiler parses
 * (`filters[title][$eq]=…`, `sort=title:asc`). GraphQL queries go through exactly the same parser, allowlist,
 * read-mask checks and limits as REST, so the same request gets the same rows, errors and 403s.
 */
const FILTER_TYPE_BY_DATA_TYPE: Partial<Record<FieldDefinition['type'], FilterTypeName>> = {
  string: 'StringFilter',
  text: 'StringFilter',
  slug: 'StringFilter',
  email: 'StringFilter',
  url: 'StringFilter',
  uid: 'StringFilter',
  enum: 'StringFilter',
  number: 'FloatFilter',
  integer: 'IntFilter',
  decimal: 'DecimalFilter',
  biginteger: 'BigIntFilter',
  boolean: 'BooleanFilter',
  date: 'DateFilter',
  datetime: 'DateTimeFilter',
  time: 'TimeFilter',
  relation: 'IDFilter',
  media: 'IDFilter',
};

const SYSTEM_FILTERS: ReadonlyArray<[string, FilterTypeName]> = [
  ['id', 'IDFilter'],
  ['createdAt', 'DateTimeFilter'],
  ['updatedAt', 'DateTimeFilter'],
];

/** `and`/`or`/`not` combine filters. They are reserved field API keys (naming.ts), so never shadowed. */
const LOGICAL_KEYS = { and: '$and', or: '$or', not: '$not' } as const;

const filterableFields = (model: ModelDefinition) =>
  liveFields(model.fields).filter((field) => FILTER_TYPE_BY_DATA_TYPE[field.type] !== undefined);

export const createFilterInput = (model: ModelDefinition, fixed: FixedTypes): GraphQLInputObjectType => {
  const type: GraphQLInputObjectType = new GraphQLInputObjectType({
    name: modelTypeName(model, 'Filter'),
    description: `Conditions on ${model.label} entries; every key given must hold (AND).`,
    fields: () => {
      const fields: GraphQLInputFieldConfigMap = {};
      for (const [name, filter] of SYSTEM_FILTERS) {
        fields[name] = { type: fixed.filters[filter] };
      }
      for (const field of filterableFields(model)) {
        fields[field.apiKey] = {
          type: fixed.filters[FILTER_TYPE_BY_DATA_TYPE[field.type] as FilterTypeName],
          description: describeDefinition(field),
        };
      }
      fields.and = { type: new GraphQLList(new GraphQLNonNull(type)), description: 'All must hold' };
      fields.or = { type: new GraphQLList(new GraphQLNonNull(type)), description: 'At least one must hold' };
      fields.not = { type, description: 'Must not hold' };
      return fields;
    },
  });
  return type;
};

/** `XSort`: one key per item, e.g. `sort: [{ title: ASC }, { createdAt: DESC }]`. */
export const createSortInput = (model: ModelDefinition, fixed: FixedTypes): GraphQLInputObjectType =>
  new GraphQLInputObjectType({
    name: modelTypeName(model, 'Sort'),
    description: `One sort key of ${model.label} entries (set exactly one field per item).`,
    fields: () => {
      const fields: GraphQLInputFieldConfigMap = {
        id: { type: fixed.sortDirection },
        createdAt: { type: fixed.sortDirection },
        updatedAt: { type: fixed.sortDirection },
      };
      for (const field of liveFields(model.fields).filter(isSortable)) {
        fields[field.apiKey] = { type: fixed.sortDirection };
      }
      return fields;
    },
  });

type Param = [string, string];
const OPERATOR_BY_NAME = new Map<string, FilterOperator>(
  FILTER_OPERATORS.map((operator) => [operatorFieldName(operator), operator]),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toText = (value: unknown, label: string): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw queryInvalid(`"${label}" needs a scalar value`);
};

const conditionParams = (prefix: string, key: string, conditions: unknown, out: Param[]) => {
  if (!isRecord(conditions)) {
    return;
  }
  for (const [name, operand] of Object.entries(conditions)) {
    const operator = OPERATOR_BY_NAME.get(name);
    if (operator === undefined || operand === null || operand === undefined) {
      continue;
    }
    const path = `${prefix}[${key}][${operator}]`;
    if (Array.isArray(operand)) {
      if (operand.length === 0) {
        throw queryInvalid(`"${key}" ${name} needs at least one value`);
      }
      operand.forEach((item, index) => out.push([`${path}[${index}]`, toText(item, key)]));
    } else {
      out.push([path, toText(operand, key)]);
    }
  }
};

const filterParamsAt = (prefix: string, filter: Record<string, unknown>, out: Param[]) => {
  for (const [key, value] of Object.entries(filter)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (key === 'and' || key === 'or') {
      const children = (value as unknown[]).filter(isRecord);
      if (children.length === 0) {
        throw queryInvalid(`${key} needs at least one filter`);
      }
      children.forEach((child, index) =>
        filterParamsAt(`${prefix}[${LOGICAL_KEYS[key]}][${index}]`, child, out),
      );
    } else if (key === 'not') {
      if (isRecord(value)) {
        filterParamsAt(`${prefix}[$not]`, value, out);
      }
    } else {
      conditionParams(prefix, key, value, out);
    }
  }
};

/** `filter` argument → `filters[...]` parameters. */
export const filterParams = (filter: Record<string, unknown> | null | undefined): Param[] => {
  const out: Param[] = [];
  if (filter) {
    filterParamsAt('filters', filter, out);
  }
  return out;
};

/** `sort` argument → `sort[i]=field:direction` parameters. */
export const sortParams = (sort: ReadonlyArray<Record<string, unknown>> | null | undefined): Param[] =>
  (sort ?? []).map((item, index) => {
    const keys = Object.entries(item).filter(
      ([, direction]) => direction !== null && direction !== undefined,
    );
    const [entry] = keys;
    if (keys.length !== 1 || !entry) {
      throw queryInvalid('Each sort item needs exactly one field, e.g. { title: ASC }');
    }
    return [`sort[${index}]`, `${entry[0]}:${String(entry[1])}`];
  });

/** Plain parameters, skipping absent values. */
export const scalarParams = (values: Record<string, string | number | undefined | null>): Param[] =>
  Object.entries(values).flatMap(([key, value]) =>
    value === undefined || value === null ? [] : [[key, String(value)] as Param],
  );

export const toRawQuery = (params: readonly Param[]): string => new URLSearchParams([...params]).toString();
