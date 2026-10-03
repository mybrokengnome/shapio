import { sql, type Expression, type RawBuilder } from 'kysely';
import { isSqlite } from '../dialect.js';

/**
 * Text primitives (dialect boundary, ADR 0001). Pattern matching takes the caller's plain text and does the
 * escaping here, because LIKE escapes differ per dialect (PostgreSQL escapes with a backslash by default).
 * SQLite avoids LIKE entirely: it compares with `instr`/`substr`, which need no escaping, and folds case with
 * `shapio_fold` (JavaScript's Unicode `toLowerCase`, registered on every connection).
 */

/** Escapes LIKE wildcards (`%`, `_`) and the escape character itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/**
 * `value` contains `text`, ignoring case.
 * PostgreSQL: `value ilike '%text%'` (escaped, bound). SQLite: `instr(shapio_fold(value), $1) > 0` with the
 * folded text bound. Contract: Unicode-aware case folding; false for null.
 */
export const containsInsensitive = (value: Expression<string | null>, text: string): RawBuilder<boolean> =>
  isSqlite()
    ? sql<boolean>`instr(shapio_fold(${value}), ${text.toLowerCase()}) > 0`
    : sql<boolean>`${value} ilike ${`%${escapeLike(text)}%`}`;

/**
 * `value` starts with `prefix` (case-sensitive).
 * PostgreSQL: `value like 'prefix%'` (escaped, bound). SQLite: `substr(value, 1, n) = prefix` (n in
 * characters; SQLite's `LIKE` ignores case). Contract: case-sensitive; false for null.
 */
export const startsWith = (value: Expression<string | null>, prefix: string): RawBuilder<boolean> =>
  isSqlite()
    ? sql<boolean>`substr(${value}, 1, ${sql.lit([...prefix].length)}) = ${prefix}`
    : sql<boolean>`${value} like ${`${escapeLike(prefix)}%`}`;

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
 * PostgreSQL: `split_part(value, '.', n)`. SQLite: the same call, to a function Shapio registers on every
 * connection. Contract: the same empty-text result past the last segment.
 */
export const pathSegment = (value: Expression<string>, position: number): RawBuilder<string> =>
  sql<string>`split_part(${value}, '.', ${sql.lit(position)})`;
