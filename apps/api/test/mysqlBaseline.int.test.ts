import { Kysely, PostgresDialect, sql } from 'kysely';
import { NO_MIGRATIONS } from 'kysely/migration';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigrator } from '../src/db/migrator.js';
import { MYSQL_TABLES } from '../src/db/mysql/tables.js';
import type { DB } from '../src/db/types.js';
import { isMysqlRun, withSkipReason } from './helpers/dialect.js';
import { withDatabaseName } from './helpers/env.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

/**
 * Keeps the MySQL baseline honest (`db/migrations/mysql/0001_baseline.ts`): on a MySQL run, migrates a
 * PostgreSQL database (TEST_POSTGRES_URL, a maintenance database beside which one is created) and the MySQL
 * test database, reads both catalogs into one logical model and expects them equal apart from the
 * documented differences. It also checks `db/mysql/tables.ts` against the migrated MySQL schema.
 */
type Column = { type: string; notNull: boolean; hasDefault: boolean };
type ForeignKey = { columns: string; references: string; onDelete: string };
type Index = { unique: boolean; columns: string };
type LogicalSchema = {
  tables: Record<string, Record<string, Column>>;
  primaryKeys: Record<string, string>;
  foreignKeys: Record<string, ForeignKey[]>;
  indexes: Record<string, Index>;
  checks: string[];
  triggers: string[];
};

const POSTGRES_TYPES: Readonly<Record<string, string>> = {
  uuid: 'uuid',
  text: 'text',
  'character varying(255)': 'text',
  'timestamp with time zone': 'timestamp',
  date: 'date',
  jsonb: 'json',
  json: 'json',
  'text[]': 'json',
  'uuid[]': 'json',
  boolean: 'boolean',
  bigint: 'bigint',
  integer: 'integer',
  smallint: 'integer',
  real: 'real',
  'double precision': 'real',
};

const mysqlType = (columnType: string, charset: string | null): string => {
  if (columnType === 'char(36)' && charset === 'ascii') {
    return 'uuid';
  }
  if (/^(varchar|longtext|text)/.test(columnType)) {
    return 'text';
  }
  const types: Record<string, string> = {
    'datetime(6)': 'timestamp',
    date: 'date',
    json: 'json',
    'tinyint(1)': 'boolean',
    bigint: 'bigint',
    int: 'integer',
    float: 'real',
    double: 'real',
  };
  return types[columnType] ?? `unmapped ${columnType}`;
};

/** Deliberate differences (each explained in the baseline's header). */
const POSTGRES_ONLY_INDEXES = ['entry_heads_data_gin'];
/** InnoDB indexes an AUTO_INCREMENT column; PostgreSQL's identity tiebreaker needs none. */
const MYSQL_ONLY_INDEXES = ['audit_events_seq_key'];
const MYSQL_ONLY_TABLES = ['advisory_locks', 'notifications', 'sequence_entry_heads_change_seq'];
const MYSQL_ONLY_TRIGGERS = ['media_assets_folder_id_fkey_set_null'];
/** PostgreSQL's `ON DELETE SET NULL (folder_id)`; MySQL keeps NO ACTION and nulls the column by trigger. */
const COLUMN_LIST_SET_NULL = { table: 'media_assets', columns: 'folder_id,site_id' };
/** Defaults MySQL cannot declare; the MySQL plugin fills the column instead. */
const FILLED_BY_PLUGIN = new Set(['entry_heads.change_seq']);

const skippedTable = (name: string) => name.startsWith('kysely_');

const ON_DELETE: Readonly<Record<string, string>> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

const emptySchema = (): LogicalSchema => ({
  tables: {},
  primaryKeys: {},
  foreignKeys: {},
  indexes: {},
  checks: [],
  triggers: [],
});

const readPostgres = async (db: Kysely<DB>): Promise<LogicalSchema> => {
  const schema = emptySchema();
  const columns = await sql<{ tbl: string; col: string; typ: string; nn: boolean; def: boolean }>`
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
      (a.atthasdef or a.attidentity <> '') as def
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  `.execute(db);
  for (const column of columns.rows.filter((row) => !skippedTable(row.tbl))) {
    (schema.tables[column.tbl] ??= {})[column.col] = {
      type: POSTGRES_TYPES[column.typ] ?? `unmapped ${column.typ}`,
      notNull: column.nn,
      hasDefault: column.def && !FILLED_BY_PLUGIN.has(`${column.tbl}.${column.col}`),
    };
  }
  const constraints = await sql<{
    tbl: string;
    name: string;
    typ: string;
    cols: string;
    ref: string | null;
    del: string;
  }>`
    select c.relname as tbl, k.conname as name, k.contype as typ,
      (select string_agg(a.attname, ',' order by u.ord) from unnest(k.conkey) with ordinality u(n, ord)
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n) as cols,
      case when k.contype = 'f' then k.confrelid::regclass::text || '(' ||
        (select string_agg(a.attname, ',' order by u.ord) from unnest(k.confkey) with ordinality u(n, ord)
          join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n) || ')' end as ref,
      k.confdeltype as del
    from pg_constraint k join pg_class c on c.oid = k.conrelid
    where k.connamespace = 'public'::regnamespace
  `.execute(db);
  for (const constraint of constraints.rows.filter((row) => !skippedTable(row.tbl))) {
    if (constraint.typ === 'p') {
      schema.primaryKeys[constraint.tbl] = constraint.cols;
    } else if (constraint.typ === 'f') {
      const columnListSetNull =
        constraint.tbl === COLUMN_LIST_SET_NULL.table && constraint.cols === COLUMN_LIST_SET_NULL.columns;
      (schema.foreignKeys[constraint.tbl] ??= []).push({
        columns: constraint.cols,
        references: constraint.ref ?? '',
        onDelete: columnListSetNull ? 'no action' : (ON_DELETE[constraint.del] ?? constraint.del),
      });
    } else if (constraint.typ === 'c') {
      schema.checks.push(constraint.name);
    }
  }
  const indexes = await sql<{
    name: string;
    uniq: boolean;
    partial: boolean;
    pred: string | null;
    nnd: boolean;
    cols: string;
    pk: boolean;
  }>`
    select i.relname as name, x.indisunique as uniq, x.indpred is not null as partial, x.indisprimary as pk,
      pg_get_expr(x.indpred, x.indrelid) as pred, x.indnullsnotdistinct as nnd,
      (select string_agg(case when u.n = 0 then '(expr)' else a.attname end, ',' order by u.ord)
        from unnest(x.indkey) with ordinality u(n, ord)
        left join pg_attribute a on a.attrelid = x.indrelid and a.attnum = u.n) as cols
    from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
    where t.relnamespace = 'public'::regnamespace and t.relname not like 'kysely_%'
  `.execute(db);
  for (const index of indexes.rows) {
    if (index.pk || POSTGRES_ONLY_INDEXES.includes(index.name)) {
      continue;
    }
    // Partial unique indexes become CASE key parts on MySQL and NULLS NOT DISTINCT ones `coalesce` key parts:
    // only plain column lists compare. A unique index partial on `col IS NOT NULL` is plain on MySQL (a NULL
    // key never conflicts there).
    const caseKeys = index.uniq && index.partial && !/IS NOT NULL\)?$/.test(index.pred ?? '');
    const plain = !caseKeys && !index.nnd && !index.cols.includes('(expr)');
    schema.indexes[index.name] = { unique: index.uniq, columns: plain ? index.cols : '(expr)' };
  }
  const triggers = await sql<{ name: string }>`
    select tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  `.execute(db);
  schema.triggers = triggers.rows.map((row) => row.name);
  return schema;
};

const readMysql = async (db: Kysely<DB>): Promise<LogicalSchema> => {
  const schema = emptySchema();
  const skipped = (table: string) => skippedTable(table) || MYSQL_ONLY_TABLES.includes(table);
  const columns = await sql<{
    tbl: string;
    col: string;
    typ: string;
    charset: string | null;
    nullable: string;
    def: string | null;
    extra: string;
  }>`
    select table_name as tbl, column_name as col, column_type as typ, character_set_name as charset,
      is_nullable as nullable, column_default as def, extra as extra
    from information_schema.columns where table_schema = database()
  `.execute(db);
  for (const column of columns.rows.filter((row) => !skipped(row.tbl))) {
    (schema.tables[column.tbl] ??= {})[column.col] = {
      type: mysqlType(column.typ, column.charset),
      notNull: column.nullable === 'NO',
      hasDefault: column.def !== null || column.extra.includes('auto_increment'),
    };
  }
  const keys = await sql<{ tbl: string; name: string; cols: string; ref: string | null; del: string | null }>`
    select k.table_name as tbl, k.constraint_name as name,
      group_concat(k.column_name order by k.ordinal_position separator ',') as cols,
      concat(max(k.referenced_table_name), '(',
        group_concat(k.referenced_column_name order by k.ordinal_position separator ','), ')') as ref,
      max(r.delete_rule) as del
    from information_schema.key_column_usage k
    left join information_schema.referential_constraints r
      on r.constraint_schema = k.constraint_schema and r.constraint_name = k.constraint_name
    where k.table_schema = database()
    group by k.table_name, k.constraint_name
  `.execute(db);
  const foreignKeyNames = new Set<string>();
  for (const key of keys.rows.filter((row) => !skipped(row.tbl))) {
    if (key.name === 'PRIMARY') {
      schema.primaryKeys[key.tbl] = key.cols;
    } else if (key.del !== null) {
      foreignKeyNames.add(key.name);
      (schema.foreignKeys[key.tbl] ??= []).push({
        columns: key.cols,
        references: key.ref ?? '',
        onDelete: key.del.toLowerCase(),
      });
    }
  }
  const checks = await sql<{ name: string }>`
    select constraint_name as name from information_schema.table_constraints
    where table_schema = database() and constraint_type = 'CHECK'`.execute(db);
  schema.checks = checks.rows.map((row) => row.name);
  const indexes = await sql<{ tbl: string; name: string; uniq: string | number; cols: string }>`
    select table_name as tbl, index_name as name, min(non_unique) = 0 as uniq,
      group_concat(coalesce(column_name, '(expr)') order by seq_in_index separator ',') as cols
    from information_schema.statistics where table_schema = database() and index_name <> 'PRIMARY'
    group by table_name, index_name`.execute(db);
  for (const index of indexes.rows.filter((row) => !skipped(row.tbl))) {
    // MySQL indexes every foreign key no other index covers, under the key's name; MySQL-only indexes are
    // documented above.
    if (foreignKeyNames.has(index.name) || MYSQL_ONLY_INDEXES.includes(index.name)) {
      continue;
    }
    schema.indexes[index.name] = {
      unique: Number(index.uniq) === 1,
      columns: index.cols.includes('(expr)') ? '(expr)' : index.cols,
    };
  }
  const triggers = await sql<{ name: string }>`
    select trigger_name as name from information_schema.triggers where trigger_schema = database()`.execute(
    db,
  );
  schema.triggers = triggers.rows
    .map((row) => row.name)
    .filter((name) => !MYSQL_ONLY_TRIGGERS.includes(name));
  return schema;
};

/** Every row of every seeded table, without the times they were written (they differ by run). */
const seededRows = async (db: Kysely<DB>, tables: readonly string[]) => {
  const rows: Record<string, unknown[]> = {};
  for (const table of tables) {
    const found = await db
      .selectFrom(table as keyof DB)
      .selectAll()
      .execute();
    if (found.length > 0) {
      rows[table] = found
        .map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => !(value instanceof Date))))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
  }
  return rows;
};

const sortedSchema = (schema: LogicalSchema) => ({
  ...schema,
  foreignKeys: Object.fromEntries(
    Object.entries(schema.foreignKeys).map(([table, keys]) => [
      table,
      [...keys].sort(
        (a, b) => a.columns.localeCompare(b.columns) || a.references.localeCompare(b.references),
      ),
    ]),
  ),
  checks: [...schema.checks].sort(),
  triggers: [...schema.triggers].sort(),
});

const postgresUrl = process.env.TEST_POSTGRES_URL;
const skipReason = !isMysqlRun()
  ? 'compares a migrated MySQL database with PostgreSQL (MySQL runs only)'
  : postgresUrl
    ? undefined
    : 'set TEST_POSTGRES_URL to a PostgreSQL maintenance database to compare against';

describe.skipIf(skipReason)(
  withSkipReason('MySQL baseline matches the PostgreSQL migrations', skipReason),
  () => {
    const postgresName = `shapio_mysql_cmp_${process.pid}`;
    let postgres: Kysely<DB>;
    let mysql: TestDatabase;

    const runPostgresAdmin = async (statement: string) => {
      const client = new pg.Client({ connectionString: postgresUrl });
      await client.connect();
      try {
        await client.query(statement);
      } finally {
        await client.end();
      }
    };

    beforeAll(async () => {
      mysql = await createTestDatabase();
      await runPostgresAdmin(`drop database if exists ${postgresName}`);
      await runPostgresAdmin(`create database ${postgresName}`);
      // A PostgreSQL handle in a MySQL process: plain Kysely, without switching the process dialect. The
      // PostgreSQL migrations use no dialect-dependent primitives; nothing else migrates this database.
      postgres = new Kysely<DB>({
        dialect: new PostgresDialect({
          pool: new pg.Pool({ connectionString: withDatabaseName(postgresUrl!, postgresName), max: 2 }),
        }),
      });
      expect((await createMigrator(postgres).migrateToLatest()).error).toBeUndefined();
    });
    afterAll(async () => {
      await postgres?.destroy();
      await runPostgresAdmin(`drop database if exists ${postgresName} with (force)`);
      await mysql?.drop();
    });

    it('has the same tables, columns, keys, indexes, checks and triggers', async () => {
      const expected = sortedSchema(await readPostgres(postgres));
      const actual = sortedSchema(await readMysql(mysql.db));
      expect(Object.keys(actual.tables).sort()).toEqual(Object.keys(expected.tables).sort());
      for (const table of Object.keys(expected.tables)) {
        expect(actual.tables[table], table).toEqual(expected.tables[table]);
      }
      expect(actual.primaryKeys).toEqual(expected.primaryKeys);
      expect(actual.foreignKeys).toEqual(expected.foreignKeys);
      expect(actual.indexes).toEqual(expected.indexes);
      expect(actual.checks).toEqual(expected.checks);
      expect(actual.triggers).toEqual(expected.triggers);
    });

    it('seeds the same rows', async () => {
      const tables = Object.keys((await readPostgres(postgres)).tables);
      expect(await seededRows(mysql.db, tables)).toEqual(await seededRows(postgres, tables));
    });

    it("describes every table's columns and keys in db/mysql/tables.ts", async () => {
      const { rows } = await sql<{ tbl: string; col: string; nullable: string }>`
      select table_name as tbl, column_name as col, is_nullable as nullable from information_schema.columns
      where table_schema = database() and table_name not like 'kysely%' order by ordinal_position`.execute(
        mysql.db,
      );
      const tables: Record<string, { columns: string[]; nullable: string[] }> = {};
      for (const row of rows) {
        const table = (tables[row.tbl] ??= { columns: [], nullable: [] });
        table.columns.push(row.col);
        if (row.nullable === 'YES') {
          table.nullable.push(row.col);
        }
      }
      expect(Object.keys(MYSQL_TABLES).sort()).toEqual(Object.keys(tables).sort());
      for (const [name, table] of Object.entries(tables)) {
        expect([...MYSQL_TABLES[name]!.columns].sort(), name).toEqual([...table.columns].sort());
        expect([...MYSQL_TABLES[name]!.nullable].sort(), name).toEqual([...table.nullable].sort());
      }
    });

    it('rolls back and forward again', async () => {
      const migrator = createMigrator(mysql.db);
      expect((await migrator.migrateTo(NO_MIGRATIONS)).error).toBeUndefined();
      const { rows } = await sql<{ name: string }>`
      select table_name as name from information_schema.tables
      where table_schema = database() and table_name not like 'kysely%'`.execute(mysql.db);
      expect(rows).toEqual([]);
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
    });
  },
);
