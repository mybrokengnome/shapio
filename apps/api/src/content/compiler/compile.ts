import { SCALAR_DATA_TYPES } from '@shapio/schema';
import { sql, type RawBuilder } from 'kysely';
import type { HeadState } from '../model.js';
import { contentDialect } from './currentDialect.js';
import type { ContentSqlDialect, EqualityTarget } from './dialect/types.js';
import {
  castParameter,
  containsInsensitiveExpression,
  fieldEqualsExpression,
  fieldMissingExpression,
  fieldValueExpression,
  modelIdLiteral,
  textMatchExpression,
  valueCastFor,
} from './expressions.js';
import { isListValued, NUMERIC_STRING_TYPES } from './operators.js';
import type { EntryListStatus, FilterNode, FilterOperator, FilterTarget } from './types.js';

/**
 * AST → parameterised SQL (Kysely `sql` fragments only). Every value is a bound parameter; the only
 * identifiers are fixed column names and stable field/model IDs that come from the registry and are checked
 * by `expressions.ts`. Head queries alias `entry_heads` (or a snapshot of it) as `h` and `entries` as `e`.
 * Database-specific spelling comes from the content dialect (`dialect/`), passed as the optional last
 * argument of every exported function (the process's dialect by default).
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

const anyOf = (parts: RawBuilder<unknown>[]): RawBuilder<unknown> =>
  parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` or `)})`;

type FieldTarget = Extract<FilterTarget, { kind: 'field' }>;

const equalityTarget = ({ field }: FieldTarget): EqualityTarget => ({
  fieldId: field.id,
  cast: SCALAR_DATA_TYPES.has(field.type) ? valueCastFor(field.type) : null,
  list: isListValued(field),
  numericString: NUMERIC_STRING_TYPES.has(field.type),
});

const SYSTEM_COLUMNS = { id: 'h.entry_id', createdAt: 'e.created_at', updatedAt: 'h.updated_at' } as const;

const systemCondition = (
  name: keyof typeof SYSTEM_COLUMNS,
  operator: FilterOperator,
  value: unknown,
  dialect: ContentSqlDialect,
): RawBuilder<unknown> => {
  const column = sql.ref(SYSTEM_COLUMNS[name]);
  const element = name === 'id' ? 'uuid' : 'timestamp';
  switch (operator) {
    case '$in':
      return sql`(${dialect.oneOf(column, value as string[], element)})`;
    case '$nin':
      return sql`(not (${dialect.oneOf(column, value as string[], element)}))`;
    default: {
      const parameter = name === 'id' ? dialect.uuid(value as string) : dialect.timestamp(value as string);
      return sql`(${column} ${RANGE_SQL[operator] ?? sql`=`} ${parameter})`;
    }
  }
};

const fieldCondition = (
  target: FieldTarget,
  operator: FilterOperator,
  value: unknown,
  dialect: ContentSqlDialect,
): RawBuilder<unknown> => {
  const { field } = target;
  const equals = (item: unknown) => fieldEqualsExpression(equalityTarget(target), item, dialect);
  switch (operator) {
    case '$eq':
      return equals(value);
    case '$ne':
      return sql`(not ${equals(value)})`;
    case '$in':
      return anyOf((value as unknown[]).map(equals));
    case '$nin':
      return sql`(not ${anyOf((value as unknown[]).map(equals))})`;
    case '$null':
    case '$notNull': {
      const missing = fieldMissingExpression(field.id, dialect);
      return (operator === '$null') === value ? missing : sql`(not ${missing})`;
    }
    case '$lt':
    case '$lte':
    case '$gt':
    case '$gte':
      return sql`(${fieldValueExpression(field.id, field.type, dialect)} ${RANGE_SQL[operator]} ${castParameter(value, field.type, dialect)})`;
    case '$contains':
    case '$startsWith':
    case '$endsWith':
    case '$notContains':
      return textMatchExpression(field.id, operator, value as string, dialect);
    case '$containsi':
      return containsInsensitiveExpression(field.id, value as string, dialect);
  }
};

/** A filter AST as one boolean SQL expression. */
export const compileFilter = (
  node: FilterNode,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => {
  const compileChild = (child: FilterNode) => compileFilter(child, dialect);
  switch (node.kind) {
    case 'and':
      return sql`(${sql.join(node.nodes.map(compileChild), sql` and `)})`;
    case 'or':
      return sql`(${sql.join(node.nodes.map(compileChild), sql` or `)})`;
    case 'not':
      return sql`(not ${compileChild(node.node)})`;
    case 'condition':
      return node.target.kind === 'system'
        ? systemCondition(node.target.name, node.operator, node.value, dialect)
        : fieldCondition(node.target, node.operator, node.value, dialect);
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
export const compileAuthorCondition = (
  adminUserId: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => sql`e.created_by_admin_id = ${dialect.uuid(adminUserId)}`;

/** Case-insensitive search of one text field. */
export const compileSearch = (
  fieldId: string,
  text: string,
  dialect: ContentSqlDialect = contentDialect(),
): RawBuilder<unknown> => containsInsensitiveExpression(fieldId, text, dialect);

const SNAPSHOT_CTE = 'content_snapshot';

/** The FROM item for a source, aliased `alias`, and the CTE it needs (snapshots only). */
const sourceOf = (source: HeadSource, modelId: string, siteId: string, dialect: ContentSqlDialect) => {
  if (source.kind === 'heads') {
    return { cte: null, table: sql.table('entry_heads') };
  }
  const cte = dialect.snapshotCte({
    name: SNAPSHOT_CTE,
    siteId,
    modelId: modelIdLiteral(modelId),
    seq: source.seq,
  });
  return { cte, table: sql.id(SNAPSHOT_CTE) };
};

export type HeadQueryPlan = {
  /**
   * The site whose content is read (sites plan §H). A tenancy boundary, always applied, separate from the
   * ownership row filter in `conditions`. It comes from the service context, never from the request.
   */
  siteId: string;
  modelId: string;
  source: HeadSource;
  locales: LocaleScope;
  /** Extra conditions (filters, search, row filter, ID restriction), all ANDed. */
  conditions: readonly RawBuilder<unknown>[];
  orderBy: readonly RawBuilder<unknown>[];
  /** Whether `orderBy` starts with an `entries` column (`sort.ts`, `leadsWithEntryColumn`). */
  orderedByEntry?: boolean;
  limit?: number;
  offset?: number;
};

const localeConditions = (
  scope: LocaleScope,
  table: RawBuilder<unknown>,
  source: HeadSource,
  dialect: ContentSqlDialect,
) => {
  if (scope.kind === 'any') {
    return [];
  }
  if (scope.chain.length === 1) {
    return [sql`h.locale = ${scope.chain[0]}`];
  }
  const chain = [...scope.chain];
  const stateMatch = source.kind === 'heads' ? sql` and h2.state = h.state` : sql``;
  return [
    dialect.oneOf(sql`h.locale`, chain, 'text'),
    // The first locale in the chain that has a head serves the entry; later ones are fallbacks.
    sql`not exists (select 1 from ${table} h2 where h2.entry_id = h.entry_id${stateMatch}
      and ${dialect.oneOf(sql`h2.locale`, chain, 'text')}
      and ${dialect.localeRank(chain, sql`h2.locale`)} < ${dialect.localeRank(chain, sql`h.locale`)})`,
  ];
};

const whereOf = (plan: HeadQueryPlan, table: RawBuilder<unknown>, dialect: ContentSqlDialect) => {
  const conditions = [
    sql`h.site_id = ${dialect.uuid(plan.siteId)}`,
    sql`h.model_id = ${modelIdLiteral(plan.modelId)}`,
    ...(plan.source.kind === 'heads' ? [sql`h.state = ${plan.source.state}`] : []),
    ...localeConditions(plan.locales, table, plan.source, dialect),
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

/**
 * The joined entry's site and model, which always equal the head's. Written out on the row query of a plain
 * list in `entries` order (the default newest-first sort) so the planner can walk `entries_model_idx` in that
 * order and stop at the page limit instead of sorting every head of the model. Not added when there are
 * conditions or the sort is on the head: SQLite then prefers the entries index over a field index that
 * serves the filter or the sort. Left off the COUNT, which reads every match either way.
 */
const entryScope = (plan: HeadQueryPlan, dialect: ContentSqlDialect): RawBuilder<unknown> =>
  plan.orderedByEntry === true && plan.conditions.length === 0
    ? sql` and e.site_id = ${dialect.uuid(plan.siteId)} and e.model_id = ${modelIdLiteral(plan.modelId)}`
    : sql``;

/**
 * The COUNT's FROM. Live heads exist only for live entries (deleting an entry removes its heads in the same
 * transaction; entries soft-deleted for having no head have none), so a count of heads with no condition
 * (conditions may name `e` columns) needs no join: it is read from `entry_heads_model_locale_state_idx`
 * alone. A snapshot keeps the join: the publication log still lists entries deleted since.
 */
const countFrom = (
  plan: HeadQueryPlan,
  table: RawBuilder<unknown>,
  where: RawBuilder<unknown>,
  joined: RawBuilder<unknown>,
): RawBuilder<unknown> =>
  plan.source.kind === 'heads' && plan.conditions.length === 0 ? sql`from ${table} h where ${where}` : joined;

/** The SELECT for a plan: rows, plus the matching COUNT for pagination. */
export const compileHeadQuery = (plan: HeadQueryPlan, dialect: ContentSqlDialect = contentDialect()) => {
  const { cte, table } = sourceOf(plan.source, plan.modelId, plan.siteId, dialect);
  const where = whereOf(plan, table, dialect);
  const from = sql`from ${table} h join entries e on e.id = h.entry_id and e.deleted_at is null where ${where}`;
  const prefix = cte ?? sql``;
  const orderBy = plan.orderBy.length > 0 ? sql` order by ${sql.join([...plan.orderBy])}` : sql``;
  const limit = plan.limit !== undefined ? sql` limit ${plan.limit}` : sql``;
  const offset = plan.offset ? sql` offset ${plan.offset}` : sql``;
  return {
    rows: sql<HeadRow>`${prefix}select h.entry_id, h.locale, h.data, h.version, h.revision_id, h.updated_at,
      h.autosaved_at, e.created_at, e.updated_at as entry_updated_at, e.created_by_admin_id, e.owner_app_user_id
      ${from}${entryScope(plan, dialect)}${orderBy}${limit}${offset}`,
    count: sql<{
      total: string | number;
    }>`${prefix}select count(*) as total ${countFrom(plan, table, where, from)}`,
  };
};
