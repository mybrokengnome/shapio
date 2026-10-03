import { randomBytes } from 'node:crypto';
import { copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';
import { dialectOfUrl } from '../../src/db/dialect.js';
import { createDb, type Database } from '../../src/db/index.js';
import { withDatabaseName } from './env.js';
import { cloneMysqlDatabase, createMysqlDatabase, dropMysqlDatabase } from './mysqlAdmin.js';

export type TestDatabase = {
  name: string;
  url: string;
  db: Database;
  drop: () => Promise<void>;
};

const CLONE_RETRIES = 10;

const runAdmin = async (statement: string) => {
  const client = new pg.Client({ connectionString: inject('testDatabaseAdminUrl') });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

/** PostgreSQL refuses to clone a template that another CREATE DATABASE is copying at that moment. */
const isTemplateBusy = (error: unknown) =>
  error instanceof Error && 'code' in error && (error as { code?: string }).code === '55006';

const createDatabase = async (statement: string) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await runAdmin(statement);
      return;
    } catch (error) {
      if (!isTemplateBusy(error) || attempt >= CLONE_RETRIES) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
};

/** SQLite: a file copied from the migrated template (or a new empty file). */
const createSqliteTestDatabase = (name: string, empty: boolean): TestDatabase => {
  const path = join(inject('testSqliteDirectory'), `${name}.db`);
  if (!empty) {
    copyFileSync(inject('testDatabaseTemplate'), path);
  }
  const url = `sqlite:${path}`;
  const db = createDb({ connectionString: url, poolMax: 10, strict: true });
  let dropped = false;
  return {
    name,
    url,
    db,
    drop: async () => {
      if (dropped) {
        return;
      }
      dropped = true;
      await db.destroy();
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${path}${suffix}`, { force: true });
      }
    },
  };
};

/** MySQL: a database cloned from the migrated template (or a new empty one). */
const createMysqlTestDatabase = async (name: string, empty: boolean): Promise<TestDatabase> => {
  const adminUrl = inject('testDatabaseAdminUrl');
  if (empty) {
    await createMysqlDatabase(adminUrl, name);
  } else {
    await cloneMysqlDatabase(adminUrl, inject('testDatabaseTemplate'), name);
  }
  const url = withDatabaseName(adminUrl, name);
  const db = createDb({ connectionString: url, poolMax: 10 });
  let dropped = false;
  return {
    name,
    url,
    db,
    drop: async () => {
      if (dropped) {
        return;
      }
      dropped = true;
      await db.destroy();
      await dropMysqlDatabase(adminUrl, name);
    },
  };
};

/**
 * Creates a database for one test file. By default it is cloned from the migrated template; with
 * `{ empty: true }` it has no tables (for migration tests).
 */
export const createTestDatabase = async ({
  empty = false,
}: { empty?: boolean } = {}): Promise<TestDatabase> => {
  const name = `shapio_t_${process.pid}_${randomBytes(4).toString('hex')}`;
  if (dialectOfUrl(inject('testDatabaseAdminUrl')) === 'sqlite') {
    return createSqliteTestDatabase(name, empty);
  }
  if (dialectOfUrl(inject('testDatabaseAdminUrl')) === 'mysql') {
    return createMysqlTestDatabase(name, empty);
  }
  const source = empty ? 'template0' : inject('testDatabaseTemplate');
  await createDatabase(
    `create database ${pg.escapeIdentifier(name)} template ${pg.escapeIdentifier(source)}`,
  );
  const url = withDatabaseName(inject('testDatabaseAdminUrl'), name);
  const db = createDb({ connectionString: url, poolMax: 10, applicationName: 'shapio-test' });
  let dropped = false;
  return {
    name,
    url,
    db,
    drop: async () => {
      if (dropped) {
        return;
      }
      dropped = true;
      await db.destroy();
      await runAdmin(`drop database if exists ${pg.escapeIdentifier(name)} with (force)`);
    },
  };
};

/** Registers beforeAll/afterAll hooks; read `.current` inside tests. */
export const useTestDatabase = (options: { empty?: boolean } = {}) => {
  const handle = {} as { current: TestDatabase };
  beforeAll(async () => {
    handle.current = await createTestDatabase(options);
  });
  afterAll(async () => {
    await handle.current?.drop();
  });
  return handle;
};
