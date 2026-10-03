/**
 * PostgreSQL's three `UNIQUE NULLS NOT DISTINCT` constraints. SQLite treats NULLs as distinct in unique
 * indexes, so the baseline migration creates each as a unique index over `coalesce(column, '')` for its
 * nullable columns (same name), and the SQLite plugin rewrites `onConflict` column targets on these
 * columns to the index's expressions, which SQLite requires the target to match.
 */
export type NullsNotDistinctIndex = {
  name: string;
  table: string;
  columns: readonly string[];
  nullable: readonly string[];
};

export const NULLS_NOT_DISTINCT_INDEXES: readonly NullsNotDistinctIndex[] = [
  {
    name: 'admin_role_permissions_grant_uq',
    table: 'admin_role_permissions',
    columns: ['role_id', 'action', 'model_id'],
    nullable: ['model_id'],
  },
  {
    name: 'app_role_permissions_grant_uq',
    table: 'app_role_permissions',
    columns: ['role_id', 'action', 'model_id'],
    nullable: ['model_id'],
  },
  {
    name: 'admin_user_roles_assignment_uq',
    table: 'admin_user_roles',
    columns: ['admin_user_id', 'role_id', 'site_id'],
    nullable: ['site_id'],
  },
];

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

/** The index's column list as SQL: `"a", "b", coalesce("c", '')`. */
export const indexExpressionSql = (index: NullsNotDistinctIndex): string =>
  index.columns
    .map((column) => (index.nullable.includes(column) ? `coalesce(${quote(column)}, '')` : quote(column)))
    .join(', ');

/** The index whose columns are exactly `columns` (in any order) on `table`. */
export const nullsNotDistinctIndexFor = (
  table: string,
  columns: readonly string[],
): NullsNotDistinctIndex | undefined =>
  NULLS_NOT_DISTINCT_INDEXES.find(
    (index) =>
      index.table === table &&
      index.columns.length === columns.length &&
      index.columns.every((column) => columns.includes(column)),
  );
