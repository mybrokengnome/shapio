import { sql, type Expression, type RawBuilder } from 'kysely';

/**
 * Row-value comparison for keyset pagination: `(a, b, …) < (x, y, …)`, lexicographic over the columns.
 * PostgreSQL: a row constructor comparison. Contract: the same lexicographic order (SQLite ≥ 3.15 and
 * MySQL support row values); `values` are typed with the `time`/`values` primitives where a cast is needed.
 */
export const rowLessThan = (
  columns: readonly string[],
  values: readonly Expression<unknown>[],
): RawBuilder<boolean> =>
  sql<boolean>`(${sql.join(columns.map((column) => sql.ref(column)))}) < (${sql.join(values)})`;
