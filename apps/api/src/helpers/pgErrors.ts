/** PostgreSQL SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** Whether `error` is a unique-constraint violation (optionally on one named constraint). */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && (constraint === undefined || violated === constraint);
};

/** PostgreSQL SQLSTATE for foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/** Whether `error` is a foreign-key violation (optionally on one named constraint). */
export const isForeignKeyViolation = (error: unknown, constraint?: string): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return code === FOREIGN_KEY_VIOLATION && (constraint === undefined || violated === constraint);
};
