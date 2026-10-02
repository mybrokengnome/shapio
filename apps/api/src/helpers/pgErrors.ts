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
