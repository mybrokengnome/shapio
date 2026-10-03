import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { dialectOfUrl } from '../src/db/dialect.js';
import { createDb } from '../src/db/index.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { getTestDatabaseAdminUrl, withDatabaseName } from './helpers/env.js';
import { silentLogger } from './helpers/silentLogger.js';

export const TEMPLATE_DATABASE = 'shapio_test_tpl';
const SQLITE_TEMPLATE_FILE = 'template.db';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseAdminUrl: string;
    /** PostgreSQL: the template database's name. SQLite: the migrated template file. */
    testDatabaseTemplate: string;
    /** SQLite: the directory test database files live in ('' on PostgreSQL). */
    testSqliteDirectory: string;
  }
}

const runAdmin = async (adminUrl: string, statement: string) => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

/** A directory created for this run (removed at teardown), or the one `sqlite:<directory>` names. */
let createdSqliteDirectory: string | undefined;

const setupSqlite = async (project: TestProject, adminUrl: string) => {
  const named = adminUrl.slice('sqlite:'.length);
  let directory: string;
  if (named === '') {
    directory = mkdtempSync(join(tmpdir(), 'shapio-test-'));
    createdSqliteDirectory = directory;
  } else {
    directory = resolve(named);
    mkdirSync(directory, { recursive: true });
  }
  const building = join(directory, `building-${SQLITE_TEMPLATE_FILE}`);
  rmSync(building, { force: true });
  const db = createDb({ connectionString: `sqlite:${building}`, poolMax: 2 });
  try {
    await migrateToLatest(db, silentLogger);
  } finally {
    // Closing the last connection checkpoints the WAL into the file, so the copy below is complete.
    await db.destroy();
  }
  const template = join(directory, SQLITE_TEMPLATE_FILE);
  copyFileSync(building, template);
  rmSync(building, { force: true });
  project.provide('testDatabaseAdminUrl', adminUrl);
  project.provide('testDatabaseTemplate', template);
  project.provide('testSqliteDirectory', directory);
};

/**
 * Builds the template database once per run by running every migration. Each test file then clones it
 * (PostgreSQL: CREATE DATABASE ... TEMPLATE; SQLite: a file copy), which is far faster than migrating per
 * file and isolates advisory locks and LISTEN/NOTIFY, both of which are per database.
 */
export const setup = async (project: TestProject) => {
  const adminUrl = getTestDatabaseAdminUrl();
  if (dialectOfUrl(adminUrl) === 'sqlite') {
    await setupSqlite(project, adminUrl);
    return;
  }
  const template = pg.escapeIdentifier(TEMPLATE_DATABASE);
  await runAdmin(adminUrl, `drop database if exists ${template} with (force)`);
  await runAdmin(adminUrl, `create database ${template}`);
  const db = createDb({ connectionString: withDatabaseName(adminUrl, TEMPLATE_DATABASE), poolMax: 2 });
  try {
    await migrateToLatest(db, silentLogger);
  } finally {
    await db.destroy();
  }
  project.provide('testDatabaseAdminUrl', adminUrl);
  project.provide('testDatabaseTemplate', TEMPLATE_DATABASE);
  project.provide('testSqliteDirectory', '');
};

export const teardown = async () => {
  const adminUrl = getTestDatabaseAdminUrl();
  if (dialectOfUrl(adminUrl) === 'sqlite') {
    if (createdSqliteDirectory) {
      rmSync(createdSqliteDirectory, { recursive: true, force: true });
    }
    return;
  }
  await runAdmin(adminUrl, `drop database if exists ${pg.escapeIdentifier(TEMPLATE_DATABASE)} with (force)`);
};
