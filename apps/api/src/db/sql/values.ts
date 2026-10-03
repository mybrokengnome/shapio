import { sql, type Expression, type RawBuilder } from 'kysely';
import { isSqlite } from '../dialect.js';
import { asBigint, asJson } from './typed.js';

/**
 * Typed values, arrays and sequences (dialect boundary, ADR 0001). Array columns (`text[]`) are read and
 * written as JavaScript arrays at the driver boundary; SQLite stores them as JSON text through its value
 * codec, so plain Kysely reads and writes of those columns stay unchanged.
 */

/** Element types an array parameter may carry. */
export type ArrayElementType = 'uuid' | 'text';

const ARRAY_TYPES = {
  uuid: sql`uuid[]`,
  text: sql`text[]`,
} as const satisfies Record<ArrayElementType, RawBuilder<unknown>>;

/**
 * A bound value read as a UUID.
 * PostgreSQL: `cast($1 as uuid)`. SQLite: the lowercased text (UUIDs are stored as lowercase text, which
 * compares and sorts like PostgreSQL's uuid; other values compare case-sensitively there).
 */
export const uuidParam = (value: string | null): RawBuilder<string> =>
  isSqlite()
    ? sql<string>`${value === null ? null : value.toLowerCase()}`
    : sql<string>`cast(${value} as uuid)`;

/**
 * `value` equals one of `values`, bound as a single parameter (so the statement text and plan do not
 * depend on the list length).
 * PostgreSQL: `value = any($1::uuid[])`. SQLite: `value in (select value from json_each($1))` with the list
 * bound as JSON. Contract: false for an empty list; null never matches.
 */
export const anyOf = (
  value: Expression<unknown>,
  values: readonly string[],
  type: ArrayElementType,
): RawBuilder<boolean> =>
  isSqlite()
    ? sql<boolean>`${value} in (select value from json_each(${JSON.stringify(values)}))`
    : sql<boolean>`${value} = any(${[...values]}::${ARRAY_TYPES[type]})`;

/**
 * An array column contains `value`.
 * PostgreSQL: `$1 = any(column)`. SQLite: `exists (select 1 from json_each(column) where value = $1)`.
 * Contract: false for a null or empty array.
 */
export const arrayContains = (
  column: Expression<readonly string[] | null>,
  value: string,
): RawBuilder<boolean> =>
  isSqlite()
    ? sql<boolean>`exists (select 1 from json_each(${column}) where value = ${value})`
    : sql<boolean>`${value} = any(${column})`;

/**
 * The values of `column` across the group, sorted by the value itself (optionally distinct); null when the
 * group is empty (pair with `emptyArray` in a `coalesce`, and mark the coalesce with `asJson`).
 * PostgreSQL: `array_agg([distinct] col order by col)`. SQLite: `json_group_array([distinct] col order by
 * col)`, which gives `[]` instead of null for an empty group. Contract: a JavaScript array once read.
 */
export const sortedArrayAgg = <T>(column: string, options: { distinct?: boolean } = {}): RawBuilder<T[]> => {
  const distinct = options.distinct ? sql`distinct ` : sql``;
  return isSqlite()
    ? asJson<T[]>(sql`json_group_array(${distinct}${sql.ref(column)} order by ${sql.ref(column)})`)
    : sql<T[]>`array_agg(${distinct}${sql.ref(column)} order by ${sql.ref(column)})`;
};

/**
 * An empty array of the given element type.
 * PostgreSQL: `'{}'::uuid[]`. SQLite: `'[]'`. Contract: an empty JavaScript array once read.
 */
export const emptyArray = <T>(type: ArrayElementType): RawBuilder<T[]> =>
  isSqlite() ? asJson<T[]>(sql`'[]'`) : sql<T[]>`'{}'::${ARRAY_TYPES[type]}`;

/**
 * The value of the first row (by `orderColumn` descending) whose `column` is not null, per group.
 * PostgreSQL: `(array_agg(col order by o desc) filter (where col is not null))[1]`. SQLite: the first
 * element of the matching `json_group_array`. Contract: null when no row of the group has a value. Mark the
 * selected result with its type (e.g. `asBigint`) for SQLite.
 */
export const latestNonNull = <T>(column: string, orderColumn: string): RawBuilder<T | null> =>
  isSqlite()
    ? sql<T | null>`(json_group_array(${sql.ref(column)} order by ${sql.ref(orderColumn)} desc)
        filter (where ${sql.ref(column)} is not null)) ->> 0`
    : sql<T | null>`(array_agg(${sql.ref(column)} order by ${sql.ref(orderColumn)} desc)
        filter (where ${sql.ref(column)} is not null))[1]`;

/** Database sequences Shapio uses. */
export type SequenceName = 'entry_heads_change_seq';

/**
 * The next value of a database sequence.
 * PostgreSQL: `nextval('name')`. SQLite: `shapio_nextval('name')`, a counter row in `sequences` that rolls
 * back with its transaction (so SQLite numbers have no gaps). Contract: unique and increasing across every
 * transaction (gaps allowed; a value may commit after a higher one). Returned as a string (bigint).
 */
export const nextSequenceValue = (name: SequenceName): RawBuilder<string> =>
  isSqlite() ? asBigint(sql`shapio_nextval(${sql.lit(name)})`) : sql<string>`nextval(${sql.lit(name)})`;
