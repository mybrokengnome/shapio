import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue, SQLOutputValue } from 'node:sqlite';

/**
 * Functions Shapio registers on every SQLite connection, so SQL, column defaults, CHECK constraints and
 * index expressions written for PostgreSQL have an equivalent. Deterministic ones may appear in indexes and
 * constraints; a database file is therefore only fully usable through Shapio (another SQLite client lacks
 * them).
 */
export type ConnectionHooks = {
  /** The transaction's start time (or this statement's, outside a transaction), as stored text. */
  now: () => string;
  /** Next value of a named counter in `sequences`. */
  nextval: (name: string) => bigint;
  /** Queues a notification (delivered on commit, or at once outside a transaction). */
  notify: (channel: string, payload: string) => void;
  /** Throws unless this connection is the writer inside a transaction. */
  assertWriteTransaction: () => void;
};

/** Unicode-aware case folding (SQLite's own `lower`/`upper`/`LIKE` only fold ASCII). */
const fold = (value: SQLOutputValue): SQLInputValue =>
  typeof value === 'string' ? value.toLowerCase() : value;
const upper = (value: SQLOutputValue): SQLInputValue =>
  typeof value === 'string' ? value.toUpperCase() : value;

const PATTERNS = new Map<string, RegExp>();
const compiled = (pattern: string): RegExp => {
  let regexp = PATTERNS.get(pattern);
  if (!regexp) {
    regexp = new RegExp(pattern, 'u');
    PATTERNS.set(pattern, regexp);
  }
  return regexp;
};

/** `value REGEXP pattern` (PostgreSQL `~`), which SQLite rewrites to `regexp(pattern, value)`. */
const regexp = (pattern: SQLOutputValue, value: SQLOutputValue): SQLInputValue => {
  if (pattern === null || value === null) {
    return null;
  }
  return compiled(String(pattern)).test(String(value)) ? 1 : 0;
};

/** PostgreSQL's `split_part(text, delimiter, n)` for n ≥ 1: empty text past the last part. */
const splitPart = (
  value: SQLOutputValue,
  delimiter: SQLOutputValue,
  position: SQLOutputValue,
): SQLInputValue => {
  if (value === null || delimiter === null || position === null) {
    return null;
  }
  const index = Number(position);
  if (!Number.isInteger(index) || index < 1) {
    throw new Error('split_part: field position must be a positive integer');
  }
  return String(value).split(String(delimiter))[index - 1] ?? '';
};

const DETERMINISTIC = { deterministic: true } as const;

export const registerFunctions = (database: DatabaseSync, hooks: ConnectionHooks): void => {
  database.function('shapio_fold', DETERMINISTIC, fold);
  database.function('lower', DETERMINISTIC, fold);
  database.function('upper', DETERMINISTIC, upper);
  database.function('regexp', DETERMINISTIC, regexp);
  database.function('split_part', DETERMINISTIC, splitPart);
  database.function('gen_random_uuid', () => randomUUID());
  database.function('shapio_now', () => hooks.now());
  database.function('shapio_nextval', (name: SQLOutputValue) => hooks.nextval(String(name)));
  database.function('shapio_assert_write_transaction', () => {
    hooks.assertWriteTransaction();
    return 1;
  });
  database.function('shapio_notify', (channel: SQLOutputValue, payload: SQLOutputValue) => {
    hooks.notify(String(channel), payload === null ? '' : String(payload));
    return null;
  });
};
