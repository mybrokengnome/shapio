import { sql, type Expression, type RawBuilder } from 'kysely';
import { isSqlite } from '../dialect.js';
import type { JsonArray } from '../types.js';
import { asJson } from './typed.js';

/**
 * JSON primitives for Shapio's own JSON columns and aggregates (dialect boundary, ADR 0001). Content
 * values are compiled by `content/compiler`, not here.
 *
 * `flavor` picks PostgreSQL's `jsonb` or `json` functions. Both read back as the same JavaScript value
 * (only key order differs); it exists so existing statements keep their exact SQL. SQLite has one JSON
 * type (JSON text) and ignores it.
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

const orderTerm = ({ column, direction = 'asc', nulls }: AggregateOrder) => {
  const placement = nulls ?? (isSqlite() ? DEFAULT_NULLS[direction] : undefined);
  return sql`${sql.ref(column)}${DIRECTIONS[direction]}${placement ? NULLS[placement] : sql``}`;
};

const pairs = (fields: Readonly<Record<string, Expression<unknown>>>) =>
  sql.join(Object.entries(fields).map(([key, value]) => sql`${sql.lit(key)}, ${value}`));

/**
 * A JSON object from named expressions. Keys are fixed by the caller's code (emitted as literals).
 * PostgreSQL: `jsonb_build_object('key', value, …)`. SQLite: `json_object('key', value, …)`.
 * Contract: a plain object once read.
 */
export const jsonObject = <T>(
  fields: Readonly<Record<string, Expression<unknown>>>,
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T> =>
  isSqlite()
    ? asJson<T>(sql`json_object(${pairs(fields)})`)
    : sql<T>`${FUNCTIONS[flavor].object}(${pairs(fields)})`;

/**
 * The group's values as a JSON array, in `orderBy` order; null when the group is empty (pair with
 * `emptyJsonArray` in a `coalesce`, and mark the coalesce with `asJson`).
 * PostgreSQL: `jsonb_agg(value order by …)`. SQLite: `json_group_array(value order by …)` (`[]` for an empty
 * group). Contract: an array once read.
 */
export const jsonAgg = <T>(
  value: Expression<unknown>,
  orderBy: readonly AggregateOrder[],
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T[]> => {
  const order = sql.join(orderBy.map(orderTerm));
  return isSqlite()
    ? asJson<T[]>(sql`json_group_array(${value} order by ${order})`)
    : sql<T[]>`${FUNCTIONS[flavor].agg}(${value} order by ${order})`;
};

/**
 * An empty JSON array.
 * PostgreSQL: `'[]'::jsonb`. SQLite: `json('[]')`. Contract: an empty JavaScript array once read.
 */
export const emptyJsonArray = <T>(flavor: JsonFlavor = 'jsonb'): RawBuilder<T[]> =>
  isSqlite() ? asJson<T[]>(sql`json('[]')`) : sql<T[]>`${FUNCTIONS[flavor].emptyArray}`;

/**
 * A JSON array column with `value` appended as one more element (a log that grows by one entry per write).
 * PostgreSQL: `column || $1::jsonb` with `[value]` bound. SQLite: `json_insert(column, '$[#]', json($1))`
 * with `value` bound as JSON. Contract: the stored array gains exactly one element at the end; the column
 * must not be null.
 */
export const jsonArrayAppend = (column: string, value: unknown): RawBuilder<JsonArray> =>
  isSqlite()
    ? sql<JsonArray>`json_insert(${sql.ref(column)}, '$[#]', json(${JSON.stringify(value)}))`
    : sql<JsonArray>`${sql.ref(column)} || ${JSON.stringify([value])}::jsonb`;
