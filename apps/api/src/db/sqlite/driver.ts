import { resolve } from 'node:path';
import {
  InsertQueryNode,
  RawNode,
  SelectQueryNode,
  UpdateQueryNode,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';
import type { SqliteLocation } from '../dialect.js';
import { SqliteConnection, type StatementContext } from './connection.js';
import { markersOf } from './plugin.js';
import { currentTransactionScope, WriteLock } from './writeLock.js';

export type SqliteDriverOptions = {
  location: SqliteLocation;
  /** Read connections (read-only transactions run on their own; autocommit reads share one). */
  readers: number;
  busyTimeoutMs: number;
  strict: boolean;
};

/** Statement text that may write (or call a function that writes). Anything unsure counts as a write. */
const WRITE_WORDS =
  /\b(insert|update|delete|replace|create|drop|alter|vacuum|pragma|shapio_nextval|begin|commit|rollback|savepoint|release)\b/i;

const isRead = (query: CompiledQuery): boolean => {
  if (SelectQueryNode.is(query.query)) {
    return !query.sql.includes('shapio_nextval(');
  }
  if (RawNode.is(query.query)) {
    return /^\s*(select|with)\b/i.test(query.sql) && !WRITE_WORDS.test(query.sql);
  }
  return false;
};

const tableNameOf = (node: unknown): string | undefined => {
  const table = (node as { table?: { identifier?: { name?: string } } } | undefined)?.table;
  return table?.identifier?.name;
};

const writtenTableOf = (query: CompiledQuery): string | undefined => {
  const node = query.query;
  if (InsertQueryNode.is(node)) {
    return tableNameOf(node.into);
  }
  if (UpdateQueryNode.is(node) && node.table) {
    return tableNameOf(node.table) ?? tableNameOf((node.table as { node?: unknown }).node);
  }
  return undefined;
};

/**
 * The key a database's notification bus and session locks use: the absolute file path (every in-memory
 * database shares one key; notifications are only hints).
 */
export const notificationKeyOf = (location: SqliteLocation): string =>
  location.kind === 'memory' ? ':memory:' : resolve(location.path);

const contextOf = (query: CompiledQuery): StatementContext => ({
  markers: markersOf(query.queryId),
  writtenTable: writtenTableOf(query),
  handWritten: RawNode.is(query.query),
});

/**
 * A Kysely driver over Node's built-in `node:sqlite` (no native dependency). One writer connection runs
 * every write, serialised by an in-process lock (`writeLock.ts`, `BEGIN IMMEDIATE`); reader connections
 * serve read-only transactions and autocommit reads concurrently (WAL). An in-memory database has the
 * writer only, and every statement takes the lock.
 */
export class SqliteDriver implements Driver {
  readonly #options: SqliteDriverOptions;
  readonly #writeLock = new WriteLock();
  readonly databaseKey: string;
  #writer: SqliteConnection | undefined;
  #autocommitReader: SqliteConnection | undefined;
  #idleReaders: SqliteConnection[] = [];
  #openReaders = 0;
  #readerWaiters: Array<(reader: SqliteConnection) => void> = [];
  #allConnections: SqliteConnection[] = [];

  constructor(options: SqliteDriverOptions) {
    this.#options = options;
    this.databaseKey = notificationKeyOf(options.location);
  }

  get #hasReaders(): boolean {
    return this.#options.location.kind === 'file';
  }

  #open(role: 'writer' | 'reader'): SqliteConnection {
    const connection = new SqliteConnection({
      location: this.#options.location.kind === 'memory' ? ':memory:' : this.databaseKey,
      databaseKey: this.databaseKey,
      role,
      busyTimeoutMs: this.#options.busyTimeoutMs,
      strict: this.#options.strict,
    });
    this.#allConnections.push(connection);
    return connection;
  }

  get writer(): SqliteConnection {
    this.#writer ??= this.#open('writer');
    return this.#writer;
  }

  async init(): Promise<void> {
    // Opening the writer first creates the file and switches it to WAL before any reader opens it.
    void this.writer;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new SqliteSession(this);
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await (connection as SqliteSession).begin(settings.accessMode === 'read only');
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    (connection as SqliteSession).commit();
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    (connection as SqliteSession).rollback();
  }

  async savepoint(connection: DatabaseConnection, savepointName: string): Promise<void> {
    (connection as SqliteSession).savepointCommand('savepoint', savepointName);
  }

  async rollbackToSavepoint(connection: DatabaseConnection, savepointName: string): Promise<void> {
    (connection as SqliteSession).savepointCommand('rollback to', savepointName);
  }

  async releaseSavepoint(connection: DatabaseConnection, savepointName: string): Promise<void> {
    (connection as SqliteSession).savepointCommand('release', savepointName);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    (connection as SqliteSession).release();
  }

  async destroy(): Promise<void> {
    for (const connection of this.#allConnections) {
      connection.close();
    }
    this.#allConnections = [];
    this.#writer = undefined;
    this.#autocommitReader = undefined;
    this.#idleReaders = [];
  }

  /** Takes the write lock for one statement or a whole transaction (see `writeLock.ts`). */
  lockWriter(statement: string, transaction: boolean): Promise<() => void> {
    return this.#writeLock.acquire(statement, transaction ? currentTransactionScope() : undefined);
  }

  /** The connection autocommit reads use: a reader, or the writer for an in-memory database. */
  readerForStatement(): SqliteConnection | undefined {
    if (!this.#hasReaders) {
      return undefined;
    }
    this.#autocommitReader ??= this.#open('reader');
    return this.#autocommitReader;
  }

  /** A reader for a read-only transaction; waits when `readers` are all in use. */
  async acquireReader(): Promise<SqliteConnection | undefined> {
    if (!this.#hasReaders) {
      return undefined;
    }
    const idle = this.#idleReaders.pop();
    if (idle) {
      return idle;
    }
    if (this.#openReaders < this.#options.readers) {
      this.#openReaders += 1;
      return this.#open('reader');
    }
    return new Promise((resolve) => this.#readerWaiters.push(resolve));
  }

  releaseReader(reader: SqliteConnection): void {
    const waiter = this.#readerWaiters.shift();
    if (waiter) {
      waiter(reader);
    } else {
      this.#idleReaders.push(reader);
    }
  }
}

/**
 * The connection Kysely holds for one query or transaction. It binds to a physical connection lazily:
 * a write transaction to the writer (holding the write lock until it ends), a read-only one to a reader, and
 * a single statement to whichever fits.
 */
class SqliteSession implements DatabaseConnection {
  readonly #driver: SqliteDriver;
  #transaction: SqliteConnection | undefined;
  #releaseWriteLock: (() => void) | undefined;

  constructor(driver: SqliteDriver) {
    this.#driver = driver;
  }

  async begin(readOnly: boolean): Promise<void> {
    const reader = readOnly ? await this.#driver.acquireReader() : undefined;
    if (reader) {
      try {
        reader.begin('deferred');
      } catch (error) {
        this.#driver.releaseReader(reader);
        throw error;
      }
      this.#transaction = reader;
      return;
    }
    const release = await this.#driver.lockWriter('begin', true);
    try {
      this.#driver.writer.begin('immediate');
    } catch (error) {
      release();
      throw error;
    }
    this.#releaseWriteLock = release;
    this.#transaction = this.#driver.writer;
  }

  #finish(end: (connection: SqliteConnection) => void): void {
    const connection = this.#transaction;
    if (!connection) {
      return;
    }
    this.#transaction = undefined;
    try {
      end(connection);
    } finally {
      if (connection.role === 'reader') {
        this.#driver.releaseReader(connection);
      } else {
        this.#releaseWriteLock?.();
        this.#releaseWriteLock = undefined;
      }
    }
  }

  commit(): void {
    this.#finish((connection) => connection.commit());
  }

  rollback(): void {
    this.#finish((connection) => connection.rollback());
  }

  /** Kysely releases the connection after a failed begin or commit too: never leave a lock behind. */
  release(): void {
    if (this.#transaction) {
      this.rollback();
    }
  }

  savepointCommand(command: 'savepoint' | 'rollback to' | 'release', name: string): void {
    if (!this.#transaction) {
      throw new Error('Savepoints need an open transaction');
    }
    this.#transaction.exec(`${command} "${name.replace(/"/g, '""')}"`);
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const context = contextOf(query);
    if (this.#transaction) {
      return this.#transaction.execute<R>(query, context);
    }
    const reader = isRead(query) ? this.#driver.readerForStatement() : undefined;
    if (reader) {
      return reader.execute<R>(query, context);
    }
    const release = await this.#driver.lockWriter(query.sql, false);
    try {
      return this.#driver.writer.execute<R>(query, context);
    } finally {
      release();
    }
  }

  async *streamQuery<R>(query: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    const result = await this.executeQuery<R>(query);
    for (const row of result.rows) {
      yield { rows: [row] };
    }
  }
}
