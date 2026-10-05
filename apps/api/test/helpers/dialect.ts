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

export const isMysqlRun = (): boolean => testDialect() === 'mysql';

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
  'deliveryInProcess.int.test.ts':
    'in-process delivery refuses SQLite (one process serves it); the refusal is unit-tested in delivery/runtime.test.ts',
  'operations.int.test.ts > database outage':
    'drops PostgreSQL connections through a TCP proxy; SQLite is a local file',
  'schemaChanges.int.test.ts > invalid index':
    'INVALID indexes come from a failed CREATE INDEX CONCURRENTLY (PostgreSQL only)',
};

/** Test files (or single tests) that cannot run on MySQL, with the reason (same rules as SQLITE_SKIPS). */
const MYSQL_SKIPS: Readonly<Record<string, string>> = {
  'backupRestore.int.test.ts':
    'pg_dump/pg_restore backups; MySQL backups are mysqldump (documentation/mysql.md)',
  'migrator.int.test.ts':
    'replays the PostgreSQL migration history; MySQL starts from its baseline (mysqlBaseline.int.test.ts)',
  'sitesMigration.int.test.ts':
    'a PostgreSQL data migration over pre-sites data; MySQL starts from its baseline',
  'changesShipMigration.int.test.ts': 'a PostgreSQL data migration; MySQL starts from its baseline',
  'deploymentProvidersMigration.int.test.ts': 'a PostgreSQL data migration; MySQL starts from its baseline',
  'sqliteBackup.int.test.ts': 'SQLite backups (VACUUM INTO)',
  'contentIndexes.int.test.ts':
    'PostgreSQL index builds and planner checks (CONCURRENTLY, INVALID indexes, statistics); MySQL builds are covered by mysqlContent.int.test.ts',
  'operations.int.test.ts > database outage': 'drops PostgreSQL connections through a TCP proxy',
  'schemaChanges.int.test.ts > invalid index':
    'INVALID indexes come from a failed CREATE INDEX CONCURRENTLY (PostgreSQL only)',
  'load.int.test.ts > the partial-index ceiling on entry_heads':
    'MySQL caps filterable or sortable fields at 56 per instance (MYSQL_MAX_FIELD_INDEXES, documentation/mysql.md); the case needs 250',
};

const SKIPS: Readonly<Partial<Record<DialectName, Readonly<Record<string, string>>>>> = {
  sqlite: SQLITE_SKIPS,
  mysql: MYSQL_SKIPS,
};

const DIALECT_LABELS: Readonly<Record<DialectName, string>> = {
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mysql: 'MySQL',
};

/**
 * Why `key` (a test file's `import.meta.url`, optionally with ` > part`) is skipped on this run's
 * database, or undefined when it runs. Use as `describe.skipIf(reason)(withReason(title, reason), …)`.
 */
export const dialectSkipReason = (fileUrl: string, part?: string): string | undefined => {
  const skips = SKIPS[testDialect()];
  if (!skips) {
    return undefined;
  }
  const file = basename(fileURLToPath(fileUrl));
  return skips[part === undefined ? file : `${file} > ${part}`];
};

/** A suite title that says why it is skipped. */
export const withSkipReason = (title: string, reason: string | undefined): string =>
  reason === undefined ? title : `${title} [skipped on ${DIALECT_LABELS[testDialect()]}: ${reason}]`;

/** Whether a JSON column has a top-level key. */
export const jsonHasKey = (column: string, key: string): RawBuilder<boolean> =>
  isMysqlRun()
    ? sql<boolean>`json_contains_path(${sql.ref(column)}, 'one', ${`$."${key}"`})`
    : isSqliteRun()
      ? sql<boolean>`(json_type(${sql.ref(column)}, ${`$."${key}"`}) is not null)`
      : sql<boolean>`(${sql.ref(column)} ? ${key})`;

/** A JSON object column's top-level key as text (PostgreSQL's `column ->> 'key'`). */
export const jsonField = (column: string, key: string): RawBuilder<string> =>
  isMysqlRun()
    ? sql<string>`json_value(${sql.ref(column)}, ${`$."${key}"`} returning char(1000))`
    : sql<string>`(${sql.ref(column)} ->> ${key})`;

/** A JSON column as its text. */
export const jsonText = (column: string): RawBuilder<string> => {
  if (isMysqlRun()) {
    return sql<string>`cast(${sql.ref(column)} as char)`;
  }
  return isSqliteRun() ? sql<string>`(${sql.ref(column)} || '')` : sql<string>`${sql.ref(column)}::text`;
};

/** A JSON object column with one top-level key set to a string. */
export const jsonWithKey = (column: string, key: string, value: string): RawBuilder<unknown> =>
  isSqliteRun() || isMysqlRun()
    ? sql`json_set(${sql.ref(column)}, ${`$."${key}"`}, ${value})`
    : sql`${sql.ref(column)} || jsonb_build_object(${key}::text, ${value}::text)`;

/** A JSON object column without one top-level key. */
export const jsonWithoutKey = (column: string, key: string): RawBuilder<unknown> =>
  isSqliteRun() || isMysqlRun()
    ? sql`json_remove(${sql.ref(column)}, ${`$."${key}"`})`
    : sql`${sql.ref(column)} - ${sql.lit(key)}`;

/** Column types for tables tests create themselves. */
export const testColumnTypes = () => {
  if (isMysqlRun()) {
    return {
      serialKey: sql`bigint not null auto_increment primary key`,
      uuid: sql`char(36) character set ascii collate ascii_general_ci`,
      jsonb: sql`json`,
    };
  }
  return isSqliteRun()
    ? { serialKey: sql`integer primary key`, uuid: sql`text_uuid`, jsonb: sql`text_jsonb` }
    : { serialKey: sql`serial primary key`, uuid: sql`uuid`, jsonb: sql`jsonb` };
};

/** Runs `fn` with a table's update trigger disabled (to fake legacy rows in immutable history tables). */
export const withoutUpdateTrigger = async (
  executor: Parameters<RawBuilder<unknown>['execute']>[0],
  table: string,
  trigger: string,
  fn: () => Promise<void>,
): Promise<void> => {
  if (isMysqlRun()) {
    const { rows } = await sql<Record<string, string>>`show create trigger ${sql.id(trigger)}`.execute(
      executor,
    );
    const definition = rows[0]?.['SQL Original Statement'];
    if (!definition) {
      throw new Error(`No trigger ${trigger}`);
    }
    await sql`drop trigger ${sql.id(trigger)}`.execute(executor);
    await fn();
    await sql.raw(definition).execute(executor);
    return;
  }
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

type Executor = Parameters<RawBuilder<unknown>['execute']>[0];

/**
 * IDs of the connections a process opened to `databaseName` under `applicationName` (PostgreSQL's
 * application_name; on MySQL the `program_name` connection attribute). SQLite has none to list.
 */
export const connectionIdsOf = async (
  executor: Executor,
  databaseName: string,
  applicationName: string,
): Promise<number[]> => {
  if (isSqliteRun()) {
    return [];
  }
  const { rows } = isMysqlRun()
    ? await sql<{ id: string | number }>`
        select a.processlist_id as id from performance_schema.session_connect_attrs a
        join information_schema.processlist p on p.id = a.processlist_id
        where a.attr_name = 'program_name' and a.attr_value = ${applicationName} and p.db = ${databaseName}`.execute(
        executor,
      )
    : await sql<{ id: number }>`
        select pid as id from pg_stat_activity
        where datname = ${databaseName} and application_name = ${applicationName}`.execute(executor);
  return rows.map((row) => Number(row.id));
};

/** Ends another connection (to test reconnects). */
export const terminateConnection = async (executor: Executor, id: number): Promise<void> => {
  if (isMysqlRun()) {
    await sql.raw(`kill connection ${Number(id)}`).execute(executor);
    return;
  }
  await sql`select pg_terminate_backend(${id})`.execute(executor);
};
