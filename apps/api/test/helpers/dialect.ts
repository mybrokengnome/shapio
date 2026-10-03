import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, type RawBuilder } from 'kysely';
import { inject } from 'vitest';
import { dialectOfUrl, type DialectName } from '../../src/db/dialect.js';

/**
 * The database the integration suite runs on (TEST_DATABASE_URL), and the few spellings tests need where
 * they reach into the database with raw SQL. Production SQL never lives here (db/ and content/compiler/).
 */
export const testDialect = (): DialectName => dialectOfUrl(inject('testDatabaseAdminUrl')) ?? 'postgres';

export const isSqliteRun = (): boolean => testDialect() === 'sqlite';

/**
 * Test files (or single tests) that cannot run on SQLite, with the reason. The only place a test is
 * skipped by dialect; keep it short and give every entry a reason.
 */
const SQLITE_SKIPS: Readonly<Record<string, string>> = {
  'backupRestore.int.test.ts':
    'pg_dump/pg_restore backups; SQLite backups are covered by sqliteBackup.int.test.ts',
  'migrator.int.test.ts':
    'replays the PostgreSQL migration history; SQLite starts from its baseline (sqliteBaseline.int.test.ts)',
  'sitesMigration.int.test.ts':
    'a PostgreSQL data migration over pre-sites data; SQLite starts from its baseline',
  'changesShipMigration.int.test.ts': 'a PostgreSQL data migration; SQLite starts from its baseline',
  'deploymentProvidersMigration.int.test.ts': 'a PostgreSQL data migration; SQLite starts from its baseline',
  'extensionsWorker.int.test.ts': 'WORKER_MODE=dedicated needs PostgreSQL (SQLite runs in one process)',
  'contentIndexes.int.test.ts':
    'PostgreSQL index builds and planner checks (CONCURRENTLY, INVALID indexes, statistics)',
  'operations.int.test.ts > database outage':
    'drops PostgreSQL connections through a TCP proxy; SQLite is a local file',
  'schemaChanges.int.test.ts > invalid index':
    'INVALID indexes come from a failed CREATE INDEX CONCURRENTLY (PostgreSQL only)',
};

/**
 * Why `key` (a test file's `import.meta.url`, optionally with ` > part`) is skipped on this run's
 * database, or undefined when it runs. Use as `describe.skipIf(reason)(withReason(title, reason), …)`.
 */
export const dialectSkipReason = (fileUrl: string, part?: string): string | undefined => {
  if (!isSqliteRun()) {
    return undefined;
  }
  const file = basename(fileURLToPath(fileUrl));
  return SQLITE_SKIPS[part === undefined ? file : `${file} > ${part}`];
};

/** A suite title that says why it is skipped. */
export const withSkipReason = (title: string, reason: string | undefined): string =>
  reason === undefined ? title : `${title} [skipped on SQLite: ${reason}]`;

/** Whether a JSON column has a top-level key. */
export const jsonHasKey = (column: string, key: string): RawBuilder<boolean> =>
  isSqliteRun()
    ? sql<boolean>`(json_type(${sql.ref(column)}, ${`$."${key}"`}) is not null)`
    : sql<boolean>`(${sql.ref(column)} ? ${key})`;

/** A JSON column as its text. */
export const jsonText = (column: string): RawBuilder<string> =>
  isSqliteRun() ? sql<string>`(${sql.ref(column)} || '')` : sql<string>`${sql.ref(column)}::text`;

/** A JSON object column with one top-level key set to a string. */
export const jsonWithKey = (column: string, key: string, value: string): RawBuilder<unknown> =>
  isSqliteRun()
    ? sql`json_set(${sql.ref(column)}, ${`$."${key}"`}, ${value})`
    : sql`${sql.ref(column)} || jsonb_build_object(${key}::text, ${value}::text)`;

/** A JSON object column without one top-level key. */
export const jsonWithoutKey = (column: string, key: string): RawBuilder<unknown> =>
  isSqliteRun()
    ? sql`json_remove(${sql.ref(column)}, ${`$."${key}"`})`
    : sql`${sql.ref(column)} - ${sql.lit(key)}`;

/** Column types for tables tests create themselves. */
export const testColumnTypes = () =>
  isSqliteRun()
    ? { serialKey: sql`integer primary key`, uuid: sql`text_uuid`, jsonb: sql`text_jsonb` }
    : { serialKey: sql`serial primary key`, uuid: sql`uuid`, jsonb: sql`jsonb` };

/** Runs `fn` with a table's update trigger disabled (to fake legacy rows in immutable history tables). */
export const withoutUpdateTrigger = async (
  executor: Parameters<RawBuilder<unknown>['execute']>[0],
  table: string,
  trigger: string,
  fn: () => Promise<void>,
): Promise<void> => {
  if (!isSqliteRun()) {
    await sql`alter table ${sql.table(table)} disable trigger ${sql.id(trigger)}`.execute(executor);
    await fn();
    await sql`alter table ${sql.table(table)} enable trigger ${sql.id(trigger)}`.execute(executor);
    return;
  }
  const { rows } = await sql<{ sql: string }>`
    select sql from sqlite_schema where type = 'trigger' and name = ${trigger}`.execute(executor);
  const definition = rows[0]?.sql;
  if (!definition) {
    throw new Error(`No trigger ${trigger}`);
  }
  await sql`drop trigger ${sql.id(trigger)}`.execute(executor);
  await fn();
  await sql.raw(definition).execute(executor);
};
