import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type KyselyConfig,
  type TransactionBuilder,
} from 'kysely';
import type { SqliteLocation } from '../dialect.js';
import { SqliteDriver } from './driver.js';
import { SqlitePlugin } from './plugin.js';
import { runInTransactionScope } from './writeLock.js';

/**
 * SQLite runs DDL inside transactions, so each migration commits or rolls back whole. The driver handles
 * concurrency itself (one writer, several readers), so Kysely must not serialise connections on top.
 */
class ShapioSqliteAdapter extends SqliteAdapter {
  override get supportsTransactionalDdl(): boolean {
    return true;
  }

  override get supportsMultipleConnections(): boolean {
    return true;
  }
}

class ShapioSqliteDialect implements Dialect {
  readonly driver: SqliteDriver;

  constructor(driver: SqliteDriver) {
    this.driver = driver;
  }

  createAdapter() {
    return new ShapioSqliteAdapter();
  }

  createDriver(): Driver {
    return this.driver;
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
}

/** Runs every `execute` of a transaction builder (and of the builders it returns) in a transaction scope. */
const scoped = <DB>(builder: TransactionBuilder<DB>): TransactionBuilder<DB> =>
  new Proxy(builder, {
    get(target, property, receiver) {
      if (property === 'execute') {
        return <T>(callback: Parameters<TransactionBuilder<DB>['execute']>[0]) =>
          runInTransactionScope(() => target.execute(callback) as Promise<T>);
      }
      if (property === 'setIsolationLevel' || property === 'setAccessMode') {
        return (value: never) => scoped(target[property](value));
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

/**
 * Kysely on SQLite. Transactions run in a scope so a write that would wait for its own enclosing write
 * transaction fails at once instead of hanging (`writeLock.ts`).
 */
export class SqliteKysely<DB> extends Kysely<DB> {
  readonly sqliteDriver: SqliteDriver;

  constructor(config: KyselyConfig & { dialect: ShapioSqliteDialect }) {
    super(config);
    this.sqliteDriver = config.dialect.driver;
  }

  override transaction(): TransactionBuilder<DB> {
    return scoped(super.transaction());
  }
}

export type CreateSqliteDbOptions = {
  location: SqliteLocation;
  readers: number;
  busyTimeoutMs?: number;
  strict?: boolean;
};

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export const createSqliteDb = <DB>({
  location,
  readers,
  busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS,
  strict = false,
}: CreateSqliteDbOptions): SqliteKysely<DB> =>
  new SqliteKysely<DB>({
    dialect: new ShapioSqliteDialect(new SqliteDriver({ location, readers, busyTimeoutMs, strict })),
    plugins: [new SqlitePlugin()],
  });

/** The SQLite driver behind a handle, or undefined for another dialect. */
export const sqliteDriverOf = (db: unknown): SqliteDriver | undefined =>
  db instanceof SqliteKysely ? db.sqliteDriver : undefined;

export type { SqliteDriver };
