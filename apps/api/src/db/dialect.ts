/**
 * The database dialect this process talks to (ADR 0001, "Dialect boundary"). Chosen from DATABASE_URL:
 * `postgres://…`/`postgresql://…`, `mysql://…` or `sqlite:<path>` (`sqlite::memory:` for a throwaway
 * in-memory database).
 * The `db/sql` primitives and the content compiler read `currentDialect()` while building SQL, so it is set
 * once, when the process creates its database handle (`createDb`), before any query is built.
 */
export type DialectName = 'postgres' | 'sqlite' | 'mysql';

const SQLITE_PREFIX = 'sqlite:';
const MEMORY = ':memory:';

/** The dialect a DATABASE_URL names, or undefined when it names none of them. */
export const dialectOfUrl = (url: string): DialectName | undefined => {
  if (url.startsWith(SQLITE_PREFIX)) {
    return 'sqlite';
  }
  if (url.startsWith('mysql://')) {
    return 'mysql';
  }
  return /^postgres(ql)?:\/\//.test(url) ? 'postgres' : undefined;
};

export type SqliteLocation = { kind: 'memory' } | { kind: 'file'; path: string };

/**
 * Where a `sqlite:` URL points: `sqlite::memory:` or `sqlite:<path>` (relative to the working directory or
 * absolute; `sqlite:///abs/path` is accepted too). Throws when the path is empty.
 */
export const sqliteLocationOfUrl = (url: string): SqliteLocation => {
  const rest = url.slice(SQLITE_PREFIX.length);
  if (rest === MEMORY) {
    return { kind: 'memory' };
  }
  const path = rest.startsWith('//') ? rest.slice(2) : rest;
  if (path === '') {
    throw new Error('A sqlite: DATABASE_URL needs a file path, e.g. sqlite:./shapio.db');
  }
  return { kind: 'file', path };
};

/** `host:port/database` (PostgreSQL, MySQL) or the file path (SQLite) from DATABASE_URL, never the credentials. */
export const describeDatabaseTarget = (connectionString: string): string => {
  if (dialectOfUrl(connectionString) === 'sqlite') {
    const location = sqliteLocationOfUrl(connectionString);
    return location.kind === 'memory' ? 'an in-memory database' : location.path;
  }
  try {
    const url = new URL(connectionString);
    const defaultPort = dialectOfUrl(connectionString) === 'mysql' ? '3306' : '5432';
    return `${url.hostname}:${url.port || defaultPort}${url.pathname}`;
  } catch {
    return 'the configured database';
  }
};

let current: DialectName | undefined;

/** The dialect queries are built for. PostgreSQL until a database handle says otherwise. */
export const currentDialect = (): DialectName => current ?? 'postgres';

/**
 * Sets the process dialect. `createDb` calls it; one process talks to one dialect, so switching after a
 * handle exists is a bug (`force` is for unit tests that compile SQL for both dialects without a database).
 */
export const setCurrentDialect = (
  dialect: DialectName,
  { force = false }: { force?: boolean } = {},
): void => {
  if (!force && current !== undefined && current !== dialect) {
    throw new Error(`This process already uses ${current}; it cannot also open a ${dialect} database`);
  }
  current = dialect;
};

/** Runs `fn` with the dialect switched (unit tests of SQL builders only), then restores the previous one. */
export const withDialect = <T>(dialect: DialectName, fn: () => T): T => {
  const previous = current;
  current = dialect;
  try {
    return fn();
  } finally {
    current = previous;
  }
};

export const isSqlite = (): boolean => currentDialect() === 'sqlite';

export const isMysql = (): boolean => currentDialect() === 'mysql';
