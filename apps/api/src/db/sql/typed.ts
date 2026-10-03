import { sql, type Expression, type OperationNode, type RawBuilder } from 'kysely';
import { isSqlite } from '../dialect.js';

/**
 * Result types for computed columns (dialect boundary, ADR 0001). PostgreSQL tells its driver the type of
 * every result column, so an aggregate or a `coalesce` over a timestamp comes back as a Date and a JSON
 * aggregate as an object. SQLite only knows the declared type of plain table columns; an expression's value
 * arrives as raw text or a number. Wrapping a selected expression in one of these markers tells the SQLite
 * driver how to decode it. PostgreSQL ignores them (the SQL is unchanged).
 *
 * Mark the outermost selected expression (`asJson(eb.fn.coalesce(…)).as('x')`), not an inner one. In tests
 * the SQLite driver fails on an unmarked computed column whose value looks like a stored timestamp or a JSON
 * document, so a missing marker is caught instead of returning the wrong type.
 */
export type ResultType = 'json' | 'timestamp' | 'boolean' | 'bigint' | 'text';

const MARKED = new WeakMap<OperationNode, ResultType>();

/** The marker on a selection's expression node, if any (read by the SQLite plugin). */
export const markedResultType = (node: OperationNode): ResultType | undefined => MARKED.get(node);

const mark = <T>(expression: Expression<unknown>, type: ResultType): RawBuilder<T> => {
  const builder = sql<T>`${expression}`;
  if (isSqlite()) {
    MARKED.set(builder.toOperationNode(), type);
  }
  return builder;
};

/** A JSON document (an object or array once read; PostgreSQL json/jsonb). */
export const asJson = <T>(expression: Expression<unknown>): RawBuilder<T> => mark<T>(expression, 'json');

/** A timestamp (a Date once read). */
export const asTimestamp = <T extends Date | null = Date>(expression: Expression<unknown>): RawBuilder<T> =>
  mark<T>(expression, 'timestamp');

/** A boolean (`true`/`false` once read; SQLite computes 1/0). */
export const asBoolean = <T extends boolean | null = boolean>(
  expression: Expression<unknown>,
): RawBuilder<T> => mark<T>(expression, 'boolean');

/** A 64-bit integer (a decimal string once read, like PostgreSQL's bigint, count and sum). */
export const asBigint = <T extends string | null = string>(expression: Expression<unknown>): RawBuilder<T> =>
  mark<T>(expression, 'bigint');

/** Text that must stay text even when it looks like a timestamp or JSON (e.g. a cursor). */
export const asText = <T extends string | null = string>(expression: Expression<unknown>): RawBuilder<T> =>
  mark<T>(expression, 'text');
