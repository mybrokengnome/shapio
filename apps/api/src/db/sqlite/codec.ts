import type { SQLInputValue } from 'node:sqlite';
import { toStoredTimestamp } from '../sql/time.js';
import type { ResultType } from '../sql/typed.js';

/**
 * The SQLite value codec (ADR 0001, "Dialect boundary"). SQLite has five storage classes, so Shapio's
 * PostgreSQL types are declared with names that keep both the storage affinity right (`text_*` → TEXT,
 * `integer_*`/`bigint` → INTEGER) and the original type readable; the driver decodes every result column by
 * its declared type (`StatementSync.columns()` reports it even through subqueries, CTEs and RETURNING), so
 * rows have the same JavaScript shape as on PostgreSQL:
 *
 * | PostgreSQL     | declared            | stored                          | read as            |
 * | -------------- | ------------------- | ------------------------------- | ------------------ |
 * | timestamptz    | text_timestamptz    | `YYYY-MM-DDTHH:MM:SS.sssZ`      | Date               |
 * | date           | text_date           | `YYYY-MM-DD`                    | string             |
 * | jsonb / json   | text_jsonb / _json  | JSON text                       | parsed value       |
 * | text[] / uuid[]| text_array / _uuid_array | JSON array text            | string[]           |
 * | uuid           | text_uuid           | lowercase text                  | string             |
 * | boolean        | integer_boolean     | 0 / 1                           | boolean            |
 * | bigint         | bigint              | integer                         | decimal string     |
 * | integer        | integer             | integer                         | number             |
 * | real / double  | real / double       | real                            | number             |
 */
export const DECLARED_TYPES = {
  timestamptz: 'text_timestamptz',
  date: 'text_date',
  jsonb: 'text_jsonb',
  json: 'text_json',
  textArray: 'text_array',
  uuidArray: 'text_uuid_array',
  uuid: 'text_uuid',
  boolean: 'integer_boolean',
  bigint: 'bigint',
  integer: 'integer',
  real: 'real',
  double: 'double',
  text: 'text',
} as const;

/**
 * `bigint` identity primary keys. SQLite only makes a column its auto-incrementing row ID when it is
 * declared exactly `INTEGER PRIMARY KEY`, so these read back as strings by name instead of by type.
 */
export const BIGINT_ROWID_COLUMNS: ReadonlySet<string> = new Set(['outbox_events.id', 'publication_log.id']);

/** A parameter that cannot be stored; never silently written as NULL. */
export class SqliteBindError extends TypeError {
  constructor(index: number, value: unknown) {
    const kind = value === undefined ? 'undefined' : (value?.constructor?.name ?? typeof value);
    super(`Cannot bind ${kind} to SQLite parameter ${index + 1}`);
    this.name = 'SqliteBindError';
  }
}

const isPlainObject = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

/** A JavaScript value as SQLite stores it (see the table above). Throws on values with no column type. */
export const encodeParameter = (value: unknown, index: number): SQLInputValue => {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'bigint':
      return value;
    case 'boolean':
      return value ? 1 : 0;
    case 'object':
      if (value === null) {
        return null;
      }
      if (value instanceof Date) {
        return toStoredTimestamp(value);
      }
      if (value instanceof Uint8Array) {
        return value;
      }
      if (Array.isArray(value) || isPlainObject(value)) {
        return JSON.stringify(value);
      }
      throw new SqliteBindError(index, value);
    default:
      throw new SqliteBindError(index, value);
  }
};

export type Decoder = (value: unknown) => unknown;

const toNumber = (value: unknown): unknown => (typeof value === 'bigint' ? Number(value) : value);
const toDecimalString = (value: unknown): unknown =>
  typeof value === 'bigint' || typeof value === 'number' ? String(value) : value;
const toDate = (value: unknown): unknown => (typeof value === 'string' ? new Date(value) : value);
const toBoolean = (value: unknown): unknown => (value === null ? null : Number(value) !== 0);
const parseJson = (value: unknown): unknown =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
const passText = (value: unknown): unknown => (typeof value === 'bigint' ? String(value) : value);

/** Integers arrive as bigint (`setReadBigInts`); an untyped one is a number when it fits, else a string. */
const untyped: Decoder = (value) => {
  if (typeof value !== 'bigint') {
    return value;
  }
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : String(value);
};

const BY_DECLARED_TYPE: Readonly<Record<string, Decoder>> = {
  [DECLARED_TYPES.timestamptz]: toDate,
  [DECLARED_TYPES.date]: passText,
  [DECLARED_TYPES.jsonb]: parseJson,
  [DECLARED_TYPES.json]: parseJson,
  [DECLARED_TYPES.textArray]: parseJson,
  [DECLARED_TYPES.uuidArray]: parseJson,
  [DECLARED_TYPES.uuid]: passText,
  [DECLARED_TYPES.boolean]: toBoolean,
  [DECLARED_TYPES.bigint]: toDecimalString,
  [DECLARED_TYPES.integer]: toNumber,
  [DECLARED_TYPES.real]: toNumber,
  [DECLARED_TYPES.double]: toNumber,
  [DECLARED_TYPES.text]: passText,
};

const BY_MARKER: Readonly<Record<ResultType, Decoder>> = {
  json: parseJson,
  timestamp: toDate,
  boolean: toBoolean,
  bigint: toDecimalString,
  text: passText,
};

export type ColumnMetadata = {
  name: string;
  table: string | null;
  column: string | null;
  type: string | null;
};

/** The decoder of one result column: a marker wins, then the origin column, then the declared type. */
export const decoderFor = (metadata: ColumnMetadata, marker: ResultType | undefined): Decoder => {
  if (marker) {
    return BY_MARKER[marker];
  }
  if (metadata.table !== null && BIGINT_ROWID_COLUMNS.has(`${metadata.table}.${metadata.column ?? ''}`)) {
    return toDecimalString;
  }
  const declared = metadata.type?.toLowerCase();
  return (declared === undefined ? undefined : BY_DECLARED_TYPE[declared]) ?? untyped;
};

const STORED_TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

/**
 * Strict mode (tests): an unmarked computed column whose text looks like a stored timestamp or a JSON
 * document was almost certainly meant to be decoded; fail loudly so the query gets a `db/sql/typed` marker.
 */
export const assertNotUndecoded = (name: string, value: unknown): void => {
  if (typeof value !== 'string') {
    return;
  }
  if (STORED_TIMESTAMP.test(value)) {
    throw new Error(
      `SQLite result column "${name}" is a computed timestamp without a type marker; wrap it in asTimestamp() (db/sql/typed.ts)`,
    );
  }
  const first = value[0];
  if (first === '{' || first === '[') {
    try {
      JSON.parse(value);
    } catch {
      return;
    }
    throw new Error(
      `SQLite result column "${name}" is computed JSON without a type marker; wrap it in asJson() (db/sql/typed.ts)`,
    );
  }
};
