import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { registerFunctions } from '../../../api/src/db/sqlite/functions';
import { ARTIFACTS_DIR } from './constants';

/**
 * The e2e servers' databases, on the database TEST_DATABASE_URL names (the same variable as the API's
 * integration tests): a PostgreSQL maintenance database or a MySQL server (`mysql://…/`), beside which each
 * server gets a new database, or `sqlite:`, which gives each server a file in this run's artifacts directory.
 */
const maintenanceUrl = () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set TEST_DATABASE_URL (e.g. postgres://postgres@localhost:5432/postgres, mysql://root@localhost:3306/, or sqlite:) to run the e2e suite',
    );
  }
  return url;
};

export const isSqliteRun = () => maintenanceUrl().startsWith('sqlite:');

const isMysqlRun = () => maintenanceUrl().startsWith('mysql:');

/** A MySQL connection to the server (no database) or to one database. */
const connectMysql = (database?: string) => {
  const url = new URL(maintenanceUrl());
  url.pathname = database ? `/${database}` : '/';
  return mysql.createConnection({ uri: url.toString(), timezone: 'Z' });
};

const runOnMysql = async (statement: string) => {
  const connection = await connectMysql();
  try {
    await connection.query(statement);
  } finally {
    await connection.end();
  }
};

const mysqlIdentifier = (name: string) => `\`${name.replaceAll('`', '``')}\``;

const sqlitePath = (name: string) => join(ARTIFACTS_DIR, `${name}.db`);

const runOnMaintenance = async (statement: string) => {
  const client = new pg.Client({ connectionString: maintenanceUrl() });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

/** The DATABASE_URL a server uses for the database called `name`. */
export const databaseUrlOf = (name: string): string => {
  if (isSqliteRun()) {
    return `sqlite:${sqlitePath(name)}`;
  }
  const url = new URL(maintenanceUrl());
  url.pathname = `/${name}`;
  return url.toString();
};

/** Removes the SQLite file and its WAL files. */
const removeSqliteFiles = (name: string) => {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${sqlitePath(name)}${suffix}`, { force: true });
  }
};

/** Drops the database if it exists. */
export const dropDatabase = async (name: string): Promise<void> => {
  if (isSqliteRun()) {
    removeSqliteFiles(name);
    return;
  }
  if (isMysqlRun()) {
    await runOnMysql(`DROP DATABASE IF EXISTS ${mysqlIdentifier(name)}`);
    return;
  }
  await runOnMaintenance(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`);
};

/** Creates an empty database (dropping any earlier one); the server migrates it on start. */
export const createDatabase = async (name: string): Promise<void> => {
  await dropDatabase(name);
  if (isMysqlRun()) {
    await runOnMysql(
      `CREATE DATABASE ${mysqlIdentifier(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
  } else if (!isSqliteRun()) {
    await runOnMaintenance(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  }
};

/**
 * One statement on a SQLite file, outside the server process (SQLite's file locks serialise it with the
 * server's writes). The schema's defaults call Shapio's functions, so they are registered here too; a
 * fixture write has no transaction and sends no notifications.
 */
const querySqlite = <T>(name: string, statement: string, parameters: readonly unknown[]): T[] => {
  const database = new DatabaseSync(sqlitePath(name), { enableForeignKeyConstraints: true });
  try {
    database.exec('pragma busy_timeout = 5000');
    registerFunctions(database, {
      now: () => new Date().toISOString(),
      nextval: () => {
        throw new Error('e2e fixtures do not take sequence numbers');
      },
      notify: () => undefined,
      assertWriteTransaction: () => undefined,
    });
    return database.prepare(statement).all(...(parameters as SQLInputValue[])) as T[];
  } finally {
    database.close();
  }
};

/**
 * Runs one statement on the database called `name` and returns its rows. Parameters are written `?`.
 * SQLite goes through Shapio's own driver, whose functions the schema's defaults need.
 */
export const queryDatabase = async <T extends Record<string, unknown>>(
  name: string,
  statement: string,
  parameters: readonly unknown[] = [],
): Promise<T[]> => {
  if (isSqliteRun()) {
    return querySqlite<T>(name, statement, parameters);
  }
  if (isMysqlRun()) {
    const connection = await connectMysql(name);
    try {
      const [rows] = await connection.query(statement, [...parameters]);
      return Array.isArray(rows) ? (rows as T[]) : [];
    } finally {
      await connection.end();
    }
  }
  let index = 0;
  const client = new pg.Client({ connectionString: databaseUrlOf(name) });
  await client.connect();
  try {
    return (
      await client.query<T>(
        statement.replace(/\?/g, () => `$${++index}`),
        [...parameters],
      )
    ).rows;
  } finally {
    await client.end();
  }
};
