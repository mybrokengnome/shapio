import { sql, type Expression, type RawBuilder } from 'kysely';

/**
 * Typed values, arrays and sequences (dialect boundary, ADR 0001). Array columns (`text[]`) are read and
 * written as JavaScript arrays at the driver boundary; a second dialect stores them as JSON text through
 * its value codec, so plain Kysely reads and writes of those columns stay unchanged.
 */

/** Element types an array parameter may carry. */
export type ArrayElementType = 'uuid' | 'text';

const ARRAY_TYPES = {
  uuid: sql`uuid[]`,
  text: sql`text[]`,
} as const satisfies Record<ArrayElementType, RawBuilder<unknown>>;

/**
 * A bound value read as a UUID.
 * PostgreSQL: `cast($1 as uuid)`. Contract: compares equal to, and sorts like, UUID columns (a dialect
 * without a UUID type stores them as lowercase text, which sorts the same).
 */
export const uuidParam = (value: string | null): RawBuilder<string> => sql<string>`cast(${value} as uuid)`;

/**
 * `value` equals one of `values`, bound as a single parameter (so the statement text and plan do not
 * depend on the list length).
 * PostgreSQL: `value = any($1::uuid[])`. Contract: false for an empty list; null never matches.
 */
export const anyOf = (
  value: Expression<unknown>,
  values: readonly string[],
  type: ArrayElementType,
): RawBuilder<boolean> => sql<boolean>`${value} = any(${[...values]}::${ARRAY_TYPES[type]})`;

/**
 * An array column contains `value`.
 * PostgreSQL: `$1 = any(column)`. Contract: false for a null or empty array.
 */
export const arrayContains = (
  column: Expression<readonly string[] | null>,
  value: string,
): RawBuilder<boolean> => sql<boolean>`${value} = any(${column})`;

/**
 * The values of `column` across the group, sorted by the value itself (optionally distinct); null when the
 * group is empty (pair with `emptyArray` in a `coalesce`).
 * PostgreSQL: `array_agg([distinct] col order by col)`. Contract: a JavaScript array once read.
 */
export const sortedArrayAgg = <T>(column: string, options: { distinct?: boolean } = {}): RawBuilder<T[]> =>
  sql<
    T[]
  >`array_agg(${options.distinct ? sql`distinct ` : sql``}${sql.ref(column)} order by ${sql.ref(column)})`;

/**
 * An empty array of the given element type.
 * PostgreSQL: `'{}'::uuid[]`. Contract: an empty JavaScript array once read.
 */
export const emptyArray = <T>(type: ArrayElementType): RawBuilder<T[]> =>
  sql<T[]>`'{}'::${ARRAY_TYPES[type]}`;

/**
 * The value of the first row (by `orderColumn` descending) whose `column` is not null, per group.
 * PostgreSQL: `(array_agg(col order by o desc) filter (where col is not null))[1]`. Contract: null when no
 * row of the group has a value.
 */
export const latestNonNull = <T>(column: string, orderColumn: string): RawBuilder<T | null> =>
  sql<T | null>`(array_agg(${sql.ref(column)} order by ${sql.ref(orderColumn)} desc)
        filter (where ${sql.ref(column)} is not null))[1]`;

/** Database sequences Shapio uses. */
export type SequenceName = 'entry_heads_change_seq';

/**
 * The next value of a database sequence.
 * PostgreSQL: `nextval('name')`. Contract: unique and increasing across every transaction (gaps allowed;
 * a value may commit after a higher one). Returned as a string (bigint).
 */
export const nextSequenceValue = (name: SequenceName): RawBuilder<string> =>
  sql<string>`nextval(${sql.lit(name)})`;
