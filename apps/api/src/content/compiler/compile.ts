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
  hasFieldIndex,
  modelIdLiteral,
  referenceIdsExpression,
  textMatchExpression,
  valueCastFor,
} from './expressions.js';
import { isListValued, NUMERIC_STRING_TYPES } from './operators.js';
import { compileRowFilter } from './policy.js';
import type {
  EntryListStatus,
  FilterNode,
  FilterOperator,
  FilterTarget,
  OrderTerm,
  ShownTargets,
} from './types.js';

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

const equalityTarget = ({ field }: FieldTarget): EqualityTarget => {
  const cast = SCALAR_DATA_TYPES.has(field.type) ? valueCastFor(field.type) : null;
  const list = isListValued(field);
  return {
    fieldId: field.id,
    cast,
    list,
    numericString: NUMERIC_STRING_TYPES.has(field.type),
    indexed: cast !== null && !list && hasFieldIndex(field),
  };
};

/** System filter columns. `createdAt` is the entry's, copied on every head (`h.entry_created_at`). */
const SYSTEM_COLUMNS = {
  id: 'h.entry_id',
  createdAt: 'h.entry_created_at',
  updatedAt: 'h.updated_at',
} as const;

/** Whether a filter names a column of `entries` (the head query's `e`), so its COUNT must join entries. */
export const filterReadsEntries = (node: FilterNode): boolean => {
  switch (node.kind) {
    case 'and':
    case 'or':
      return node.nodes.some(filterReadsEntries);
    case 'not':
      return filterReadsEntries(node.node);
    case 'condition':
      return node.target.kind === 'system' && SYSTEM_COLUMNS[node.target.name].startsWith('e.');
  }
};

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

/**
 * Whether the head `h` stores a reference the read shows: `exists` over the stored IDs (`v`), each looked up
 * as a target head of the same source, locale chain and row filter (relations: the target query reuses the
 * aliases `h` and `e`, so the row filter and the locale chain compile as for any head query), or as a live
 * asset of the site (media).
 */
const showsReference = (
  { field }: FieldTarget,
  shown: ShownTargets,
  dialect: ContentSqlDialect,
): RawBuilder<unknown> => {
  if (shown.kind === 'none') {
    return sql`false`;
  }
  const ids = referenceIdsExpression(field.id, isListValued(field), dialect);
  if (shown.kind === 'media') {
    return sql`exists (select 1 from ${ids.from} where exists (select 1 from media_assets m
      where ${ids.matches(sql`m.id`)} and m.site_id = ${dialect.uuid(shown.siteId)} and m.deleted_at is null))`;
  }
  const table =
    shown.source.kind === 'heads'
      ? sql.table('entry_heads')
      : sql`(${dialect.snapshotRows({ siteId: shown.siteId, modelIds: shown.members.map((member) => modelIdLiteral(member.modelId)), seq: shown.source.seq })})`;
  // A member with its own locale scope carries the scope's conditions with its row filter, inside its arm of
  // the OR; the shared scope is then `any` (plan interfaces, decision 7).
  const ownLocales = shown.members.some((member) => member.locales !== undefined);
  const members = shown.members.map((member) => {
    const rowFilter = compileRowFilter(member.rowFilter, shown.actor, dialect);
    const locales = ownLocales
      ? localeConditions(member.locales ?? shown.locales, table, shown.source, dialect)
      : [];
    return { modelId: member.modelId, conditions: [...locales, ...(rowFilter ? [rowFilter] : [])] };
  });
  const sharedLocales: LocaleScope = ownLocales ? { kind: 'any' } : shown.locales;
  const [single] = members;
  const matches = ids.matches(sql`h.entry_id`);
  const where = whereOf(
    members.length === 1 && single
      ? {
          siteId: shown.siteId,
          model: modelIs(single.modelId),
          source: shown.source,
          locales: sharedLocales,
          conditions: [matches, ...single.conditions],
        }
      : {
          siteId: shown.siteId,
          model: anyMember(members),
          source: shown.source,
          locales: sharedLocales,
          conditions: [matches],
        },
    table,
    dialect,
  );
  return sql`exists (select 1 from ${ids.from} where exists (select 1 from ${table} h
      join entries e on e.id = h.entry_id and e.deleted_at is null where ${where}))`;
};

const fieldCondition = (
  target: FieldTarget,
  operator: FilterOperator,
  value: unknown,
  dialect: ContentSqlDialect,
  shown?: ShownTargets,
): RawBuilder<unknown> => {
  const { field } = target;
  const equals = (item: unknown) => fieldEqualsExpression(equalityTarget(target), item, dialect);
  if (shown && (operator === '$null' || operator === '$notNull')) {
    // Null when no stored reference is shown (a missing value stores none).
    const present = showsReference(target, shown, dialect);
    return (operator === '$null') === value ? sql`(not ${present})` : present;
  }
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
      // Range and text matches are NULL on a missing value, and NOT NULL is NULL: coalescing makes `$not X`
      // exactly the entries `X` does not match, as `$ne`, `$nin` and `$notContains` already are.
      return sql`(not coalesce(${compileChild(node.node)}, false))`;
    case 'condition':
      return node.target.kind === 'system'
        ? systemCondition(node.target.name, node.operator, node.value, dialect)
        : fieldCondition(node.target, node.operator, node.value, dialect, node.shownTargets);
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
const sourceOf = (
  source: HeadSource,
  modelIds: readonly string[],
  siteId: string,
  dialect: ContentSqlDialect,
) => {
  if (source.kind === 'heads') {
    return { cte: null, table: sql.table('entry_heads') };
  }
  const cte = dialect.snapshotCte({
    name: SNAPSHOT_CTE,
    siteId,
    modelIds: modelIds.map(modelIdLiteral),
    seq: source.seq,
  });
  return { cte, table: sql.id(SNAPSHOT_CTE) };
};

/**
 * One model a head query reads, with what applies to its heads only. A family read sets `conditions` (its row
 * filter); an interface read (plan interfaces) sets all four, because its members hold the contract's fields
 * under their own field IDs and may differ in localization. Absent overrides compile exactly as before.
 */
export type HeadQueryMember = {
  modelId: string;
  /** ANDed after the plan's own conditions, on this member's heads only. */
  conditions?: readonly RawBuilder<unknown>[];
  /**
   * This member's sort expressions, term for term like `plan.orderBy` (same directions and nullability): an
   * arm projects and sorts by these, the union orders by the plan's terms' aliases.
   */
  orderBy?: readonly OrderTerm[];
  /** This member's locale scope; absent: the plan's. */
  locales?: LocaleScope;
  /** Whether this member's `conditions` name an `entries` column; absent: assumed whenever it has any. */
  conditionsReadEntries?: boolean;
};

export type HeadQueryPlan = {
  /**
   * The site whose content is read (sites plan §H). A tenancy boundary, always applied, separate from the
   * ownership row filter in `conditions`. It comes from the service context, never from the request.
   */
  siteId: string;
  /**
   * The models read: one, or the readable members of a family (plan polymorphic-types), each read as its own
   * UNION ALL arm so it keeps its partial indexes. Never empty.
   */
  members: readonly HeadQueryMember[];
  source: HeadSource;
  locales: LocaleScope;
  /** Extra conditions (filters, search, row filter, ID restriction), all ANDed, on every member. */
  conditions: readonly RawBuilder<unknown>[];
  /**
   * Whether any of `conditions` names an `entries` column (`e`: ownership row filters, the admin author filter,
   * `createdAt` filters). Unknown when absent: assumed whenever there are conditions. A member's own
   * conditions always count as naming one.
   */
  conditionsReadEntries?: boolean;
  orderBy: readonly OrderTerm[];
  limit?: number;
  offset?: number;
};

/** The members of a plan that reads one model. */
export const singleMember = (modelId: string): HeadQueryMember[] => [{ modelId }];

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

/** The heads one statement (or one arm of a family read) selects. */
type HeadScope = {
  siteId: string;
  /** The condition on `h.model_id`. */
  model: RawBuilder<unknown>;
  source: HeadSource;
  locales: LocaleScope;
  conditions: readonly RawBuilder<unknown>[];
};

const modelIs = (modelId: string) => sql`h.model_id = ${modelIdLiteral(modelId)}`;

/** Heads of any of the members, each under its own conditions (a relation's target family). */
const anyMember = (members: ReadonlyArray<{ modelId: string; conditions: readonly RawBuilder<unknown>[] }>) =>
  sql`(${sql.join(
    members.map((member) =>
      member.conditions.length === 0
        ? modelIs(member.modelId)
        : sql`(${modelIs(member.modelId)} and ${sql.join([...member.conditions], sql` and `)})`,
    ),
    sql` or `,
  )})`;

const whereOf = (scope: HeadScope, table: RawBuilder<unknown>, dialect: ContentSqlDialect) => {
  const conditions = [
    sql`h.site_id = ${dialect.uuid(scope.siteId)}`,
    scope.model,
    ...(scope.source.kind === 'heads' ? [sql`h.state = ${scope.source.state}`] : []),
    ...localeConditions(scope.locales, table, scope.source, dialect),
    ...scope.conditions,
  ];
  return sql.join(conditions, sql` and `);
};

/** Columns every head query returns. */
export type HeadRow = {
  entry_id: string;
  /** The head's model: the route's model, or the family member the entry is (plan polymorphic-types). */
  model_id: string;
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
 * The COUNT's FROM. Live heads exist only for live entries (deleting an entry removes its heads in the same
 * transaction; entries soft-deleted for having no head have none; `headLiveEntry.int.test.ts` pins it), so a
 * count of heads whose conditions name no `e` column needs no join: it is read from the heads' indexes alone
 * (the model index, or a field index for an indexed filter). A snapshot keeps the join: the publication log
 * still lists entries deleted since.
 */
const countFrom = (
  plan: HeadQueryPlan,
  member: HeadQueryMember,
  table: RawBuilder<unknown>,
  where: RawBuilder<unknown>,
  joined: RawBuilder<unknown>,
): RawBuilder<unknown> =>
  plan.source.kind === 'heads' &&
  !(plan.conditionsReadEntries ?? plan.conditions.length > 0) &&
  !(member.conditionsReadEntries ?? (member.conditions?.length ?? 0) > 0)
    ? sql`from ${table} h where ${where}`
    : joined;

const HEAD_COLUMNS = sql`h.entry_id, h.model_id, h.locale, h.data, h.version, h.revision_id, h.updated_at,
      h.autosaved_at, e.created_at, e.updated_at as entry_updated_at, e.created_by_admin_id, e.owner_app_user_id`;

/** The same columns read back from the union of a family read's arms (aliased `u`). */
const UNION_COLUMNS = sql`u.entry_id, u.model_id, u.locale, u.data, u.version, u.revision_id, u.updated_at,
      u.autosaved_at, u.created_at, u.entry_updated_at, u.created_by_admin_id, u.owner_app_user_id`;

const renderTerm = (expression: RawBuilder<unknown>, term: OrderTerm, dialect: ContentSqlDialect) =>
  dialect.sortTerm
    ? dialect.sortTerm(expression, term.direction, term.nullable)
    : sql`${expression} ${dialect.sortDirection(term.direction, term.nullable)}`;

const orderByOf = (terms: readonly RawBuilder<unknown>[]) =>
  terms.length > 0 ? sql` order by ${sql.join([...terms])}` : sql``;

/** The FROM, WHERE and COUNT FROM of one member's heads. */
const memberParts = (
  plan: HeadQueryPlan,
  member: HeadQueryMember,
  table: RawBuilder<unknown>,
  dialect: ContentSqlDialect,
) => {
  const where = whereOf(
    {
      siteId: plan.siteId,
      model: modelIs(member.modelId),
      source: plan.source,
      locales: member.locales ?? plan.locales,
      conditions: [...plan.conditions, ...(member.conditions ?? [])],
    },
    table,
    dialect,
  );
  const from = sql`from ${table} h join entries e on e.id = h.entry_id and e.deleted_at is null where ${where}`;
  return { from, counted: countFrom(plan, member, table, where, from) };
};

type HeadQueryParts = {
  prefix: RawBuilder<unknown>;
  columns: RawBuilder<unknown>;
  /** FROM … ORDER BY … LIMIT … OFFSET. */
  rows: RawBuilder<unknown>;
  /** A scalar subquery with the matching total. */
  total: RawBuilder<unknown>;
  /** The whole COUNT statement after the prefix. */
  count: RawBuilder<unknown>;
};

/** One model: the statement as it has always been. */
const singleParts = (
  plan: HeadQueryPlan,
  member: HeadQueryMember,
  table: RawBuilder<unknown>,
  dialect: ContentSqlDialect,
): Omit<HeadQueryParts, 'prefix'> => {
  const { from, counted } = memberParts(plan, member, table, dialect);
  const orderBy = orderByOf(
    (member.orderBy ?? plan.orderBy).map((term) => renderTerm(term.expression, term, dialect)),
  );
  const limit = plan.limit !== undefined ? sql` limit ${plan.limit}` : sql``;
  const offset = plan.offset ? sql` offset ${plan.offset}` : sql``;
  return {
    columns: HEAD_COLUMNS,
    rows: sql`${from}${orderBy}${limit}${offset}`,
    total: sql`(select count(*) ${counted})`,
    count: sql`select count(*) as total ${counted}`,
  };
};

/**
 * A family read (plan polymorphic-types): one arm per member, each `h.model_id = '<literal>'` with that
 * member's conditions, so each keeps its partial expression indexes and entry-order index. Each arm is a
 * derived table that projects the sort expressions as `s0…sn`, sorts and stops at `offset + limit` itself
 * (SQLite allows ORDER BY and LIMIT in a compound member only inside a derived table); the union is ordered
 * by the aliases and paged on the outside. The total is the sum of the arms' counts.
 */
const unionParts = (
  plan: HeadQueryPlan,
  table: RawBuilder<unknown>,
  dialect: ContentSqlDialect,
): Omit<HeadQueryParts, 'prefix'> => {
  const pageEnd = plan.limit !== undefined ? plan.limit + (plan.offset ?? 0) : undefined;
  const aliases = plan.orderBy.map((_term, index) => `s${index}`);
  const arms = plan.members.map((member, index) => {
    const terms = member.orderBy ?? plan.orderBy;
    const projected = terms.map(
      (term, position) => sql`${term.expression} as ${sql.id(aliases[position] as string)}`,
    );
    const { from, counted } = memberParts(plan, member, table, dialect);
    const columns = projected.length > 0 ? sql`${HEAD_COLUMNS}, ${sql.join(projected)}` : HEAD_COLUMNS;
    const orderBy =
      pageEnd !== undefined
        ? orderByOf(terms.map((term) => renderTerm(term.expression, term, dialect)))
        : sql``;
    const limit = pageEnd !== undefined ? sql` limit ${pageEnd}` : sql``;
    return {
      rows: sql`select * from (select ${columns}
      ${from}${orderBy}${limit}) ${sql.id(`a${index}`)}`,
      total: sql`(select count(*) ${counted})`,
    };
  });
  const orderBy = orderByOf(
    plan.orderBy.map((term, index) => renderTerm(sql.ref(`u.${aliases[index] as string}`), term, dialect)),
  );
  const limit = plan.limit !== undefined ? sql` limit ${plan.limit}` : sql``;
  const offset = plan.offset ? sql` offset ${plan.offset}` : sql``;
  const total = sql`(${sql.join(
    arms.map((arm) => arm.total),
    sql` + `,
  )})`;
  return {
    columns: UNION_COLUMNS,
    rows: sql`from (${sql.join(
      arms.map((arm) => arm.rows),
      sql`
      union all `,
    )}) u${orderBy}${limit}${offset}`,
    total,
    count: sql`select ${total} as total`,
  };
};

/** The parts every statement over a plan's heads shares. */
const headQueryParts = (plan: HeadQueryPlan, dialect: ContentSqlDialect): HeadQueryParts => {
  const [first] = plan.members;
  if (!first) {
    throw new Error('A head query reads at least one model');
  }
  const { cte, table } = sourceOf(
    plan.source,
    plan.members.map((member) => member.modelId),
    plan.siteId,
    dialect,
  );
  const parts =
    plan.members.length === 1 ? singleParts(plan, first, table, dialect) : unionParts(plan, table, dialect);
  return { prefix: cte ?? sql``, ...parts };
};

/** The SELECT for a plan: rows, plus the matching COUNT for pagination. */
export const compileHeadQuery = (plan: HeadQueryPlan, dialect: ContentSqlDialect = contentDialect()) => {
  const { prefix, columns, rows, count } = headQueryParts(plan, dialect);
  return {
    rows: sql<HeadRow>`${prefix}select ${columns}
      ${rows}`,
    count: sql<{
      total: string | number;
    }>`${prefix}${count}`,
  };
};

/** The page's total (when asked for) and the site's publication sequence, read in the same statement. */
export type HeadPageMeta = { page_total: string | number | null; page_seq: string | number | null };

/**
 * One delivery read as a single statement (plan delivery-perf): the page's heads with, on every row, the
 * matching total and the site's current publication sequence (`publication_state.last_seq`), so all three
 * come from one snapshot of the database on every dialect without a transaction. The uncorrelated
 * subqueries run once per statement. An empty page carries no row, so `meta` reads the total and the
 * sequence alone, for callers that read it in the same transaction as `rows`.
 */
export const compileHeadPage = (
  plan: HeadQueryPlan,
  options: { total: boolean },
  dialect: ContentSqlDialect = contentDialect(),
) => {
  const { prefix, columns, rows, total: counted } = headQueryParts(plan, dialect);
  const total = options.total ? counted : sql`null`;
  const seq = sql`(select ps.last_seq from publication_state ps where ps.site_id = ${dialect.uuid(plan.siteId)})`;
  return {
    rows: sql<HeadRow & HeadPageMeta>`${prefix}select ${columns}, ${total} as page_total, ${seq} as page_seq
      ${rows}`,
    meta: sql<HeadPageMeta>`${prefix}select ${total} as page_total, ${seq} as page_seq`,
  };
};
