import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { CompiledQuery, QueryResult } from 'kysely';
import { publishNotification } from '../notifyHub.js';
import { toStoredTimestamp } from '../sql/time.js';
import type { ResultType } from '../sql/typed.js';
import {
  assertNotUndecoded,
  decoderFor,
  encodeParameter,
  type ColumnMetadata,
  type Decoder,
} from './codec.js';
import { translateSqliteError } from './errors.js';
import { registerFunctions } from './functions.js';

export type ConnectionOptions = {
  /** File path, or ':memory:'. */
  location: string;
  /** Key of the database's notification bus (the resolved file path). */
  databaseKey: string;
  role: 'writer' | 'reader';
  busyTimeoutMs: number;
  /** Fail on computed columns that look like undecoded timestamps or JSON (tests). */
  strict: boolean;
};

/** What the driver knows about a statement beyond its SQL. */
export type StatementContext = {
  /** Result-type markers by output column name (`db/sql/typed.ts`). */
  markers: ReadonlyMap<string, ResultType> | undefined;
  /** The table an INSERT or UPDATE writes (for foreign-key error attribution). */
  writtenTable: string | undefined;
  /**
   * Hand-written SQL (a raw `sql` query) decodes its own computed columns, so strict mode skips it; it
   * checks queries built with Kysely, where a `db/sql/typed` marker belongs.
   */
  handWritten: boolean;
};

type PreparedStatement = {
  statement: StatementSync;
  /** Column metadata, or undefined for statements that return no rows. */
  columns: ColumnMetadata[] | undefined;
  decoders: Map<string, Decoder[]>;
};

const STATEMENT_CACHE_SIZE = 500;

/**
 * One `node:sqlite` connection. The writer runs every write transaction; readers run read-only
 * transactions and autocommit reads (WAL lets them read while the writer works). Calls are synchronous:
 * a statement blocks the event loop while it runs.
 */
export class SqliteConnection {
  readonly role: 'writer' | 'reader';
  readonly #database: DatabaseSync;
  readonly #options: ConnectionOptions;
  readonly #statements = new Map<string, PreparedStatement>();
  #transactionStart: string | undefined;
  #statementStart: string | undefined;
  #pendingNotifications: Array<[string, string]> = [];

  constructor(options: ConnectionOptions) {
    this.#options = options;
    this.role = options.role;
    this.#database = new DatabaseSync(options.location, { enableForeignKeyConstraints: true });
    this.#database.exec(`pragma busy_timeout = ${options.busyTimeoutMs}`);
    if (options.location !== ':memory:') {
      if (options.role === 'writer') {
        this.#database.exec('pragma journal_mode = wal');
      }
      this.#database.exec('pragma synchronous = normal');
    }
    if (options.role === 'reader') {
      this.#database.exec('pragma query_only = 1');
    }
    const nextvalStatement = (): StatementSync => {
      const statement = this.#database.prepare(
        'update sequences set value = value + 1 where name = ? returning value',
      );
      statement.setReadBigInts(true);
      return statement;
    };
    let nextval: StatementSync | undefined;
    registerFunctions(this.#database, {
      now: () => this.#transactionStart ?? this.#statementStart ?? toStoredTimestamp(new Date()),
      nextval: (name) => {
        nextval ??= nextvalStatement();
        const row = nextval.get(name) as { value: bigint } | undefined;
        if (!row) {
          throw new Error(`Unknown sequence ${name}`);
        }
        return row.value;
      },
      assertWriteTransaction: () => {
        if (this.role !== 'writer' || this.#transactionStart === undefined) {
          throw new Error('A transaction-level lock needs a write transaction on SQLite');
        }
      },
      notify: (channel, payload) => {
        if (this.#transactionStart === undefined) {
          publishNotification(this.#options.databaseKey, channel, payload);
        } else {
          this.#pendingNotifications.push([channel, payload]);
        }
      },
    });
  }

  get inTransaction(): boolean {
    return this.#transactionStart !== undefined;
  }

  /** Opens a transaction (`begin immediate` takes SQLite's write lock up front). */
  begin(mode: 'deferred' | 'immediate'): void {
    this.#database.exec(mode === 'immediate' ? 'begin immediate' : 'begin');
    this.#transactionStart = toStoredTimestamp(new Date());
    this.#pendingNotifications = [];
  }

  /** Commits and delivers the notifications queued inside the transaction. */
  commit(): void {
    try {
      this.#database.exec('commit');
    } catch (error) {
      this.rollback();
      throw error;
    }
    const notifications = this.#pendingNotifications;
    this.#end();
    for (const [channel, payload] of notifications) {
      publishNotification(this.#options.databaseKey, channel, payload);
    }
  }

  /** Rolls back (a no-op when SQLite already ended the transaction) and drops queued notifications. */
  rollback(): void {
    try {
      if (this.#database.isTransaction) {
        this.#database.exec('rollback');
      }
    } finally {
      this.#end();
    }
  }

  #end(): void {
    this.#transactionStart = undefined;
    this.#pendingNotifications = [];
  }

  #prepare(sql: string): PreparedStatement {
    const cached = this.#statements.get(sql);
    if (cached) {
      this.#statements.delete(sql);
      this.#statements.set(sql, cached);
      return cached;
    }
    const statement = this.#database.prepare(sql);
    statement.setReadBigInts(true);
    const metadata = statement.columns();
    const prepared: PreparedStatement = {
      statement,
      columns: metadata.length === 0 ? undefined : metadata,
      decoders: new Map(),
    };
    this.#statements.set(sql, prepared);
    if (this.#statements.size > STATEMENT_CACHE_SIZE) {
      const oldest = this.#statements.keys().next().value;
      if (oldest !== undefined) {
        this.#statements.delete(oldest);
      }
    }
    return prepared;
  }

  #decodersOf(prepared: PreparedStatement, context: StatementContext): Decoder[] {
    const { markers } = context;
    const strict = this.#options.strict && !context.handWritten;
    const cacheKey = markers === undefined ? String(strict) : undefined;
    let decoders = cacheKey === undefined ? undefined : prepared.decoders.get(cacheKey);
    if (!decoders) {
      decoders = (prepared.columns ?? []).map((column) => {
        const marker = markers?.get(column.name);
        const decoder = decoderFor(column, marker);
        if (!strict || marker || column.type !== null) {
          return decoder;
        }
        return (value: unknown) => {
          assertNotUndecoded(column.name, value);
          return decoder(value);
        };
      });
      if (cacheKey !== undefined) {
        prepared.decoders.set(cacheKey, decoders);
      }
    }
    return decoders;
  }

  /** Runs one compiled statement and decodes its rows. */
  execute<R>(query: CompiledQuery, context: StatementContext): QueryResult<R> {
    this.#statementStart = this.#transactionStart === undefined ? toStoredTimestamp(new Date()) : undefined;
    try {
      const prepared = this.#prepare(query.sql);
      const parameters = query.parameters.map(encodeParameter);
      if (!prepared.columns) {
        const { changes, lastInsertRowid } = prepared.statement.run(...parameters);
        return {
          numAffectedRows: BigInt(changes),
          insertId: BigInt(lastInsertRowid),
          rows: [],
        };
      }
      const columns = prepared.columns;
      const decoders = this.#decodersOf(prepared, context);
      const raw = prepared.statement.all(...parameters) as Array<Record<string, unknown>>;
      const rows = raw.map((source) => {
        const row: Record<string, unknown> = {};
        for (const [index, column] of columns.entries()) {
          row[column.name] = decoders[index]!(source[column.name]);
        }
        return row as R;
      });
      return { rows };
    } catch (error) {
      throw translateSqliteError(error, this.#database, context.writtenTable, query.sql);
    } finally {
      this.#statementStart = undefined;
    }
  }

  /** Runs SQL text with no parameters or results (pragmas, `vacuum into`). */
  exec(sql: string): void {
    this.#database.exec(sql);
  }

  close(): void {
    this.#statements.clear();
    if (this.#database.isOpen) {
      this.#database.close();
    }
  }
}
