import {
  effectiveTitleField,
  isSeoField,
  isStableId,
  TEXT_TITLE_FIELD_TYPES,
  type FieldDefinition,
  type ModelDefinition,
} from '@shapio/schema';
import { findFieldByApiKey } from '../model.js';
import { assertOperatorAllowed, coerceOperand, isListOperator, isSortable } from './operators.js';
import { toList, type QueryTree, type QueryValue } from './querystring.js';
import {
  DEFAULT_RICH_TEXT_MODE,
  ENTRY_LIST_STATUSES,
  FILTER_OPERATORS,
  QUERY_LIMITS,
  queryForbidden,
  queryInvalid,
  RICH_TEXT_MODES,
  SEO_MODES,
  SYSTEM_ATTRIBUTES,
  type ContentQuery,
  type EntryListStatus,
  type FilterNode,
  type FilterOperator,
  type FilterTarget,
  type PopulateTree,
  type RichTextMode,
  type SeoMode,
  type SortTerm,
  type SystemAttribute,
} from './types.js';

/**
 * Querystring → content query AST, allowlisted against the pinned schema (brief §4 "runtime APIs"). Every
 * field name must be a live field of the model, every operator must be allowed for its type, and fields
 * outside the caller's read mask are rejected with 403 so filters, sorts and searches can never be used as
 * an oracle for hidden values (ADR 0005). Unknown parameters, fields and operators are 400s.
 */
export type ParseContext = {
  model: ModelDefinition;
  /** Locale codes the instance has. */
  locales: readonly string[];
  /** The read mask, per field. */
  isReadable: (field: FieldDefinition) => boolean;
  /** `?snapshot=N` is a delivery feature. */
  allowSnapshot: boolean;
  /** `?status=` and `?author=` are admin list features. */
  allowAdminFilters?: boolean;
  /** `?richText=` is a delivery and preview feature (admin reads return the stored document). */
  allowRichText?: boolean;
  /** `?seo=` is a delivery and preview feature. */
  allowSeo?: boolean;
  /** Target models of relation fields, for nested populate paths. */
  resolveModel: (modelId: string) => ModelDefinition | undefined;
};

const TOP_LEVEL_KEYS = new Set([
  'filters',
  'sort',
  'page',
  'pageSize',
  'fields',
  'populate',
  'locale',
  'snapshot',
  'richText',
  'seo',
  'q',
  'status',
  'author',
]);
const OPERATOR_SET: ReadonlySet<string> = new Set(FILTER_OPERATORS);

const isTree = (value: QueryValue | undefined): value is QueryTree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const single = (value: QueryValue | undefined, name: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw queryInvalid(`"${name}" must be given once`);
  }
  return value;
};

const positiveInteger = (value: QueryValue | undefined, name: string, max: number): number | undefined => {
  const text = single(value, name);
  if (text === undefined) {
    return undefined;
  }
  if (!/^\d{1,15}$/.test(text) || Number(text) < 1 || Number(text) > max) {
    throw queryInvalid(`"${name}" must be an integer between 1 and ${max}`);
  }
  return Number(text);
};

type FilterState = { context: ParseContext; conditions: number };

const resolveTarget = (context: ParseContext, key: string): FilterTarget => {
  if ((SYSTEM_ATTRIBUTES as readonly string[]).includes(key)) {
    return { kind: 'system', name: key as SystemAttribute };
  }
  const field = findFieldByApiKey(context.model.fields, key);
  if (!field) {
    throw queryInvalid(`Unknown field "${key}"`, { field: key });
  }
  if (!context.isReadable(field)) {
    throw queryForbidden(`You may not filter, sort or search on "${key}"`, { field: key });
  }
  return { kind: 'field', field };
};

const conditionFor = (
  state: FilterState,
  target: FilterTarget,
  operator: string,
  raw: QueryValue,
  label: string,
): FilterNode => {
  if (!OPERATOR_SET.has(operator)) {
    throw queryInvalid(`Unknown operator "${operator}" on "${label}"`);
  }
  const op = operator as FilterOperator;
  state.conditions += 1;
  if (state.conditions > QUERY_LIMITS.maxConditions) {
    throw queryInvalid(`At most ${QUERY_LIMITS.maxConditions} filter conditions are allowed`);
  }
  assertOperatorAllowed(target, op, label);
  if (isTree(raw) && !isListOperator(op)) {
    throw queryInvalid(`"${label}" ${op} needs a value`);
  }
  const operand = isListOperator(op) ? toList(raw) : raw;
  if (!isListOperator(op) && Array.isArray(operand)) {
    throw queryInvalid(`"${label}" ${op} needs a single value`);
  }
  return {
    kind: 'condition',
    target,
    operator: op,
    value: coerceOperand(target, op, operand, label, QUERY_LIMITS.maxInValues),
  };
};

const combine = (kind: 'and' | 'or', nodes: FilterNode[]): FilterNode =>
  nodes.length === 1 ? (nodes[0] as FilterNode) : { kind, nodes };

const parseFilterTree = (state: FilterState, tree: QueryTree, depth: number): FilterNode => {
  if (depth > QUERY_LIMITS.maxFilterDepth) {
    throw queryInvalid('Filters are nested too deeply');
  }
  const nodes: FilterNode[] = [];
  for (const [key, value] of Object.entries(tree)) {
    if (key === '$and' || key === '$or') {
      const children = toList(value, { commas: false }).map((child) => {
        if (!isTree(child)) {
          throw queryInvalid(`${key} needs a list of filter objects`);
        }
        return parseFilterTree(state, child, depth + 1);
      });
      if (children.length === 0) {
        throw queryInvalid(`${key} needs at least one filter`);
      }
      nodes.push(combine(key === '$and' ? 'and' : 'or', children));
    } else if (key === '$not') {
      if (!isTree(value)) {
        throw queryInvalid('$not needs a filter object');
      }
      nodes.push({ kind: 'not', node: parseFilterTree(state, value, depth + 1) });
    } else if (key.startsWith('$')) {
      throw queryInvalid(`Unknown filter keyword "${key}"`);
    } else {
      const target = resolveTarget(state.context, key);
      if (!isTree(value)) {
        nodes.push(conditionFor(state, target, '$eq', value, key));
        continue;
      }
      const operators = Object.entries(value);
      if (operators.length === 0) {
        throw queryInvalid(`"${key}" needs an operator`);
      }
      nodes.push(
        combine(
          'and',
          operators.map(([operator, operand]) => conditionFor(state, target, operator, operand, key)),
        ),
      );
    }
  }
  if (nodes.length === 0) {
    throw queryInvalid('Empty filter');
  }
  return combine('and', nodes);
};

const parseSort = (context: ParseContext, value: QueryValue | undefined): SortTerm[] => {
  const items = toList(value);
  if (items.length > QUERY_LIMITS.maxSortTerms) {
    throw queryInvalid(`At most ${QUERY_LIMITS.maxSortTerms} sort terms are allowed`);
  }
  return items.map((item) => {
    if (typeof item !== 'string') {
      throw queryInvalid('sort needs "field" or "field:asc|desc" values');
    }
    const [key = '', direction = 'asc', extra] = item.split(':');
    if (extra !== undefined || (direction !== 'asc' && direction !== 'desc')) {
      throw queryInvalid(`Invalid sort "${item}"`);
    }
    const target = resolveTarget(context, key);
    if (target.kind === 'field' && !isSortable(target.field)) {
      throw queryInvalid(`"${key}" is not sortable: mark it sortable first`);
    }
    return { target, direction };
  });
};

const parseFields = (context: ParseContext, value: QueryValue | undefined): FieldDefinition[] | null => {
  if (value === undefined) {
    return null;
  }
  return toList(value).map((item) => {
    if (typeof item !== 'string') {
      throw queryInvalid('fields needs a list of field names');
    }
    const target = resolveTarget(context, item);
    if (target.kind === 'system') {
      throw queryInvalid(`"${item}" is always returned; list only model fields`);
    }
    return target.field;
  });
};

const relationField = (context: ParseContext, model: ModelDefinition, key: string): FieldDefinition => {
  const field = findFieldByApiKey(model.fields, key);
  if (!field || field.type !== 'relation') {
    throw queryInvalid(`"${key}" is not a relation of "${model.apiKey}" and cannot be populated`);
  }
  if (model.id === context.model.id && !context.isReadable(field)) {
    throw queryForbidden(`You may not populate "${key}"`, { field: key });
  }
  return field;
};

type MutablePopulate = Map<string, MutablePopulate>;

const parsePopulate = (context: ParseContext, value: QueryValue | undefined): PopulateTree => {
  const root: MutablePopulate = new Map();
  for (const item of toList(value)) {
    if (typeof item !== 'string') {
      throw queryInvalid('populate needs a list of relation paths');
    }
    if (item === '*') {
      for (const field of context.model.fields) {
        if (field.type === 'relation' && !field.deprecated && context.isReadable(field)) {
          root.set(field.id, root.get(field.id) ?? new Map<string, MutablePopulate>());
        }
      }
      continue;
    }
    const segments = item.split('.');
    if (segments.length > QUERY_LIMITS.maxPopulateDepth) {
      throw queryInvalid(`populate is limited to ${QUERY_LIMITS.maxPopulateDepth} levels`);
    }
    let model: ModelDefinition | undefined = context.model;
    let node = root;
    for (const segment of segments) {
      if (!model) {
        throw queryInvalid(`Cannot populate "${item}"`);
      }
      const field = relationField(context, model, segment);
      const next: MutablePopulate = node.get(field.id) ?? new Map<string, MutablePopulate>();
      node.set(field.id, next);
      node = next;
      model = field.type === 'relation' ? context.resolveModel(field.settings.target) : undefined;
    }
  }
  return root;
};

const parseSearch = (context: ParseContext, value: QueryValue | undefined): ContentQuery['search'] => {
  const text = single(value, 'q')?.trim();
  if (!text) {
    return null;
  }
  const field = effectiveTitleField(context.model);
  if (!field || !TEXT_TITLE_FIELD_TYPES.has(field.type)) {
    throw queryInvalid(`"${context.model.apiKey}" has no text title field to search`);
  }
  if (!context.isReadable(field)) {
    throw queryForbidden('You may not search this model', { field: field.apiKey });
  }
  return { field, text };
};

/** Parses a bracket querystring tree into a content query for one model. */
const STATUS_SET: ReadonlySet<string> = new Set(ENTRY_LIST_STATUSES);

/** `status` and `author` (admin lists only). */
const parseAdminFilters = (tree: QueryTree, context: ParseContext) => {
  const status = single(tree.status, 'status');
  const author = single(tree.author, 'author');
  if ((status !== undefined || author !== undefined) && !context.allowAdminFilters) {
    throw queryInvalid('"status" and "author" are only available on the admin API');
  }
  if (status !== undefined && !STATUS_SET.has(status)) {
    throw queryInvalid(`"status" must be one of ${ENTRY_LIST_STATUSES.join(', ')}`);
  }
  if (author !== undefined && !isStableId(author)) {
    throw queryInvalid('"author" must be an admin user ID');
  }
  return {
    ...(status !== undefined ? { status: status as EntryListStatus } : {}),
    ...(author !== undefined ? { author } : {}),
  };
};

const RICH_TEXT_MODE_SET: ReadonlySet<string> = new Set(RICH_TEXT_MODES);

/** `?richText=json|html|both` on delivery and preview reads; the default there, nothing on admin reads. */
const parseRichText = (tree: QueryTree, context: ParseContext): { richText?: RichTextMode } => {
  const value = single(tree.richText, 'richText');
  if (!context.allowRichText) {
    if (value !== undefined) {
      throw queryInvalid('richText is only available on the delivery and preview APIs');
    }
    return {};
  }
  if (value !== undefined && !RICH_TEXT_MODE_SET.has(value)) {
    throw queryInvalid(`"richText" must be one of ${RICH_TEXT_MODES.join(', ')}`);
  }
  return { richText: (value as RichTextMode | undefined) ?? DEFAULT_RICH_TEXT_MODE };
};

const SEO_MODE_SET: ReadonlySet<string> = new Set(SEO_MODES);

/** `?seo=raw|resolved` on delivery and preview reads; `resolved` needs a readable SEO field on the model. */
const parseSeo = (tree: QueryTree, context: ParseContext): { seo?: SeoMode } => {
  const value = single(tree.seo, 'seo');
  if (value === undefined) {
    return {};
  }
  if (!context.allowSeo) {
    throw queryInvalid('seo is only available on the delivery and preview APIs');
  }
  if (!SEO_MODE_SET.has(value)) {
    throw queryInvalid(`"seo" must be one of ${SEO_MODES.join(', ')}`);
  }
  if (
    value === 'resolved' &&
    !context.model.fields.some((field) => !field.deprecated && isSeoField(field) && context.isReadable(field))
  ) {
    throw queryInvalid(`"${context.model.apiKey}" has no SEO field to resolve`);
  }
  return { seo: value as SeoMode };
};

export const parseContentQuery = (tree: QueryTree, context: ParseContext): ContentQuery => {
  for (const key of Object.keys(tree)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw queryInvalid(`Unknown query parameter "${key}"`);
    }
  }
  const filters = tree.filters;
  if (filters !== undefined && !isTree(filters)) {
    throw queryInvalid('filters needs field conditions, e.g. filters[title][$eq]=Hello');
  }
  const locale = single(tree.locale, 'locale');
  if (locale !== undefined && !context.locales.includes(locale)) {
    throw queryInvalid(`Unknown locale "${locale}"`);
  }
  const snapshot = positiveInteger(tree.snapshot, 'snapshot', Number.MAX_SAFE_INTEGER);
  if (snapshot !== undefined && !context.allowSnapshot) {
    throw queryInvalid('snapshot is only available on the delivery API');
  }
  return {
    filter: filters ? parseFilterTree({ context, conditions: 0 }, filters, 1) : null,
    search: parseSearch(context, tree.q),
    sort: parseSort(context, tree.sort),
    page: positiveInteger(tree.page, 'page', 1_000_000) ?? 1,
    pageSize:
      positiveInteger(tree.pageSize, 'pageSize', QUERY_LIMITS.maxPageSize) ?? QUERY_LIMITS.defaultPageSize,
    fields: parseFields(context, tree.fields),
    populate: parsePopulate(context, tree.populate),
    locale,
    snapshot,
    ...parseRichText(tree, context),
    ...parseSeo(tree, context),
    ...parseAdminFilters(tree, context),
  };
};
