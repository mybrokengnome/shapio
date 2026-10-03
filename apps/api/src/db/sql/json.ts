import { sql, type Expression, type RawBuilder } from 'kysely';
import type { JsonArray } from '../types.js';

/**
 * JSON primitives for Shapio's own JSON columns and aggregates (dialect boundary, ADR 0001). Content
 * values are compiled by `content/compiler`, not here.
 *
 * `flavor` picks PostgreSQL's `jsonb` or `json` functions. Both read back as the same JavaScript value
 * (only key order differs); it exists so existing statements keep their exact SQL. A second dialect has one
 * JSON type and ignores it.
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

const orderTerm = ({ column, direction = 'asc', nulls }: AggregateOrder) =>
  sql`${sql.ref(column)}${DIRECTIONS[direction]}${nulls ? NULLS[nulls] : sql``}`;

/**
 * A JSON object from named expressions. Keys are fixed by the caller's code (emitted as literals).
 * PostgreSQL: `jsonb_build_object('key', value, …)`. Contract: a plain object once read.
 */
export const jsonObject = <T>(
  fields: Readonly<Record<string, Expression<unknown>>>,
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T> =>
  sql<T>`${FUNCTIONS[flavor].object}(${sql.join(
    Object.entries(fields).map(([key, value]) => sql`${sql.lit(key)}, ${value}`),
  )})`;

/**
 * The group's values as a JSON array, in `orderBy` order; null when the group is empty (pair with
 * `emptyJsonArray` in a `coalesce`).
 * PostgreSQL: `jsonb_agg(value order by …)`. Contract: an array once read.
 */
export const jsonAgg = <T>(
  value: Expression<unknown>,
  orderBy: readonly AggregateOrder[],
  flavor: JsonFlavor = 'jsonb',
): RawBuilder<T[]> =>
  sql<T[]>`${FUNCTIONS[flavor].agg}(${value} order by ${sql.join(orderBy.map(orderTerm))})`;

/**
 * An empty JSON array.
 * PostgreSQL: `'[]'::jsonb`. Contract: an empty JavaScript array once read.
 */
export const emptyJsonArray = <T>(flavor: JsonFlavor = 'jsonb'): RawBuilder<T[]> =>
  sql<T[]>`${FUNCTIONS[flavor].emptyArray}`;

/**
 * A JSON array column with `value` appended as one more element (a log that grows by one entry per write).
 * PostgreSQL: `column || $1::jsonb` with `[value]` bound. Contract: the stored array gains exactly one
 * element at the end; the column must not be null.
 */
export const jsonArrayAppend = (column: string, value: unknown): RawBuilder<JsonArray> =>
  sql<JsonArray>`${sql.ref(column)} || ${JSON.stringify([value])}::jsonb`;
