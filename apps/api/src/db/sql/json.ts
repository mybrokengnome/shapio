import { sql, type Expression, type RawBuilder } from 'kysely';
import { isMysql, isSqlite } from '../dialect.js';
import type { JsonArray } from '../types.js';
import { asJson } from './typed.js';
import { mysqlJsonArrayOf } from './values.js';

/**
 * JSON primitives for Shapio's own JSON columns and aggregates (dialect boundary, ADR 0001). Content
 * values are compiled by `content/compiler`, not here.
 *
 * `flavor` picks PostgreSQL's `jsonb` or `json` functions. Both read back as the same JavaScript value
 * (only key order differs); it exists so existing statements keep their exact SQL. SQLite has one JSON
 * type (JSON text) and ignores it, as does MySQL (`JSON`).
 *
 * On SQLite the values inside a JSON object or array are SQL scalars: text, numbers and null keep their
 * JSON type, a boolean column becomes 0/1 and a JSON column is embedded as a string. Shapio only builds JSON
 * from text, UUID and number columns here.
 */
export type JsonFlavor = 'jsonb' | 'json';

/** One ordering term of an aggregate. */
export type AggregateOrder = { column: string; direction?: 'asc' | 'desc'; nulls?: 'first' | 'last' };

const FUNCTIONS = {
  jsonb: { object: sql`jsonb_build_object`, agg: sql`jsonb_agg`, emptyArray: sql`'[]'::jsonb` },
  json: { object: sql`json_build_object`, agg: sql`json_agg`, emptyArray: sql`'[]'::json` },
} as const;

const DIRECTIONS = { asc: sql``, desc: sql` desc` } as const;
const NULLS = { first: sql` nulls first`, last: sql` nulls last` } as const;
/** PostgreSQL's default null placement, which SQLite reverses; written out on SQLite. */
const DEFAULT_NULLS = { asc: 'last', desc: 'first' } as const;

/** MySQL has no NULLS FIRST/LAST and sorts NULLs as the smallest value: sort on `col is null` first. */
const mysqlOrderTerm = ({ column, direction = 'asc', nulls }: AggregateOrder) => {
  const placement = nulls ?? DEFAULT_NULLS[direction];
  const nullsLast = placement === 'last';
  const mysqlNullsLast = direction === 'desc';
  const term = sql`${sql.ref(column)}${DIRECTIONS[direction]}`;
  return nullsLast === mysqlNullsLast
    ? term
    : sql`(${sql.ref(column)} is null)${nullsLast ? sql`` : sql` desc`}, ${term}`;
};

const orderTerm = (order: AggregateOrder) => {
  if (isMysql()) {
    return mysqlOrderTerm(order);
  }
  const { column, direction = 'asc', nulls } = order;
  const placement = nulls ?? (isSqlite() ? DEFAULT_NULLS[direction] : undefined);
  return sql`${sql.ref(column)}${DIRECTIONS[direction]}${placement ? NULLS[placement] : sql``}`;
};

const pairs = (fields: Readonly<Record<string, Expression<unknown>>>) =>
  sql.join(Object.entries(fields).map(([key, value]) => sql`${sql.lit(key)}, ${value}`));

/**
 * A JSON object from named expressions. Keys are fixed by the caller's code (emitted as literals).
 * PostgreSQL: `jsonb_build_object('key', value, …)`. SQLite and MySQL: `json_object('key', value, …)`.
 * Contract: a plain object once read.
 */
export const jsonObject = <T>(
  fields: Readonly<Record<string, Expression<unknown>>>,
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T> =>
  isSqlite() || isMysql()
    ? asJson<T>(sql`json_object(${pairs(fields)})`)
    : sql<T>`${FUNCTIONS[flavor].object}(${pairs(fields)})`;

/**
 * The group's values as a JSON array, in `orderBy` order; null when the group is empty (pair with
 * `emptyJsonArray` in a `coalesce`, and mark the coalesce with `asJson`).
 * PostgreSQL: `jsonb_agg(value order by …)`. SQLite: `json_group_array(value order by …)` (`[]` for an empty
 * group). MySQL: an ordered `group_concat` of each value as JSON, cast to JSON (null for an empty group).
 * Contract: an array once read.
 */
export const jsonAgg = <T>(
  value: Expression<unknown>,
  orderBy: readonly AggregateOrder[],
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T[]> => {
  const order = sql.join(orderBy.map(orderTerm));
  if (isMysql()) {
    // Each value as JSON (`json_extract(json_array(v), '$[0]')` quotes text and keeps JSON as JSON).
    return mysqlJsonArrayOf<T[]>(sql`json_extract(json_array(${value}), '$[0]') order by ${order}`);
  }
  return isSqlite()
    ? asJson<T[]>(sql`json_group_array(${value} order by ${order})`)
    : sql<T[]>`${FUNCTIONS[flavor].agg}(${value} order by ${order})`;
};

/**
 * An empty JSON array.
 * PostgreSQL: `'[]'::jsonb`. SQLite: `json('[]')`. MySQL: `json_array()`. Contract: an empty JavaScript
 * array once read.
 */
export const emptyJsonArray = <T>(flavor: JsonFlavor = 'jsonb'): RawBuilder<T[]> => {
  if (isMysql()) {
    return sql<T[]>`json_array()`;
  }
  return isSqlite() ? asJson<T[]>(sql`json('[]')`) : sql<T[]>`${FUNCTIONS[flavor].emptyArray}`;
};

/**
 * A JSON array column with `value` appended as one more element (a log that grows by one entry per write).
 * PostgreSQL: `column || $1::jsonb` with `[value]` bound. SQLite: `json_insert(column, '$[#]', json($1))`
 * with `value` bound as JSON. MySQL: `json_array_append(column, '$', cast($1 as json))`. Contract: the
 * stored array gains exactly one element at the end; the column must not be null.
 */
export const jsonArrayAppend = (column: string, value: unknown): RawBuilder<JsonArray> =>
  isMysql()
    ? sql<JsonArray>`json_array_append(${sql.ref(column)}, '$', cast(${JSON.stringify(value)} as json))`
    : isSqlite()
      ? sql<JsonArray>`json_insert(${sql.ref(column)}, '$[#]', json(${JSON.stringify(value)}))`
      : sql<JsonArray>`${sql.ref(column)} || ${JSON.stringify([value])}::jsonb`;
