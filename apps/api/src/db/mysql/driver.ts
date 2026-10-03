import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings,
  type UnknownRow,
} from 'kysely';
import mysql, { type Pool, type PoolConnection, type PoolOptions, type ResultSetHeader } from 'mysql2';
import { publishNotification } from '../notifyHub.js';
import { encodeParameter, typeCast } from './codec.js';
import { planOf } from './compiler.js';
import { annotateMysqlError } from './errors.js';
import { NotificationChannel, SequenceValue, sequenceTableOf } from './parameters.js';
import type { PlanContext } from './plans.js';

/**
 * Shapio's MySQL driver (ADR 0001, "MySQL") on mysql2's pool. Beyond Kysely's own MySQL driver it:
 * - sets every session up like PostgreSQL behaves: UTC, READ COMMITTED, strict SQL mode, utf8mb4 with the
 *   binary `utf8mb4_0900_bin` collation, a large `group_concat_max_len` (JSON aggregates);
 * - pins `NOW()` and `CURRENT_TIMESTAMP` defaults to the transaction's start (`SET timestamp`), as
 *   PostgreSQL's `now()` is;
 * - runs statement plans (`plans.ts`) atomically: inside a transaction under a savepoint, otherwise in a
 *   transaction of their own;
 * - resolves sequence values and notification channels bound as parameters (`parameters.ts`), and publishes
 *   notifications to listeners in this process once their transaction commits;
 * - names the constraint of a constraint error (`errors.ts`).
 */
export const SESSION_SETUP =
  "set names utf8mb4 collate utf8mb4_0900_bin, time_zone = '+00:00', transaction_isolation = 'READ-COMMITTED', " +
  "sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION', " +
  'group_concat_max_len = 1073741824';

const PIN_TIMESTAMP = 'set timestamp = unix_timestamp(sysdate(6))';
const UNPIN_TIMESTAMP = 'set timestamp = default';

export type MysqlDriverOptions = {
  url: string;
  poolMax: number;
  /** Reported as the `program_name` connection attribute (PostgreSQL's application_name). */
  applicationName?: string;
  /** Reports an idle pooled connection that failed (the pool replaces it). */
  onIdleConnectionError?: (error: Error) => void;
};

/** `host:port/database` of a mysql: URL: the key listeners in this process share. */
export const mysqlDatabaseKey = (url: string): string => {
  const parsed = new URL(url);
  return `mysql:${parsed.hostname}:${parsed.port || '3306'}${parsed.pathname}`;
};

export const mysqlPoolOptions = (url: string, poolMax: number, applicationName = 'shapio'): PoolOptions => ({
  uri: url,
  // Visible in performance_schema.session_connect_attrs, like PostgreSQL's application_name.
  connectAttributes: { program_name: applicationName },
  connectionLimit: poolMax,
  // The handshake carries a one-byte collation ID; the session setup sets utf8mb4_0900_bin.
  charset: 'UTF8MB4_GENERAL_CI',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: false,
  typeCast,
  multipleStatements: false,
});

type PendingNotification = { channel: string; payload: string; id?: string };

type RawResult = UnknownRow[] | ResultSetHeader;

const isResultHeader = (result: RawResult): result is ResultSetHeader =>
  !Array.isArray(result) && typeof result === 'object' && 'affectedRows' in result;

class MysqlConnection implements DatabaseConnection {
  readonly #connection: PoolConnection;
  readonly #databaseKey: string;
  #inTransaction = false;
  #savepoints = 0;
  #pending: PendingNotification[] = [];

  constructor(connection: PoolConnection, databaseKey: string) {
    this.#connection = connection;
    this.#databaseKey = databaseKey;
  }

  get inTransaction(): boolean {
    return this.#inTransaction;
  }

  release(): void {
    this.#connection.release();
  }

  #query(sql: string, parameters: readonly unknown[] = []): Promise<RawResult> {
    return new Promise((resolve, reject) => {
      this.#connection.query(sql, parameters as unknown[], (error, result) => {
        if (error) {
          reject(annotateMysqlError(error));
        } else {
          resolve(result as RawResult);
        }
      });
    });
  }

  /** Runs a raw control statement (transactions, savepoints, session settings). */
  async control(sql: string): Promise<void> {
    await this.#query(sql);
  }

  async begin(settings: TransactionSettings): Promise<void> {
    const statements: string[] = [];
    if (settings.isolationLevel || settings.accessMode) {
      const parts = [
        ...(settings.isolationLevel ? [`isolation level ${settings.isolationLevel}`] : []),
        ...(settings.accessMode ? [settings.accessMode] : []),
      ];
      statements.push(`set transaction ${parts.join(', ')}`);
    }
    statements.push(PIN_TIMESTAMP, 'begin');
    // mysql2 runs a connection's queries in order; sending them together saves round trips.
    await Promise.all(statements.map((statement) => this.#query(statement)));
    this.#inTransaction = true;
    this.#pending = [];
  }

  async end(command: 'commit' | 'rollback'): Promise<void> {
    const pending = this.#pending;
    this.#pending = [];
    this.#inTransaction = false;
    await Promise.all([this.#query(command), this.#query(UNPIN_TIMESTAMP)]);
    if (command === 'commit') {
      for (const { channel, payload, id } of pending) {
        publishNotification(this.#databaseKey, channel, payload, id);
      }
    }
  }

  async #nextSequenceValue(name: string): Promise<string> {
    const table = sequenceTableOf(name);
    const inserted = await this.#query(`insert into \`${table}\` () values ()`);
    const value = isResultHeader(inserted) ? String(inserted.insertId) : undefined;
    if (value === undefined) {
      throw new Error(`No value from sequence ${name}`);
    }
    await this.#query(`delete from \`${table}\` where \`value\` = ?`, [value]);
    return value;
  }

  /** Encodes parameters, allocating sequence values and noting notifications. */
  async #parametersOf(parameters: readonly unknown[]): Promise<{
    values: unknown[];
    notifications: PendingNotification[];
  }> {
    const values: unknown[] = [];
    const notifications: PendingNotification[] = [];
    for (const [index, parameter] of parameters.entries()) {
      if (parameter instanceof SequenceValue) {
        values.push(await this.#nextSequenceValue(parameter.name));
      } else if (parameter instanceof NotificationChannel) {
        notifications.push({ channel: parameter.channel, payload: parameter.payload });
        values.push(parameter.channel);
      } else {
        values.push(encodeParameter(parameter, index));
      }
    }
    return { values, notifications };
  }

  async #execute(query: CompiledQuery): Promise<QueryResult<UnknownRow>> {
    const { values, notifications } = await this.#parametersOf(query.parameters);
    const result = await this.#query(query.sql, values);
    if (notifications.length > 0) {
      // A notification is one inserted row: its ID lets a polling listener skip what it already heard.
      const id = isResultHeader(result) && result.insertId ? String(result.insertId) : undefined;
      const published = notifications.map((notification) => ({ ...notification, id }));
      if (this.#inTransaction) {
        this.#pending.push(...published);
      } else {
        for (const notification of published) {
          publishNotification(this.#databaseKey, notification.channel, notification.payload, notification.id);
        }
      }
    }
    if (!isResultHeader(result)) {
      return { rows: Array.isArray(result) ? result : [] };
    }
    return {
      rows: [],
      numAffectedRows: BigInt(result.affectedRows),
      ...(result.insertId ? { insertId: BigInt(result.insertId) } : {}),
    };
  }

  readonly #planContext: PlanContext = {
    run: (query) => this.#execute(query),
    atomically: async (fn) => {
      if (this.#inTransaction) {
        return this.#planContext.savepoint(fn);
      }
      await this.begin({});
      try {
        const result = await fn();
        await this.end('commit');
        return result;
      } catch (error) {
        await this.end('rollback');
        throw error;
      }
    },
    savepoint: async (fn) => {
      const name = `shapio_plan_${(this.#savepoints += 1)}`;
      await this.#query(`savepoint ${name}`);
      try {
        const result = await fn();
        await this.#query(`release savepoint ${name}`);
        return result;
      } catch (error) {
        await this.#query(`rollback to savepoint ${name}`);
        throw error;
      }
    },
  };

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const plan = planOf(query);
    const result = plan ? await plan(this.#planContext) : await this.#execute(query);
    return result as QueryResult<R>;
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Streaming queries are not supported on MySQL');
  }
}

export class MysqlDriver implements Driver {
  readonly #options: MysqlDriverOptions;
  readonly databaseKey: string;
  #pool: Pool | undefined;
  readonly #connections = new WeakMap<PoolConnection, MysqlConnection>();

  constructor(options: MysqlDriverOptions) {
    this.#options = options;
    this.databaseKey = mysqlDatabaseKey(options.url);
  }

  async init(): Promise<void> {
    const pool = mysql.createPool(
      mysqlPoolOptions(this.#options.url, this.#options.poolMax, this.#options.applicationName),
    );
    pool.on('connection', (connection) => {
      connection.query(SESSION_SETUP, (error) => {
        if (error) {
          this.#options.onIdleConnectionError?.(error);
          connection.destroy();
        }
      });
      // An idle connection that dies emits 'error'; the pool drops it and opens another on demand.
      connection.on('error', (error: Error) => this.#options.onIdleConnectionError?.(error));
    });
    this.#pool = pool;
  }

  #pooled(): Pool {
    if (!this.#pool) {
      throw new Error('The MySQL driver is not initialised');
    }
    return this.#pool;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const raw = await new Promise<PoolConnection>((resolve, reject) => {
      this.#pooled().getConnection((error, connection) => (error ? reject(error) : resolve(connection)));
    });
    let connection = this.#connections.get(raw);
    if (!connection) {
      connection = new MysqlConnection(raw, this.databaseKey);
      this.#connections.set(raw, connection);
    }
    return connection;
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    await (connection as MysqlConnection).begin(settings);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as MysqlConnection).end('commit');
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as MysqlConnection).end('rollback');
  }

  async savepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await (connection as MysqlConnection).control(`savepoint \`${name}\``);
  }

  async rollbackToSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await (connection as MysqlConnection).control(`rollback to savepoint \`${name}\``);
  }

  async releaseSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await (connection as MysqlConnection).control(`release savepoint \`${name}\``);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    (connection as MysqlConnection).release();
  }

  async destroy(): Promise<void> {
    const pool = this.#pool;
    this.#pool = undefined;
    if (pool) {
      await new Promise<void>((resolve, reject) => pool.end((error) => (error ? reject(error) : resolve())));
    }
  }
}
