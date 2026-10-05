import { collectionQueryName, routeKeyOf, type FieldDefinition, type ModelDefinition } from '@shapio/schema';
import type { DeliveryOperation } from './operations';
import { filterParamName, type RequestDraft } from './request';

/**
 * The GraphQL tab's operations per model and the query each one sends, built from the REST tab's request
 * for the same endpoint (same filters, sort, search, page, locale, snapshot and fields), so the two read
 * the same rows. Field selections follow the server's types: scalars as they are, rich text as `html`,
 * media as `url alt`, relations as `id`, components and zones as `__typename`.
 */
export type GraphqlOperation = { id: string; name: string; modelId: string; list: boolean };

/** The query, and the REST parameters it could not carry over (`populate`, `$or` filters, nested paths). */
export type GraphqlQuery = { query: string; skipped: string[] };

/** The GraphQL tab's operation IDs are prefixed so they never collide with REST operation IDs. */
export const GRAPHQL_OPERATION_PREFIX = 'graphql:';

export const graphqlOperations = (model: ModelDefinition): GraphqlOperation[] => {
  const single = {
    id: `${GRAPHQL_OPERATION_PREFIX}${model.apiKey}`,
    name: model.apiKey,
    modelId: model.id,
    list: false,
  };
  if (model.kind !== 'collection') {
    return [single];
  }
  const listName = collectionQueryName(model);
  return [
    { id: `${GRAPHQL_OPERATION_PREFIX}${listName}`, name: listName, modelId: model.id, list: true },
    single,
  ];
};

/** The REST endpoint a GraphQL operation mirrors: the list, the read by ID, or the singleton's read. */
export const restOperationFor = (
  model: ModelDefinition,
  operation: GraphqlOperation,
  restOperations: readonly DeliveryOperation[],
): DeliveryOperation | undefined =>
  restOperations.find(
    (candidate) =>
      candidate.routeKey === routeKeyOf(model) &&
      (operation.list ? candidate.list : model.kind === 'collection' ? candidate.byId : !candidate.byId),
  );

/**
 * The operation to show after switching tabs, so the endpoint stays the same: the REST endpoint's GraphQL
 * operation, or the GraphQL operation's REST endpoint (undefined: the tab's first).
 */
export const counterpartOperationId = (
  target: 'rest' | 'graphql',
  operationId: string | undefined,
  models: readonly ModelDefinition[],
  restOperations: readonly DeliveryOperation[],
): string | undefined => {
  if (target === 'graphql') {
    const rest = restOperations.find((candidate) => candidate.id === operationId);
    const model = rest && models.find((candidate) => routeKeyOf(candidate) === rest.routeKey);
    return model && graphqlOperations(model).find((candidate) => candidate.list === rest.list)?.id;
  }
  for (const model of models) {
    const operation = graphqlOperations(model).find((candidate) => candidate.id === operationId);
    if (operation) {
      return restOperationFor(model, operation, restOperations)?.id;
    }
  }
  return undefined;
};

const selectionOf = (field: FieldDefinition): string => {
  switch (field.type) {
    case 'richtext':
      return `${field.apiKey} { html }`;
    case 'media':
      return `${field.apiKey} { url alt }`;
    case 'relation':
      return `${field.apiKey} { id }`;
    case 'component':
    case 'dynamiczone':
      return `${field.apiKey} { __typename }`;
    default:
      return field.apiKey;
  }
};

const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

const NUMBER = /^-?\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;
const SYSTEM_ATTRIBUTES = new Set(['id', 'createdAt', 'updatedAt']);
const OPERATORS = new Set([
  '$eq',
  '$ne',
  '$in',
  '$nin',
  '$lt',
  '$lte',
  '$gt',
  '$gte',
  '$contains',
  '$notContains',
  '$containsi',
  '$startsWith',
  '$endsWith',
  '$null',
  '$notNull',
]);
const LIST_OPERATORS = new Set(['$in', '$nin']);
const BOOLEAN_OPERATORS = new Set(['$null', '$notNull']);

const isBooleanText = (raw: string) => raw === 'true' || raw === 'false';

/** A GraphQL literal for a REST value: numbers and booleans where the field's type takes them. */
const literal = (field: FieldDefinition | undefined, raw: string): string => {
  if ((field?.type === 'number' || field?.type === 'integer') && NUMBER.test(raw)) {
    return raw;
  }
  if (field?.type === 'boolean' && isBooleanText(raw)) {
    return raw;
  }
  return JSON.stringify(raw);
};

type FilterKey = { name: string; operator: string };

/**
 * `title][$contains` (any spelling `filterParamName` accepts) → `title`, `$contains`; a bare field is `$eq`,
 * a list operator may carry an index (`tags][$in][0`). Logical (`$or`) and nested (`author.name`) keys are
 * not translated.
 */
export const parseFilterKey = (key: string): FilterKey | undefined => {
  const parts = [...filterParamName(key).matchAll(/\[([^\]]*)\]/g)].map((match) => match[1] ?? '');
  const [name, operator = '$eq', index, ...rest] = parts;
  if (!name || name.startsWith('$') || !OPERATORS.has(operator) || rest.length > 0) {
    return undefined;
  }
  if (index !== undefined && !(LIST_OPERATORS.has(operator) && INTEGER.test(index))) {
    return undefined;
  }
  return { name, operator };
};

type Condition = { field: FieldDefinition | undefined; values: string[] };

const operandOf = (operator: string, { field, values }: Condition): string => {
  if (BOOLEAN_OPERATORS.has(operator)) {
    const value = values.at(-1) ?? '';
    return isBooleanText(value) ? value : JSON.stringify(value);
  }
  if (LIST_OPERATORS.has(operator)) {
    return `[${values.map((value) => literal(field, value)).join(', ')}]`;
  }
  return literal(field, values.at(-1) ?? '');
};

/** The `filter` argument for the draft's rows, and the rows it could not translate. */
const filterArgument = (
  model: ModelDefinition,
  draft: RequestDraft,
): { argument: string | undefined; skipped: string[] } => {
  const fields = new Map(
    model.fields.filter((field) => !field.deprecated).map((field) => [field.apiKey, field]),
  );
  const conditions = new Map<string, Map<string, Condition>>();
  const skipped: string[] = [];
  for (const row of draft.filters) {
    const key = row.key.trim();
    if (!key || row.value === '') {
      continue;
    }
    const parsed = parseFilterKey(key);
    const field = parsed ? fields.get(parsed.name) : undefined;
    if (!parsed || (!field && !SYSTEM_ATTRIBUTES.has(parsed.name))) {
      skipped.push(filterParamName(key));
      continue;
    }
    const byOperator = conditions.get(parsed.name) ?? new Map<string, Condition>();
    conditions.set(parsed.name, byOperator);
    const values = LIST_OPERATORS.has(parsed.operator) ? splitList(row.value) : [row.value];
    const existing = byOperator.get(parsed.operator);
    byOperator.set(parsed.operator, {
      field,
      values: existing && LIST_OPERATORS.has(parsed.operator) ? [...existing.values, ...values] : values,
    });
  }
  if (conditions.size === 0) {
    return { argument: undefined, skipped };
  }
  const entries = [...conditions].map(([name, byOperator]) => {
    const operands = [...byOperator].map(
      ([operator, condition]) => `${operator.slice(1)}: ${operandOf(operator, condition)}`,
    );
    return `${name}: { ${operands.join(', ')} }`;
  });
  return { argument: `{ ${entries.join(', ')} }`, skipped };
};

/** `title:asc,createdAt:desc` → `[{ title: ASC }, { createdAt: DESC }]`. */
const sortArgument = (model: ModelDefinition, sort: string): string | undefined => {
  const known = (name: string) =>
    SYSTEM_ATTRIBUTES.has(name) || model.fields.some((field) => !field.deprecated && field.apiKey === name);
  const items = splitList(sort).map((item) => {
    const [name = '', direction = 'asc', extra] = item.split(':');
    return extra === undefined && known(name) && (direction === 'asc' || direction === 'desc')
      ? `{ ${name}: ${direction.toUpperCase()} }`
      : undefined;
  });
  return items.length > 0 && items.every((item) => item !== undefined) ? `[${items.join(', ')}]` : undefined;
};

/** The fields the draft's `fields` names (all live fields when empty or naming none of them). */
const selectedFields = (model: ModelDefinition, draft: RequestDraft): FieldDefinition[] => {
  const live = model.fields.filter((field) => !field.deprecated);
  const names = new Set(splitList(draft.fields));
  const chosen = live.filter((field) => names.has(field.apiKey));
  return chosen.length > 0 ? chosen : live;
};

const selection = (fields: readonly FieldDefinition[], indent: string) =>
  ['id', ...fields.map(selectionOf)].map((line) => `${indent}${line}`).join('\n');

const readArguments = (draft: RequestDraft): Array<[string, string]> => {
  const args: Array<[string, string]> = [];
  if (draft.locale.trim()) {
    args.push(['locale', JSON.stringify(draft.locale.trim())]);
  }
  if (INTEGER.test(draft.snapshot.trim())) {
    args.push(['snapshot', draft.snapshot.trim()]);
  }
  return args;
};

const listArguments = (model: ModelDefinition, draft: RequestDraft, skipped: string[]) => {
  const args: Array<[string, string]> = [];
  const filter = filterArgument(model, draft);
  skipped.push(...filter.skipped);
  if (filter.argument) {
    args.push(['filter', filter.argument]);
  }
  if (draft.sort.trim()) {
    const sort = sortArgument(model, draft.sort);
    if (sort) {
      args.push(['sort', sort]);
    } else {
      skipped.push('sort');
    }
  }
  if (draft.q.trim()) {
    args.push(['search', JSON.stringify(draft.q.trim())]);
  }
  for (const name of ['page', 'pageSize'] as const) {
    if (INTEGER.test(draft[name].trim())) {
      args.push([name, draft[name].trim()]);
    }
  }
  return args;
};

const call = (name: string, args: ReadonlyArray<[string, string]>) =>
  args.length === 0 ? name : `${name}(${args.map(([key, value]) => `${key}: ${value}`).join(', ')})`;

/** The query for one operation, carrying over what the REST draft for the same endpoint sets. */
export const graphqlQuery = (
  model: ModelDefinition,
  operation: GraphqlOperation,
  draft: RequestDraft,
): GraphqlQuery => {
  const skipped: string[] = [];
  if (draft.populate.trim()) {
    // GraphQL expands relations by selecting them; there is no populate argument.
    skipped.push('populate');
  }
  const fields = selectedFields(model, draft);
  if (operation.list) {
    const args = [...listArguments(model, draft, skipped), ...readArguments(draft)];
    const body = `  ${call(operation.name, args)} {\n    totalCount\n    nodes {\n${selection(fields, '      ')}\n    }\n  }`;
    return { query: `query {\n${body}\n}\n`, skipped };
  }
  const id = draft.id.trim();
  const byId = model.kind === 'collection';
  const args: Array<[string, string]> = [
    ...(byId ? [['id', id ? JSON.stringify(id) : '$id'] as [string, string]] : []),
    ...readArguments(draft),
  ];
  const header = byId && !id ? 'query ($id: ID!) {' : 'query {';
  const body = `  ${call(operation.name, args)} {\n${selection(fields, '    ')}\n  }`;
  return { query: `${header}\n${body}\n}\n`, skipped };
};
