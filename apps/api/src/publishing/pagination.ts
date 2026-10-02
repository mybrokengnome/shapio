import { sql, type RawBuilder } from 'kysely';
import { AppError } from '../helpers/appError.js';

/**
 * Keyset pagination for the publishing lists (newest first by `(created_at, id)`), so deep pages cost the
 * same as the first. The cursor carries the timestamp with microseconds: a JavaScript Date (milliseconds)
 * would skip or repeat rows created within one millisecond.
 */
export type KeysetCursor = { at: string; id: string };

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** The microsecond-precise cursor value of a timestamp column. */
export const cursorAt = (column: string): RawBuilder<string> =>
  sql<string>`to_char(${sql.ref(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Rows strictly after the cursor in `(at desc, id desc)` order. */
export const beforeCursor = (atColumn: string, idColumn: string, cursor: KeysetCursor) =>
  sql<boolean>`(${sql.ref(atColumn)}, ${sql.ref(idColumn)}) < (cast(${cursor.at} as timestamptz), cast(${cursor.id} as uuid))`;

export const encodeCursor = (cursor: KeysetCursor): string =>
  Buffer.from(JSON.stringify([cursor.at, cursor.id]), 'utf8').toString('base64url');

export const decodeCursor = (value: string | undefined): KeysetCursor | undefined => {
  if (value === undefined || value === '') {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      !Number.isNaN(Date.parse(parsed[0])) &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // Fall through: a malformed cursor is the caller's mistake.
  }
  throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
};

export const pageSize = (limit: number | undefined) =>
  Math.min(MAX_PAGE_SIZE, Math.max(1, limit ?? DEFAULT_PAGE_SIZE));

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Builds a page from `limit + 1` rows that each carry `id` and `cursor_at`. */
export const toPage = <Row extends { id: string; cursor_at: string }, Item>(
  rows: readonly Row[],
  limit: number,
  map: (row: Row) => Item,
): Page<Item> => {
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursor_at, id: last.id }) : null,
  };
};
