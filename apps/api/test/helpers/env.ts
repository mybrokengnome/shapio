import { resolve } from 'node:path';
import { loadEnvFileIfPresent } from '../../src/config/index.js';
import { dialectOfUrl, type DialectName } from '../../src/db/dialect.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
export const API_ROOT = resolve(import.meta.dirname, '../..');

/**
 * Reads TEST_DATABASE_URL, loading the repo .env for local runs: a PostgreSQL maintenance database such as
 * `postgres://localhost/postgres` (test databases are created and dropped beside it), or `sqlite:` /
 * `sqlite:<directory>` to run the suite on SQLite (test databases are files in that directory, by default
 * a temporary one).
 */
export const getTestDatabaseAdminUrl = (): string => {
  loadEnvFileIfPresent(resolve(REPOSITORY_ROOT, '.env'));
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a maintenance database, e.g. postgres://localhost/postgres, or use sqlite:',
    );
  }
  return url;
};

/** The dialect the integration suite runs on. */
export const testDialect = (): DialectName => dialectOfUrl(getTestDatabaseAdminUrl()) ?? 'postgres';

/** Same server and credentials, different database name (PostgreSQL). */
export const withDatabaseName = (url: string, name: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};
