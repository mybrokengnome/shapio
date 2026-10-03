/**
 * Database error classification (dialect boundary, ADR 0001): services ask what kind of constraint failed,
 * never for a driver's error code.
 *
 * PostgreSQL reports the SQLSTATE and the constraint name. The SQLite driver (`db/sqlite/errors.ts`) reports
 * `SQLITE_CONSTRAINT_*` codes; for a unique violation it resolves the index name (unique constraints are
 * named indexes with the PostgreSQL constraint's name), but a foreign-key violation names nothing, so the
 * driver reports the table the statement wrote and a named foreign key matches any foreign-key failure on
 * its table (`FOREIGN_KEY_TABLES`). The MySQL driver (`db/mysql/errors.ts`) reports mysql2's codes and adds
 * the index or constraint name it reads from the error message.
 */

/** PostgreSQL SQLSTATE for unique_violation. */
const UNIQUE_VIOLATION = '23505';
/** PostgreSQL SQLSTATE for foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

/** SQLite extended result codes, as the SQLite driver reports them. */
const SQLITE_UNIQUE = new Set(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY']);
const SQLITE_FOREIGN_KEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

/** MySQL error codes, as mysql2 reports them. */
const MYSQL_UNIQUE = 'ER_DUP_ENTRY';
const MYSQL_FOREIGN_KEY = new Set(['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2']);

/** The table of each foreign key a service matches by name (SQLite cannot name the failed key). */
const FOREIGN_KEY_TABLES: Readonly<Record<string, string>> = {
  change_set_items_entry_site_fk: 'change_set_items',
};

type DatabaseErrorFields = { code?: unknown; constraint?: unknown; table?: unknown };

const fieldsOf = (error: unknown): DatabaseErrorFields | undefined =>
  typeof error === 'object' && error !== null ? error : undefined;

/** Whether `error` is a unique-constraint violation (optionally on one named constraint or unique index). */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean => {
  const fields = fieldsOf(error);
  if (
    !fields ||
    (fields.code !== UNIQUE_VIOLATION &&
      fields.code !== MYSQL_UNIQUE &&
      !SQLITE_UNIQUE.has(fields.code as string))
  ) {
    return false;
  }
  return constraint === undefined || fields.constraint === constraint;
};

/** Whether `error` is a foreign-key violation (optionally on one named constraint). */
export const isForeignKeyViolation = (error: unknown, constraint?: string): boolean => {
  const fields = fieldsOf(error);
  if (!fields) {
    return false;
  }
  if (fields.code === FOREIGN_KEY_VIOLATION || MYSQL_FOREIGN_KEY.has(fields.code as string)) {
    return constraint === undefined || fields.constraint === constraint;
  }
  if (fields.code === SQLITE_FOREIGN_KEY) {
    return (
      constraint === undefined ||
      (fields.table !== undefined && FOREIGN_KEY_TABLES[constraint] === fields.table)
    );
  }
  return false;
};
