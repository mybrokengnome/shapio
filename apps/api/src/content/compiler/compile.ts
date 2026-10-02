import { sql, type RawBuilder } from 'kysely';
import type { HeadState } from '../model.js';
import {
  castParameter,
  containmentExpression,
  fieldJsonExpression,
  fieldTextExpression,
  fieldValueExpression,
  modelIdLiteral,
} from './expressions.js';
import { isListValued, NUMERIC_STRING_TYPES } from './operators.js';
import type { EntryListStatus, FilterNode, FilterOperator, FilterTarget } from './types.js';

/**
 * AST → parameterised SQL (Kysely `sql` fragments only). Every value is a bound parameter; the only
 * identifiers are fixed column names and stable field/model IDs that come from the registry and are checked
 * by `expressions.ts`. Head queries alias `entry_heads` (or a snapshot of it) as `h` and `entries` as `e`.
 */

/** Where heads come from: live heads in one state, or published revisions as of a publication sequence. */
export type HeadSource = { kind: 'heads'; state: HeadState } | { kind: 'snapshot'; seq: number };

/** Which locale's head serves each entry. */
export type LocaleScope =
  /** Non-localized models: each entry has heads in exactly one locale. */
  | { kind: 'any' }
  /** The first locale of the chain that has a head serves the entry (fallback, ADR 0004). */
  | { kind: 'chain'; chain: readonly string[] };

const RANGE_SQL: Readonly<Partial<Record<FilterOperator, RawBuilder<unknown>>>> = {
  $lt: sql`<`,
  $lte: sql`<=`,
  $gt: sql`>`,
  $gte: sql`>=`,
  $eq: sql`=`,
  $ne: sql`<>`,
};

const MISSING_JSON = sql`('null'::jsonb, '""'::jsonb, '[]'::jsonb)`;

export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const likePattern = (operator: FilterOperator, text: string) => {
  const escaped = escapeLike(text);
  switch (operator) {
    case '$startsWith':
      return `${escaped}%`;
    case '$endsWith':
      return `%${escaped}`;
    default:
      return `%${escaped}%`;
  }
};

const anyOf = (parts: RawBuilder<unknown>[]): RawBuilder<unknown> =>
  parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` or `)})`;

const fieldEquals = (
  target: Extract<FilterTarget, { kind: 'field' }>,
  value: unknown,
): RawBuilder<unknown> => {
  const { field } = target;
  if (NUMERIC_STRING_TYPES.has(field.type)) {
    // "12.5" and "12.50" are equal numbers but different JSON strings: compare numerically.
    return sql`(${fieldValueExpression(field.id, field.type)} = ${castParameter(value, field.type)})`;
  }
  return containmentExpression({ [field.id]: isListValued(field) ? [value] : value });
};

const SYSTEM_COLUMNS = { id: 'h.entry_id', createdAt: 'e.created_at', updatedAt: 'h.updated_at' } as const;

const systemCondition = (
  name: keyof typeof SYSTEM_COLUMNS,
  operator: FilterOperator,
  value: unknown,
): RawBuilder<unknown> => {
  const column = sql.ref(SYSTEM_COLUMNS[name]);
  const cast = name === 'id' ? sql`uuid` : sql`timestamptz`;
  switch (operator) {
    case '$in':
      return sql`(${column} = any(${value}::${cast}[]))`;
    case '$nin':
      return sql`(not (${column} = any(${value}::${cast}[])))`;
    default:
      return sql`(${column} ${RANGE_SQL[operator] ?? sql`=`} ${value}::${cast})`;
  }
};

const fieldCondition = (
  target: Extract<FilterTarget, { kind: 'field' }>,
  operator: FilterOperator,
  value: unknown,
): RawBuilder<unknown> => {
  const { field } = target;
  switch (operator) {
    case '$eq':
      return fieldEquals(target, value);
    case '$ne':
      return sql`(not ${fieldEquals(target, value)})`;
    case '$in':
      return anyOf((value as unknown[]).map((item) => fieldEquals(target, item)));
    case '$nin':
      return sql`(not ${anyOf((value as unknown[]).map((item) => fieldEquals(target, item)))})`;
    case '$null':
    case '$notNull': {
      const json = fieldJsonExpression(field.id);
      const missing = sql`(${json} is null or ${json} in ${MISSING_JSON})`;
      return (operator === '$null') === value ? missing : sql`(not ${missing})`;
    }
    case '$lt':
    case '$lte':
    case '$gt':
    case '$gte':
      return sql`(${fieldValueExpression(field.id, field.type)} ${RANGE_SQL[operator]} ${castParameter(value, field.type)})`;
    case '$contains':
    case '$startsWith':
    case '$endsWith':
      return sql`(${fieldTextExpression(field.id)} like ${likePattern(operator, value as string)})`;
    case '$containsi':
      return sql`(${fieldTextExpression(field.id)} ilike ${likePattern(operator, value as string)})`;
    case '$notContains':
      return sql`(coalesce(${fieldTextExpression(field.id)}, '') not like ${likePattern(operator, value as string)})`;
  }
};

/** A filter AST as one boolean SQL expression. */
export const compileFilter = (node: FilterNode): RawBuilder<unknown> => {
  switch (node.kind) {
    case 'and':
      return sql`(${sql.join(node.nodes.map(compileFilter), sql` and `)})`;
    case 'or':
      return sql`(${sql.join(node.nodes.map(compileFilter), sql` or `)})`;
    case 'not':
      return sql`(not ${compileFilter(node.node)})`;
    case 'condition':
      return node.target.kind === 'system'
        ? systemCondition(node.target.name, node.operator, node.value)
        : fieldCondition(node.target, node.operator, node.value);
  }
};

/**
 * Admin list status of the served draft head `h`, against the published head of its locale (the same rule as
 * `statusOf`): no published head = draft; the same revision and no autosaved work = published; else modified.
 * Served by the entry_heads primary key.
 */
export const compileStatusCondition = (status: EntryListStatus): RawBuilder<unknown> => {
  const published = sql`select 1 from entry_heads p
    where p.entry_id = h.entry_id and p.locale = h.locale and p.state = 'published'`;
  switch (status) {
    case 'draft':
      return sql`not exists (${published})`;
    case 'published':
      return sql`(h.autosaved_at is null and exists (${published} and p.revision_id = h.revision_id))`;
    case 'modified':
      return sql`exists (${published} and (p.revision_id <> h.revision_id or h.autosaved_at is not null))`;
  }
};

/** Entries an admin user created (admin list `?author=`). */
export const compileAuthorCondition = (adminUserId: string): RawBuilder<unknown> =>
  sql`e.created_by_admin_id = ${adminUserId}::uuid`;

/** Case-insensitive search of one text field. */
export const compileSearch = (fieldId: string, text: string): RawBuilder<unknown> =>
  sql`(${fieldTextExpression(fieldId)} ilike ${`%${escapeLike(text)}%`})`;

const SNAPSHOT_CTE = 'content_snapshot';

/** The FROM item for a source, aliased `alias`, and the CTE it needs (snapshots only). */
const sourceOf = (source: HeadSource, modelId: string) => {
  if (source.kind === 'heads') {
    return { cte: null, table: sql.table('entry_heads') };
  }
  const cte = sql`with ${sql.id(SNAPSHOT_CTE)} as (
    select pl.entry_id, pl.model_id, pl.locale, 'published'::text as state, r.data, 0 as version,
      r.id as revision_id, pl.published_at as updated_at, null::timestamptz as autosaved_at
    from publication_log pl
    join content_revisions r on r.id = pl.revision_id
    where pl.model_id = ${modelIdLiteral(modelId)} and pl.from_seq <= ${source.seq}::bigint
      and (pl.to_seq is null or pl.to_seq > ${source.seq}::bigint)
  ) `;
  return { cte, table: sql.id(SNAPSHOT_CTE) };
};

export type HeadQueryPlan = {
  modelId: string;
  source: HeadSource;
  locales: LocaleScope;
  /** Extra conditions (filters, search, row filter, ID restriction), all ANDed. */
  conditions: readonly RawBuilder<unknown>[];
  orderBy: readonly RawBuilder<unknown>[];
  limit?: number;
  offset?: number;
};

const localeConditions = (scope: LocaleScope, table: RawBuilder<unknown>, source: HeadSource) => {
  if (scope.kind === 'any') {
    return [];
  }
  if (scope.chain.length === 1) {
    return [sql`h.locale = ${scope.chain[0]}`];
  }
  const chain = [...scope.chain];
  const stateMatch = source.kind === 'heads' ? sql` and h2.state = h.state` : sql``;
  return [
    sql`h.locale = any(${chain}::text[])`,
    // The first locale in the chain that has a head serves the entry; later ones are fallbacks.
    sql`not exists (select 1 from ${table} h2 where h2.entry_id = h.entry_id${stateMatch}
      and h2.locale = any(${chain}::text[])
      and array_position(${chain}::text[], h2.locale) < array_position(${chain}::text[], h.locale))`,
  ];
};

const whereOf = (plan: HeadQueryPlan, table: RawBuilder<unknown>) => {
  const conditions = [
    sql`h.model_id = ${modelIdLiteral(plan.modelId)}`,
    ...(plan.source.kind === 'heads' ? [sql`h.state = ${plan.source.state}`] : []),
    ...localeConditions(plan.locales, table, plan.source),
    ...plan.conditions,
  ];
  return sql.join(conditions, sql` and `);
};

/** Columns every head query returns. */
export type HeadRow = {
  entry_id: string;
  locale: string;
  data: Record<string, unknown>;
  version: number;
  revision_id: string;
  updated_at: Date;
  autosaved_at: Date | null;
  created_at: Date;
  entry_updated_at: Date;
  created_by_admin_id: string | null;
  owner_app_user_id: string | null;
};

/** The SELECT for a plan: rows, plus the matching COUNT for pagination. */
export const compileHeadQuery = (plan: HeadQueryPlan) => {
  const { cte, table } = sourceOf(plan.source, plan.modelId);
  const from = sql`from ${table} h join entries e on e.id = h.entry_id and e.deleted_at is null where ${whereOf(plan, table)}`;
  const prefix = cte ?? sql``;
  const orderBy = plan.orderBy.length > 0 ? sql` order by ${sql.join([...plan.orderBy])}` : sql``;
  const limit = plan.limit !== undefined ? sql` limit ${plan.limit}` : sql``;
  const offset = plan.offset ? sql` offset ${plan.offset}` : sql``;
  return {
    rows: sql<HeadRow>`${prefix}select h.entry_id, h.locale, h.data, h.version, h.revision_id, h.updated_at,
      h.autosaved_at, e.created_at, e.updated_at as entry_updated_at, e.created_by_admin_id, e.owner_app_user_id
      ${from}${orderBy}${limit}${offset}`,
    count: sql<{ total: string }>`${prefix}select count(*) as total ${from}`,
  };
};
