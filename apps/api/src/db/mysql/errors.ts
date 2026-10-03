/**
 * MySQL error details (ADR 0001, "MySQL"). mysql2 errors carry `code` (`ER_DUP_ENTRY`, …) and a message
 * that names the failed key; the connection adds `constraint` and `table` to the error, so
 * `db/sql/errors.ts` can match constraint names as it does on PostgreSQL.
 */
export const DUPLICATE_KEY = 'ER_DUP_ENTRY';
export const FOREIGN_KEY_CODES: ReadonlySet<string> = new Set([
  'ER_ROW_IS_REFERENCED_2',
  'ER_NO_REFERENCED_ROW_2',
]);

type MysqlErrorFields = { code?: unknown; sqlMessage?: unknown; constraint?: unknown; table?: unknown };

const fieldsOf = (error: unknown): MysqlErrorFields | undefined =>
  typeof error === 'object' && error !== null ? error : undefined;

/** `Duplicate entry '…' for key 'table.index'` → { table, index } (`PRIMARY` → `<table>_pkey`). */
const duplicateKeyOf = (message: string): { table: string | undefined; constraint: string } | undefined => {
  const match = /for key '(?:([^.']+)\.)?([^']+)'$/.exec(message);
  if (!match) {
    return undefined;
  }
  const [, table, key] = match;
  return { table, constraint: key === 'PRIMARY' && table ? `${table}_pkey` : (key as string) };
};

/** `… (\`db\`.\`table\`, CONSTRAINT \`name\` FOREIGN KEY …` → { table, constraint }. */
const foreignKeyOf = (message: string): { table: string | undefined; constraint: string } | undefined => {
  const match = /\(`[^`]+`\.`([^`]+)`, CONSTRAINT `([^`]+)`/.exec(message);
  return match ? { table: match[1], constraint: match[2] as string } : undefined;
};

/** Adds `constraint` and `table` to a MySQL constraint error (mutates and returns it). */
export const annotateMysqlError = <T>(error: T): T => {
  const fields = fieldsOf(error);
  if (!fields || typeof fields.sqlMessage !== 'string') {
    return error;
  }
  const found =
    fields.code === DUPLICATE_KEY
      ? duplicateKeyOf(fields.sqlMessage)
      : FOREIGN_KEY_CODES.has(fields.code as string)
        ? foreignKeyOf(fields.sqlMessage)
        : undefined;
  if (found) {
    fields.constraint = found.constraint;
    fields.table = found.table;
  }
  return error;
};

/** Whether `error` is a duplicate key on one of `indexes` (any unique key when `indexes` is undefined). */
export const isDuplicateKeyOn = (error: unknown, indexes: ReadonlySet<string> | undefined): boolean => {
  const fields = fieldsOf(error);
  if (fields?.code !== DUPLICATE_KEY) {
    return false;
  }
  return indexes === undefined || indexes.has(fields.constraint as string);
};

/**
 * What the operator must change when MySQL refuses a migration statement for a server setting: with binary
 * logging on, creating the baseline's triggers needs SUPER (or SET_USER_ID) or
 * `log_bin_trust_function_creators = 1`. Undefined for any other error.
 */
export const mysqlMigrationHint = (error: unknown): string | undefined =>
  fieldsOf(error)?.code === 'ER_BINLOG_CREATE_ROUTINE_NEED_SUPER'
    ? 'MySQL refused to create a trigger because binary logging is on. Set log_bin_trust_function_creators = 1 ' +
      '(a parameter group setting on managed MySQL) or migrate as a user with SUPER, then retry; ' +
      'see documentation/mysql.md.'
    : undefined;
