import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompiledQuery, sql, type Kysely, type RawBuilder } from 'kysely';
import { mysqlContentDialect } from '../../src/content/compiler/dialect/mysql.js';
import { postgresContentDialect } from '../../src/content/compiler/dialect/postgres.js';
import { sqliteContentDialect } from '../../src/content/compiler/dialect/sqlite.js';
import type { ContentSqlDialect } from '../../src/content/compiler/dialect/types.js';
import { createMigrator } from '../../src/db/migrator.js';
import { createSqliteDb } from '../../src/db/sqlite/index.js';
import type { DB } from '../../src/db/types.js';
import { isMysqlRun, isSqliteRun } from './dialect.js';
import { createTestDatabase } from './testDatabase.js';

/**
 * Shapio's real content tables (`entries`, `entry_heads`, `content_revisions`, `publication_log`) on
 * PostgreSQL or MySQL (the run's migrated test template) and on SQLite (a file migrated with the SQLite
 * baseline), so one test file can run the same compiled queries against both. Rows are given with the columns the compiler
 * reads; `execute(insertRow(…))` fills the other required columns and creates the site, model, schema
 * revision and admin rows they reference.
 */
export type ContentTestDatabase = {
  dialect: ContentSqlDialect;
  execute: (statement: RawBuilder<unknown> | RowInsert) => Promise<void>;
  /**
   * Inserts many rows into one table: multi-row statements in one transaction, so a large fixture costs a
   * few round trips and one commit instead of one of each per row.
   */
  insertRows: (table: string, rows: ReadonlyArray<Readonly<Record<string, unknown>>>) => Promise<void>;
  rows: <T>(query: RawBuilder<T>) => Promise<T[]>;
  /** SQLite: the `EXPLAIN QUERY PLAN` details of a query; MySQL: the lines of `EXPLAIN FORMAT=TREE`. */
  plan: (query: RawBuilder<unknown>) => Promise<string[]>;
  close: () => Promise<void>;
};

export type RowInsert = { table: string; row: Readonly<Record<string, unknown>> };

/** A row for one of the content tables (inserted by `ContentTestDatabase.execute`). */
export const insertRow = (table: string, row: Readonly<Record<string, unknown>>): RowInsert => ({
  table,
  row,
});

const isRowInsert = (value: RawBuilder<unknown> | RowInsert): value is RowInsert =>
  'table' in value && 'row' in value;

const schemaRevisionIdOf = (modelId: string) => `${modelId.slice(0, 24)}5c4e5a000001`;

/** Rows per multi-row insert (well under every database's bound-parameter limit). */
const INSERT_CHUNK_SIZE = 500;

/**
 * Completes `row` for `table` with the columns the compiler does not read, creating the rows it references
 * first (each once).
 */
const rowCompleter = (db: Kysely<DB>) => {
  const ensured = new Set<string>();
  const modelOfEntry = new Map<string, string>();
  const createdAtOfEntry = new Map<string, unknown>();
  const once = async (key: string, insert: () => Promise<unknown>) => {
    if (!ensured.has(key)) {
      ensured.add(key);
      await insert();
    }
  };
  const ensureSite = (siteId: string) =>
    once(`site:${siteId}`, () =>
      db
        .insertInto('sites')
        .values({ id: siteId, key: `site-${siteId.slice(-6)}`, name: 'Fixture site' })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .execute(),
    );
  const ensureModel = (modelId: string) =>
    once(`model:${modelId}`, async () => {
      await sql`insert into models (id, kind, api_key) values (${modelId}, 'collection', ${`m${modelId.slice(-6)}`})`.execute(
        db,
      );
      await sql`insert into schema_revisions (id, model_id, version, hash, definition, created_by_type)
        values (${schemaRevisionIdOf(modelId)}, ${modelId}, 1, 'fixture', '{}', 'system')`.execute(db);
    });
  const ensureAdmin = (adminId: unknown) =>
    typeof adminId === 'string'
      ? once(`admin:${adminId}`, () =>
          sql`insert into admin_users (id, email, password_hash)
            values (${adminId}, ${`${adminId}@example.test`}, 'fixture')`.execute(db),
        )
      : Promise.resolve();

  const modelIdOf = async (entryId: unknown): Promise<string> => {
    const known = typeof entryId === 'string' ? modelOfEntry.get(entryId) : undefined;
    if (known) {
      return known;
    }
    const { rows } = await sql<{
      model_id: string;
    }>`select model_id from entries where id = ${entryId}`.execute(db);
    return rows[0]?.model_id ?? '';
  };

  const createdAtOf = async (entryId: unknown): Promise<unknown> => {
    if (typeof entryId === 'string' && createdAtOfEntry.has(entryId)) {
      return createdAtOfEntry.get(entryId);
    }
    const { rows } = await sql<{
      created_at: unknown;
    }>`select created_at from entries where id = ${entryId}`.execute(db);
    return rows[0]?.created_at ?? null;
  };

  return async ({ table, row }: RowInsert): Promise<Record<string, unknown>> => {
    const full: Record<string, unknown> = { ...row };
    if (typeof row.site_id === 'string') {
      await ensureSite(row.site_id);
    }
    if (typeof row.model_id === 'string') {
      await ensureModel(row.model_id);
    }
    if (table === 'entries') {
      await ensureAdmin(row.created_by_admin_id);
      if (typeof row.id === 'string' && typeof row.model_id === 'string') {
        modelOfEntry.set(row.id, row.model_id);
      }
      if (typeof row.id === 'string' && row.created_at !== undefined) {
        createdAtOfEntry.set(row.id, row.created_at);
      }
    }
    if (table === 'entry_heads' && !('entry_created_at' in row)) {
      // The writers copy the entry's creation time onto each head (the default list order).
      full.entry_created_at = await createdAtOf(row.entry_id);
    }
    if (table === 'content_revisions') {
      full.schema_revision_id ??= schemaRevisionIdOf(await modelIdOf(row.entry_id));
      full.locale ??= 'en';
      full.reason ??= 'create';
      full.author_type ??= 'system';
    }
    return full;
  };
};

// Through Kysely, so each dialect's plugin fills what the database leaves to it (MySQL: the change
// sequence, timestamps given as ISO text).
const insertInto = (db: Kysely<DB>, table: string, rows: Array<Record<string, unknown>>) =>
  db
    .insertInto(table as keyof DB)
    .values(rows)
    .execute();

const contentDatabase = (
  db: Kysely<DB>,
  dialect: ContentSqlDialect,
  close: () => Promise<void>,
): ContentTestDatabase => {
  const complete = rowCompleter(db);
  return {
    dialect,
    execute: async (statement) => {
      if (isRowInsert(statement)) {
        await insertInto(db, statement.table, [await complete(statement)]);
        return;
      }
      await statement.execute(db);
    },
    insertRows: async (table, rows) => {
      const full: Array<Record<string, unknown>> = [];
      for (const row of rows) {
        full.push(await complete({ table, row }));
      }
      await db.transaction().execute(async (trx) => {
        for (let start = 0; start < full.length; start += INSERT_CHUNK_SIZE) {
          await insertInto(trx, table, full.slice(start, start + INSERT_CHUNK_SIZE));
        }
      });
    },
    rows: async <T>(query: RawBuilder<T>) => (await query.execute(db)).rows,
    plan: async (query) => {
      const compiled = query.compile(db);
      if (dialect === mysqlContentDialect) {
        const result = await db.executeQuery<{ EXPLAIN: string }>(
          CompiledQuery.raw(`explain format=tree ${compiled.sql}`, [...compiled.parameters]),
        );
        return result.rows.flatMap((row) => String(row.EXPLAIN).split('\n'));
      }
      if (dialect !== sqliteContentDialect) {
        throw new Error('plans are checked on SQLite and MySQL only');
      }
      const result = await db.executeQuery<{ detail: string }>(
        CompiledQuery.raw(`explain query plan ${compiled.sql}`, [...compiled.parameters]),
      );
      return result.rows.map((row) => String(row.detail));
    },
    close,
  };
};

/** PostgreSQL: a database cloned from the migrated template (only on a PostgreSQL run). */
export const openPostgresContentDatabase = async (): Promise<ContentTestDatabase> => {
  const database = await createTestDatabase();
  return contentDatabase(database.db, postgresContentDialect, database.drop);
};

/** MySQL: a database cloned from the migrated template (only on a MySQL run). */
export const openMysqlContentDatabase = async (): Promise<ContentTestDatabase> => {
  const database = await createTestDatabase();
  return contentDatabase(database.db, mysqlContentDialect, database.drop);
};

/** SQLite: a temporary file migrated with the SQLite baseline (on every run). */
export const openSqliteContentDatabase = async (): Promise<ContentTestDatabase> => {
  const directory = mkdtempSync(join(tmpdir(), 'shapio-content-'));
  const db = createSqliteDb<DB>({
    location: { kind: 'file', path: join(directory, 'content.db') },
    readers: 2,
  });
  const { error } = await createMigrator(db).migrateToLatest();
  if (error) {
    throw error instanceof Error ? error : new Error('SQLite migration failed', { cause: error });
  }
  return contentDatabase(db, sqliteContentDialect, async () => {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  });
};

/**
 * The databases this run can open: the run's server database (PostgreSQL or MySQL) and SQLite, or SQLite
 * alone on a SQLite run.
 */
export const contentDatabasesOfRun = (): Array<[string, () => Promise<ContentTestDatabase>]> => {
  const sqlite: [string, () => Promise<ContentTestDatabase>] = ['SQLite', openSqliteContentDatabase];
  if (isSqliteRun()) {
    return [sqlite];
  }
  return isMysqlRun()
    ? [['MySQL', openMysqlContentDatabase], sqlite]
    : [['PostgreSQL', openPostgresContentDatabase], sqlite];
};
