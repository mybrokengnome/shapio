/**
 * Database error classification (dialect boundary, ADR 0001): services ask what kind of constraint failed,
 * never for a driver's error code. PostgreSQL reports the SQLSTATE and the constraint name. A second dialect
 * that reports only the table and columns (SQLite: `UNIQUE constraint failed: t.a, t.b`) maps them to the
 * constraint names used here.
 */

/** PostgreSQL SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** PostgreSQL SQLSTATE for foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

const isViolation = (error: unknown, code: string, constraint: string | undefined): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code: actual, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return actual === code && (constraint === undefined || violated === constraint);
};

/** Whether `error` is a unique-constraint violation (optionally on one named constraint). */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean =>
  isViolation(error, UNIQUE_VIOLATION, constraint);

/** Whether `error` is a foreign-key violation (optionally on one named constraint). */
export const isForeignKeyViolation = (error: unknown, constraint?: string): boolean =>
  isViolation(error, FOREIGN_KEY_VIOLATION, constraint);
