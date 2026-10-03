import { sql, type Expression, type RawBuilder } from 'kysely';

/**
 * Text primitives (dialect boundary, ADR 0001). Pattern matching takes the caller's plain text and does the
 * escaping here, because LIKE escapes differ per dialect (PostgreSQL escapes with a backslash by default;
 * SQLite has no default escape character and needs `ESCAPE '\'`).
 */

/** Escapes LIKE wildcards (`%`, `_`) and the escape character itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * `value` contains `text`, ignoring case.
 * PostgreSQL: `value ilike '%text%'` (escaped, bound). Contract: Unicode-aware case folding where the
 * dialect can (SQLite's `LIKE` folds ASCII only; a second dialect documents that limit).
 */
export const containsInsensitive = (value: Expression<string | null>, text: string): RawBuilder<boolean> =>
  sql<boolean>`${value} ilike ${`%${escapeLike(text)}%`}`;

/**
 * `value` starts with `prefix` (case-sensitive).
 * PostgreSQL: `value like 'prefix%'` (escaped, bound). Contract: case-sensitive (SQLite's `LIKE` is not,
 * so a second dialect uses `substr`/`glob` or `PRAGMA case_sensitive_like`).
 */
export const startsWith = (value: Expression<string | null>, prefix: string): RawBuilder<boolean> =>
  sql<boolean>`${value} like ${`${escapeLike(prefix)}%`}`;

/**
 * Text concatenation. Strings are bound as parameters; null in any part gives null.
 * PostgreSQL: `a || b`. Contract: the same null propagation (MySQL's `concat()` has it; `||` there is OR).
 */
export const concat = (...parts: ReadonlyArray<string | Expression<string | null>>): RawBuilder<string> =>
  sql<string>`${sql.join(
    parts.map((part) => (typeof part === 'string' ? sql`${part}` : part)),
    sql` || `,
  )}`;

/**
 * The `position`th (1-based) dot-separated segment of a path; empty text when there are fewer segments.
 * PostgreSQL: `split_part(value, '.', n)`. Contract: the same empty-text result past the last segment.
 */
export const pathSegment = (value: Expression<string>, position: number): RawBuilder<string> =>
  sql<string>`split_part(${value}, '.', ${sql.lit(position)})`;
