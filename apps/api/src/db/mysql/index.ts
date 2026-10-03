import {
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type QueryCompiler,
} from 'kysely';
import { ShapioMysqlQueryCompiler } from './compiler.js';
import { MysqlDriver, type MysqlDriverOptions } from './driver.js';
import { MysqlPlugin } from './plugin.js';

/**
 * Kysely on MySQL 8.4 (ADR 0001, "MySQL"). RETURNING is emulated by statement plans. Migration locking is Shapio's own session lock
 * (`db/migrator.ts`), scoped to the database, so Kysely's server-wide `GET_LOCK` name is not taken.
 */
class ShapioMysqlAdapter extends MysqlAdapter {
  /** Statement plans give MySQL RETURNING (`plans.ts`), so builders return the rows. */
  override get supportsReturning(): boolean {
    return true;
  }

  override async acquireMigrationLock(): Promise<void> {
    // Shapio's migrator holds a database-scoped session lock around every run.
  }

  override async releaseMigrationLock(): Promise<void> {
    // See acquireMigrationLock.
  }
}

class ShapioMysqlDialect implements Dialect {
  readonly driver: MysqlDriver;

  constructor(driver: MysqlDriver) {
    this.driver = driver;
  }

  createAdapter() {
    return new ShapioMysqlAdapter();
  }

  createDriver(): Driver {
    return this.driver;
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new MysqlIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new ShapioMysqlQueryCompiler();
  }
}

/** A Kysely handle on MySQL; the driver is reachable for the database key listeners share. */
export class MysqlKysely<DB> extends Kysely<DB> {
  readonly mysqlDriver: MysqlDriver;

  constructor(driver: MysqlDriver) {
    super({ dialect: new ShapioMysqlDialect(driver), plugins: [new MysqlPlugin()] });
    this.mysqlDriver = driver;
  }
}

export const createMysqlDb = <DB>(options: MysqlDriverOptions): MysqlKysely<DB> =>
  new MysqlKysely<DB>(new MysqlDriver(options));

/** The MySQL driver behind a handle, or undefined for another dialect. */
export const mysqlDriverOf = (db: unknown): MysqlDriver | undefined =>
  db instanceof MysqlKysely ? db.mysqlDriver : undefined;
