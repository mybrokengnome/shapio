import type { TypeCast } from 'mysql2';

/**
 * The MySQL value codec (ADR 0001, "MySQL"). Shapio's PostgreSQL types map to MySQL like this, and rows
 * read back with the JavaScript shape `pg` gives them:
 *
 * | PostgreSQL      | MySQL                                   | read as                     |
 * | --------------- | --------------------------------------- | --------------------------- |
 * | uuid            | CHAR(36) ascii, case-insensitive        | string                      |
 * | text            | VARCHAR(n) (keys) / LONGTEXT, 0900_bin  | string                      |
 * | timestamptz     | DATETIME(6), UTC                        | Date                        |
 * | date            | DATE                                    | `YYYY-MM-DD` string         |
 * | jsonb / text[]  | JSON                                    | parsed value                |
 * | boolean         | TINYINT(1)                              | boolean                     |
 * | bigint          | BIGINT                                  | decimal string              |
 * | integer / real  | INT / FLOAT                             | number                      |
 *
 * Parameters: plain objects and arrays are bound as JSON text (mysql2 would otherwise expand an object into
 * `key = value` pairs and an array into a list), Dates as UTC `DATETIME` text, booleans as 1/0. `undefined`
 * is refused rather than written as NULL.
 */

/** A parameter that cannot be bound; never silently written as NULL. */
export class MysqlBindError extends TypeError {
  constructor(index: number, value: unknown) {
    const kind = value === undefined ? 'undefined' : (value?.constructor?.name ?? typeof value);
    super(`Cannot bind ${kind} to MySQL parameter ${index + 1}`);
    this.name = 'MysqlBindError';
  }
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A Date as MySQL `DATETIME(6)` text in UTC (millisecond precision, the precision of a Date). */
export const formatDatetime = (date: Date): string =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;

const ISO_UTC = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:?00)$/;

/**
 * A timestamp parameter as `DATETIME(6)` text. ISO-8601 UTC text keeps all its fractional digits (keyset
 * cursors carry microseconds); other text is parsed as a Date. Throws on an invalid time.
 */
export const toDatetimeText = (value: Date | string): string => {
  if (typeof value === 'string') {
    const match = ISO_UTC.exec(value);
    if (match) {
      return `${match[1]} ${match[2]}.${(match[3] ?? '').padEnd(6, '0')}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid timestamp: ${String(value)}`);
  }
  return formatDatetime(date);
};

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

/** A JavaScript value as a mysql2 parameter (see the table above). */
export const encodeParameter = (value: unknown, index: number): unknown => {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'bigint':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    case 'object':
      if (value === null || value instanceof Uint8Array) {
        return value;
      }
      if (value instanceof Date) {
        return formatDatetime(value);
      }
      if (Array.isArray(value) || isPlainObject(value)) {
        return JSON.stringify(value);
      }
      throw new MysqlBindError(index, value);
    default:
      throw new MysqlBindError(index, value);
  }
};

/**
 * Decodes result columns: `TINYINT(1)` as boolean (MySQL's boolean), `DATE` as `YYYY-MM-DD` text.
 * DATETIME (UTC Dates), JSON (parsed), BIGINT/DECIMAL (strings) are decoded by the pool options.
 */
export const typeCast: TypeCast = (field, next) => {
  if (field.type === 'TINY' && field.length === 1) {
    const text = field.string();
    return text === null ? null : text !== '0';
  }
  if (field.type === 'DATE') {
    return field.string();
  }
  return next();
};
