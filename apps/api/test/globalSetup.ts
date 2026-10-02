import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb } from '../src/db/index.js';
import { migrateToLatest } from '../src/db/migrator.js';
import { getTestDatabaseAdminUrl, withDatabaseName } from './helpers/env.js';
import { silentLogger } from './helpers/silentLogger.js';

export const TEMPLATE_DATABASE = 'shapio_test_tpl';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseAdminUrl: string;
    testDatabaseTemplate: string;
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

/**
 * Builds the template database once per run by running every migration. Each test file then clones it
 * (CREATE DATABASE ... TEMPLATE), which is far faster than migrating per file and isolates advisory
 * locks and LISTEN/NOTIFY, both of which are per database.
 */
export const setup = async (project: TestProject) => {
  const adminUrl = getTestDatabaseAdminUrl();
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
};

export const teardown = async () => {
  await runAdmin(
    getTestDatabaseAdminUrl(),
    `drop database if exists ${pg.escapeIdentifier(TEMPLATE_DATABASE)} with (force)`,
  );
};
