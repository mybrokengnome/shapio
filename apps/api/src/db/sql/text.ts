import { sql, type Expression, type RawBuilder } from 'kysely';
import { isMysql, isSqlite } from '../dialect.js';

/**
 * Text primitives (dialect boundary, ADR 0001). Pattern matching takes the caller's plain text and does the
 * escaping here, because LIKE escapes differ per dialect (PostgreSQL escapes with a backslash by default).
 * SQLite avoids LIKE entirely: it compares with `instr`/`substr`, which need no escaping, and folds case with
 * `shapio_fold` (JavaScript's Unicode `toLowerCase`, registered on every connection). MySQL compares text in
 * the binary `utf8mb4_0900_bin` collation (case-sensitive) and folds with its Unicode-aware `lower()`.
 */

/** Escapes LIKE wildcards (`%`, `_`) and the escape character itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** MySQL: `!` as the LIKE escape character (a backslash would also be a string-literal escape there). */
const escapeMysqlLike = (text: string) => text.replace(/[!%_]/g, '!$&');

/**
 * `value` contains `text`, ignoring case.
 * PostgreSQL: `value ilike '%text%'` (escaped, bound). SQLite: `instr(shapio_fold(value), $1) > 0` with the
 * folded text bound. MySQL: `locate(lower($1), lower(value)) > 0`. Contract: Unicode-aware case folding;
 * false for null.
 */
export const containsInsensitive = (value: Expression<string | null>, text: string): RawBuilder<boolean> =>
  isMysql()
    ? sql<boolean>`locate(lower(${text}), lower(${value})) > 0`
    : isSqlite()
      ? sql<boolean>`instr(shapio_fold(${value}), ${text.toLowerCase()}) > 0`
      : sql<boolean>`${value} ilike ${`%${escapeLike(text)}%`}`;

/**
 * `value` starts with `prefix` (case-sensitive).
 * PostgreSQL: `value like 'prefix%'` (escaped, bound). SQLite: `substr(value, 1, n) = prefix` (n in
 * characters; SQLite's `LIKE` ignores case). MySQL: `value like 'prefix%' escape '!'` (case-sensitive in the
 * binary collation). Contract: case-sensitive; false for null.
 */
export const startsWith = (value: Expression<string | null>, prefix: string): RawBuilder<boolean> =>
  isMysql()
    ? sql<boolean>`${value} like ${`${escapeMysqlLike(prefix)}%`} escape '!'`
    : isSqlite()
      ? sql<boolean>`substr(${value}, 1, ${sql.lit([...prefix].length)}) = ${prefix}`
      : sql<boolean>`${value} like ${`${escapeLike(prefix)}%`}`;

/**
 * Text concatenation. Strings are bound as parameters; null in any part gives null.
 * PostgreSQL and SQLite: `a || b`. MySQL: `concat(a, b)` (`||` is OR there). Contract: the same null
 * propagation.
 */
export const concat = (...parts: ReadonlyArray<string | Expression<string | null>>): RawBuilder<string> => {
  const items = parts.map((part) => (typeof part === 'string' ? sql`${part}` : part));
  return isMysql() ? sql<string>`concat(${sql.join(items)})` : sql<string>`${sql.join(items, sql` || `)}`;
};

/**
 * The `position`th (1-based) dot-separated segment of a path; empty text when there are fewer segments.
 * PostgreSQL: `split_part(value, '.', n)`. SQLite: the same call, to a function Shapio registers on every
 * connection. MySQL: nested `substring_index`, guarded by the segment count. Contract: the same empty-text
 * result past the last segment.
 */
export const pathSegment = (value: Expression<string>, position: number): RawBuilder<string> => {
  if (isMysql()) {
    const segments = sql`(char_length(${value}) - char_length(replace(${value}, '.', '')) + 1)`;
    return sql<string>`(case when ${segments} >= ${sql.lit(position)}
      then substring_index(substring_index(${value}, '.', ${sql.lit(position)}), '.', -1) else '' end)`;
  }
  return sql<string>`split_part(${value}, '.', ${sql.lit(position)})`;
};
