import type { DatabaseSync } from 'node:sqlite';

/**
 * SQLite errors in the shape `db/sql/errors.ts` classifies: `code` is the extended result code's name and,
 * like PostgreSQL's error fields, `constraint` names the violated unique index and `table` the table a
 * failed foreign-key write targeted (SQLite reports no constraint name for foreign keys).
 */
export class SqliteDatabaseError extends Error {
  readonly code: string;
  readonly errcode: number;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  /** The failed statement's SQL (values are bound separately and never included). */
  readonly sql: string | undefined;

  constructor(
    message: string,
    fields: { code: string; errcode: number; constraint?: string; table?: string; sql?: string },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SqliteDatabaseError';
    this.code = fields.code;
    this.errcode = fields.errcode;
    this.constraint = fields.constraint;
    this.table = fields.table;
    this.sql = fields.sql;
  }
}

/** Extended result codes Shapio distinguishes (sqlite.org/rescode.html). */
const CODE_NAMES: Readonly<Record<number, string>> = {
  5: 'SQLITE_BUSY',
  19: 'SQLITE_CONSTRAINT',
  275: 'SQLITE_CONSTRAINT_CHECK',
  787: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  1299: 'SQLITE_CONSTRAINT_NOTNULL',
  1555: 'SQLITE_CONSTRAINT_PRIMARYKEY',
  1811: 'SQLITE_CONSTRAINT_TRIGGER',
  2067: 'SQLITE_CONSTRAINT_UNIQUE',
};

const NAMED_INDEX = /UNIQUE constraint failed: index '([^']+)'/;
const COLUMN_LIST = /(?:UNIQUE) constraint failed: (.+)$/;

type IndexRow = { name: string; origin: string };
type IndexColumnRow = { name: string | null };

/** The unique index on exactly `columns` of `table` (PostgreSQL names the primary key `<table>_pkey`). */
const uniqueIndexOn = (
  database: DatabaseSync,
  table: string,
  columns: readonly string[],
): string | undefined => {
  const indexes = database
    .prepare(`select name, origin from pragma_index_list(?) where "unique" = 1`)
    .all(table) as unknown as IndexRow[];
  for (const index of indexes) {
    const indexColumns = (
      database
        .prepare('select name from pragma_index_info(?) order by seqno')
        .all(index.name) as unknown as IndexColumnRow[]
    ).map((row) => row.name);
    if (indexColumns.length === columns.length && indexColumns.every((name, at) => name === columns[at])) {
      return index.origin === 'pk' ? `${table}_pkey` : index.name;
    }
  }
  return undefined;
};

/** `t.a, t.b` → table `t`, columns `[a, b]`. */
const parseColumnList = (list: string): { table: string; columns: string[] } | undefined => {
  const parts = list.split(',').map((part) => part.trim().split('.'));
  const table = parts[0]?.[0];
  if (!table || parts.some((part) => part.length !== 2 || part[0] !== table)) {
    return undefined;
  }
  return { table, columns: parts.map((part) => part[1] ?? '') };
};

const uniqueConstraintOf = (database: DatabaseSync, message: string): string | undefined => {
  const named = NAMED_INDEX.exec(message);
  if (named) {
    return named[1];
  }
  const list = COLUMN_LIST.exec(message)?.[1];
  const parsed = list === undefined ? undefined : parseColumnList(list);
  return parsed && uniqueIndexOn(database, parsed.table, parsed.columns);
};

/**
 * Wraps a `node:sqlite` error with the constraint details services ask about. `writtenTable` is the table an
 * INSERT or UPDATE targeted (attached to foreign-key failures). Other errors pass through unchanged.
 */
export const translateSqliteError = (
  error: unknown,
  database: DatabaseSync,
  writtenTable: string | undefined,
  statement?: string,
): unknown => {
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  if (!(error instanceof Error) || typeof errcode !== 'number') {
    return error;
  }
  const code = CODE_NAMES[errcode] ?? `SQLITE_${errcode}`;
  const fields: { code: string; errcode: number; constraint?: string; table?: string; sql?: string } = {
    code,
    errcode,
    ...(statement === undefined ? {} : { sql: statement }),
  };
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    const constraint = uniqueConstraintOf(database, error.message);
    if (constraint) {
      fields.constraint = constraint;
    }
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' && writtenTable) {
    fields.table = writtenTable;
  }
  return new SqliteDatabaseError(error.message, fields, { cause: error });
};
