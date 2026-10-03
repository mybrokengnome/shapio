import { sql, type Expression, type RawBuilder } from 'kysely';

/**
 * Time primitives (dialect boundary, ADR 0001). Only SQL that creates, formats or casts a time value goes
 * through here. Comparing or sorting a timestamp column against a bound JavaScript `Date` stays plain Kysely:
 * it is portable as long as every dialect stores timestamps so that their order is time order (a second
 * dialect's value codec writes fixed-width UTC ISO-8601 text, `YYYY-MM-DDTHH:MM:SS.ssssssZ`).
 */

/**
 * The database server's current time.
 * PostgreSQL: `now()` (the transaction's start time). Contract: a UTC instant from the database clock.
 */
export const currentTimestamp = (): RawBuilder<Date> => sql<Date>`now()`;

/**
 * A bound value read as a timestamp (ISO-8601 text or a Date; null stays null).
 * PostgreSQL: `cast($1 as timestamptz)`. Contract: compares and sorts against timestamp columns as an
 * instant, at the precision the text carries (microseconds from `timestampCursorText`).
 */
export const timestampParam = (value: string | Date | null): RawBuilder<Date> =>
  sql<Date>`cast(${value} as timestamptz)`;

/**
 * A `YYYY-MM-DD` day as a SQL date (never a JS Date, whose time zone would shift it).
 * PostgreSQL: `$1::date`. Contract: compares against `date` columns by calendar day.
 */
export const dateParam = (day: string): RawBuilder<Date> => sql<Date>`${day}::date`;

/**
 * A timestamp column as fixed-width UTC text with the full stored precision, for keyset cursors: a
 * JavaScript Date (milliseconds) would skip or repeat rows written within one millisecond.
 * PostgreSQL: `to_char(col at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. Contract: the text
 * round-trips exactly through `timestampParam`, and its order is the column's order.
 */
export const timestampCursorText = (column: string): RawBuilder<string> =>
  sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * The largest of its arguments (nulls ignored; null only when all are null).
 * PostgreSQL: `greatest(a, b, …)`. Contract: the same null handling (SQLite's scalar `max` returns null
 * when any argument is null, so a second dialect wraps the arguments in `coalesce`).
 */
export const greatestOf = <T>(...values: Expression<T>[]): RawBuilder<T> =>
  sql<T>`greatest(${sql.join(values)})`;
