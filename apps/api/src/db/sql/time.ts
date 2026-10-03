import { sql, type Expression, type RawBuilder } from 'kysely';
import { isMysql, isSqlite } from '../dialect.js';
import { toDatetimeText } from '../mysql/codec.js';
import { asText, asTimestamp } from './typed.js';

/**
 * Time primitives (dialect boundary, ADR 0001). Only SQL that creates, formats or casts a time value goes
 * through here. Comparing or sorting a timestamp column against a bound JavaScript `Date` stays plain Kysely:
 * it is portable as long as every dialect stores timestamps so that their order is time order.
 *
 * SQLite stores timestamps as fixed-width UTC ISO-8601 text with milliseconds (`toStoredTimestamp`), so text
 * order is time order. PostgreSQL keeps microseconds; SQLite's precision is the millisecond. MySQL stores
 * `DATETIME(6)` in UTC (the session time zone), microseconds like PostgreSQL.
 */

/**
 * The text SQLite stores for an instant: `YYYY-MM-DDTHH:MM:SS.sssZ` (24 characters, UTC, milliseconds).
 * Every timestamp written on SQLite has exactly this form (the driver's codec, column defaults and
 * `currentTimestamp`), so comparisons between stored values and bound values are text comparisons.
 * Accepts a Date or any text `Date` parses (sub-millisecond digits are truncated). Throws on an invalid time.
 */
export const toStoredTimestamp = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp: ${String(value)}`);
  }
  return date.toISOString();
};

/**
 * The database server's current time.
 * PostgreSQL: `now()` (the transaction's start time). SQLite: `shapio_now()`, the transaction's start time
 * too (milliseconds). MySQL: `current_timestamp(6)`, pinned to the transaction's start by the driver.
 * Contract: a UTC instant from the database clock, constant within a transaction.
 */
export const currentTimestamp = (): RawBuilder<Date> => {
  if (isMysql()) {
    // The driver pins the session timestamp to the transaction's start (`SET timestamp`).
    return sql<Date>`current_timestamp(6)`;
  }
  return isSqlite() ? asTimestamp(sql`shapio_now()`) : sql<Date>`now()`;
};

/**
 * A bound value read as a timestamp (ISO-8601 text or a Date; null stays null).
 * PostgreSQL: `cast($1 as timestamptz)`. SQLite: the value normalised by `toStoredTimestamp` and bound.
 * MySQL: `cast($1 as datetime(6))` with UTC `DATETIME` text (ISO text keeps its microseconds).
 * Contract: compares and sorts against timestamp columns as an instant, at the precision the text carries
 * (microseconds from `timestampCursorText` on PostgreSQL, milliseconds on SQLite).
 */
export const timestampParam = (value: string | Date | null): RawBuilder<Date> => {
  if (isMysql()) {
    return sql<Date>`cast(${value === null ? null : toDatetimeText(value)} as datetime(6))`;
  }
  if (isSqlite()) {
    return sql<Date>`${value === null ? null : toStoredTimestamp(value)}`;
  }
  return sql<Date>`cast(${value} as timestamptz)`;
};

/**
 * A `YYYY-MM-DD` day as a SQL date (never a JS Date, whose time zone would shift it).
 * PostgreSQL: `$1::date`. SQLite: the bound text (dates are stored as `YYYY-MM-DD`). MySQL: `cast($1 as date)`.
 * Contract: compares against `date` columns by calendar day.
 */
export const dateParam = (day: string): RawBuilder<Date> => {
  if (isMysql()) {
    return sql<Date>`cast(${day} as date)`;
  }
  return isSqlite() ? sql<Date>`${day}` : sql<Date>`${day}::date`;
};

/**
 * A timestamp column as fixed-width UTC text with the full stored precision, for keyset cursors: a
 * JavaScript Date (milliseconds) would skip or repeat rows written within one PostgreSQL microsecond.
 * PostgreSQL: `to_char(col at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`. SQLite: the stored text
 * itself (milliseconds). Contract: the text round-trips exactly through `timestampParam`, and its order is
 * the column's order. Cursors are opaque and only valid on the instance that issued them. MySQL:
 * `date_format(col, '%Y-%m-%dT%H:%i:%s.%fZ')` (microseconds; the session is UTC).
 */
export const timestampCursorText = (column: string): RawBuilder<string> => {
  if (isMysql()) {
    return sql<string>`date_format(${sql.ref(column)}, '%Y-%m-%dT%H:%i:%s.%fZ')`;
  }
  return isSqlite()
    ? asText(sql`(${sql.ref(column)} || '')`)
    : sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
};

/**
 * SQLite's scalar `max` and MySQL's `greatest` return null when any argument is null: coalesce each with
 * the others first.
 */
const nullSkippingGreatest = <T>(fn: 'max' | 'greatest', values: readonly Expression<T>[]): RawBuilder<T> => {
  if (values.length === 1) {
    return sql<T>`${values[0]}`;
  }
  const terms = values.map(
    (value, index) => sql`coalesce(${sql.join([value, ...values.filter((_, other) => other !== index)])})`,
  );
  return sql<T>`${sql.raw(fn)}(${sql.join(terms)})`;
};

/**
 * The largest of its arguments (nulls ignored; null only when all are null).
 * PostgreSQL: `greatest(a, b, …)`. SQLite: `max(coalesce(a, b, …), coalesce(b, a, …), …)`; MySQL the same
 * with `greatest`.
 * Contract: the same null handling. Mark the result (`asTimestamp`) when it is selected.
 */
export const greatestOf = <T>(...values: Expression<T>[]): RawBuilder<T> => {
  if (isMysql()) {
    return nullSkippingGreatest('greatest', values);
  }
  return isSqlite() ? nullSkippingGreatest('max', values) : sql<T>`greatest(${sql.join(values)})`;
};
