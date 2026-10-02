import { resolve } from 'node:path';
import { loadEnvFileIfPresent } from '../../src/config/index.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
export const API_ROOT = resolve(import.meta.dirname, '../..');

/** Reads TEST_DATABASE_URL (a maintenance database such as `postgres`), loading the repo .env for local runs. */
export const getTestDatabaseAdminUrl = (): string => {
  loadEnvFileIfPresent(resolve(REPOSITORY_ROOT, '.env'));
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a maintenance database, e.g. postgres://localhost/postgres',
    );
  }
  return url;
};

/** Same server and credentials, different database name. */
export const withDatabaseName = (url: string, name: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};
