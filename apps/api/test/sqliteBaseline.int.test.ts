import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigrator } from '../src/db/migrator.js';
import { BIGINT_ROWID_COLUMNS } from '../src/db/sqlite/codec.js';
import { createSqliteDb } from '../src/db/sqlite/index.js';
import { NULLS_NOT_DISTINCT_INDEXES } from '../src/db/sqlite/nullsNotDistinct.js';
import type { DB } from '../src/db/types.js';
import { testDialect, withSkipReason } from './helpers/dialect.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

/**
 * Keeps the SQLite baseline honest (`db/migrations/sqlite/0001_baseline.ts`): migrates a PostgreSQL
 * database and a SQLite file, reads both catalogs into one logical model (tables, columns with their type,
 * nullability and whether they have a default, primary keys, foreign keys, unique and other indexes, check
 * constraints, triggers, seeded rows) and expects them equal, apart from the documented differences.
 */
type Column = { type: string; notNull: boolean; hasDefault: boolean };
type ForeignKey = { columns: string; references: string; onDelete: string };
type Index = { unique: boolean; partial: boolean; columns: string };
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
  'text[]': 'text[]',
  'uuid[]': 'uuid[]',
  boolean: 'boolean',
  bigint: 'bigint',
  integer: 'integer',
  smallint: 'integer',
  real: 'real',
  'double precision': 'real',
};

const SQLITE_TYPES: Readonly<Record<string, string>> = {
  text_uuid: 'uuid',
  text: 'text',
  text_timestamptz: 'timestamp',
  text_date: 'date',
  text_jsonb: 'json',
  text_json: 'json',
  text_array: 'text[]',
  text_uuid_array: 'uuid[]',
  integer_boolean: 'boolean',
  bigint: 'bigint',
  integer: 'integer',
  real: 'real',
  double: 'real',
};

const ON_DELETE: Readonly<Record<string, string>> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** Deliberate differences (each explained in the baseline's header). */
const POSTGRES_ONLY_INDEXES = ['entry_heads_data_gin'];
const SQLITE_ONLY_TABLES = ['sequences', 'sqlite_sequence'];
const SQLITE_ONLY_TRIGGERS = ['media_assets_folder_id_fkey_set_null'];
/** PostgreSQL's `ON DELETE SET NULL (folder_id)`; SQLite keeps NO ACTION and nulls the column by trigger. */
const COLUMN_LIST_SET_NULL = { table: 'media_assets', columns: 'folder_id,site_id' };

const skippedTable = (name: string) => name.startsWith('kysely_');

const readPostgres = async (db: Kysely<DB>): Promise<LogicalSchema> => {
  const columns = await sql<{
    tbl: string;
    col: string;
    typ: string;
    nn: boolean;
    def: boolean;
  }>`
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn,
      (a.atthasdef or a.attidentity <> '') as def
    from pg_attribute a join pg_class c on c.oid = a.attrelid
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  `.execute(db);
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
  const indexes = await sql<{ name: string; uniq: boolean; partial: boolean; cols: string; pk: boolean }>`
    select i.relname as name, x.indisunique as uniq, x.indpred is not null as partial, x.indisprimary as pk,
      (select string_agg(case when u.n = 0 then '(expr)' else a.attname end, ',' order by u.ord)
        from unnest(x.indkey) with ordinality u(n, ord)
        left join pg_attribute a on a.attrelid = x.indrelid and a.attnum = u.n) as cols
    from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
    where t.relnamespace = 'public'::regnamespace and t.relname not like 'kysely_%'
  `.execute(db);
  const triggers = await sql<{ name: string }>`
    select tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
  `.execute(db);

  const schema: LogicalSchema = {
    tables: {},
    primaryKeys: {},
    foreignKeys: {},
    indexes: {},
    checks: [],
    triggers: [],
  };
  for (const column of columns.rows.filter((row) => !skippedTable(row.tbl))) {
    (schema.tables[column.tbl] ??= {})[column.col] = {
      type: POSTGRES_TYPES[column.typ] ?? `unmapped ${column.typ}`,
      notNull: column.nn,
      hasDefault: column.def,
    };
  }
  for (const constraint of constraints.rows.filter((row) => !skippedTable(row.tbl))) {
    if (constraint.typ === 'p') {
      schema.primaryKeys[constraint.tbl] = constraint.cols;
    } else if (constraint.typ === 'f') {
      const isColumnListSetNull =
        constraint.tbl === COLUMN_LIST_SET_NULL.table && constraint.cols === COLUMN_LIST_SET_NULL.columns;
      (schema.foreignKeys[constraint.tbl] ??= []).push({
        columns: constraint.cols,
        references: constraint.ref ?? '',
        onDelete: isColumnListSetNull ? 'no action' : (ON_DELETE[constraint.del] ?? constraint.del),
      });
    } else if (constraint.typ === 'c') {
      schema.checks.push(constraint.name);
    }
  }
  for (const index of indexes.rows) {
    if (index.pk || POSTGRES_ONLY_INDEXES.includes(index.name)) {
      continue;
    }
    const nullsNotDistinct = NULLS_NOT_DISTINCT_INDEXES.find((entry) => entry.name === index.name);
    const columnList = nullsNotDistinct
      ? nullsNotDistinct.columns
          .map((name) => (nullsNotDistinct.nullable.includes(name) ? '(expr)' : name))
          .join(',')
      : index.cols;
    schema.indexes[index.name] = { unique: index.uniq, partial: index.partial, columns: columnList };
  }
  schema.triggers = triggers.rows.map((row) => row.name);
  return schema;
};

const readSqlite = async (db: Kysely<DB>): Promise<LogicalSchema> => {
  const tables = await sql<{ name: string; sql: string }>`
    select name, sql from sqlite_schema where type = 'table'`.execute(db);
  const schema: LogicalSchema = {
    tables: {},
    primaryKeys: {},
    foreignKeys: {},
    indexes: {},
    checks: [],
    triggers: [],
  };
  for (const table of tables.rows) {
    if (skippedTable(table.name) || SQLITE_ONLY_TABLES.includes(table.name)) {
      continue;
    }
    const columns = await sql<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>`
      select name, type, "notnull", dflt_value, pk from pragma_table_info(${table.name})`.execute(db);
    const rowid = /"(\w+)" integer primary key autoincrement/i.exec(table.sql)?.[1];
    const keyColumns: string[] = [];
    for (const column of columns.rows) {
      const isRowid = column.name === rowid;
      const declared = SQLITE_TYPES[column.type.toLowerCase()] ?? `unmapped ${column.type}`;
      (schema.tables[table.name] ??= {})[column.name] = {
        type: isRowid && BIGINT_ROWID_COLUMNS.has(`${table.name}.${column.name}`) ? 'bigint' : declared,
        notNull: column.notnull === 1 || isRowid,
        hasDefault: column.dflt_value !== null || isRowid,
      };
      if (column.pk > 0) {
        keyColumns[column.pk - 1] = column.name;
      }
    }
    if (keyColumns.length > 0) {
      schema.primaryKeys[table.name] = keyColumns.join(',');
    }
    const foreignKeys = await sql<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>`
      select id, seq, "table", "from", "to", on_delete from pragma_foreign_key_list(${table.name}) order by id, seq`.execute(
      db,
    );
    const grouped = new Map<number, typeof foreignKeys.rows>();
    for (const row of foreignKeys.rows) {
      grouped.set(row.id, [...(grouped.get(row.id) ?? []), row]);
    }
    for (const parts of grouped.values()) {
      const first = parts[0]!;
      (schema.foreignKeys[table.name] ??= []).push({
        columns: parts.map((part) => part.from).join(','),
        references: `${first.table}(${parts.map((part) => part.to).join(',')})`,
        onDelete: first.on_delete.toLowerCase(),
      });
    }
    schema.checks.push(...[...table.sql.matchAll(/constraint "(\w+)" check/gi)].map((match) => match[1]!));
    const indexes = await sql<{ name: string; unique: number; origin: string; partial: number }>`
      select name, "unique", origin, partial from pragma_index_list(${table.name})`.execute(db);
    for (const index of indexes.rows) {
      if (index.origin === 'pk') {
        continue;
      }
      const columnsOf = await sql<{ name: string | null }>`
        select name from pragma_index_info(${index.name}) order by seqno`.execute(db);
      schema.indexes[index.name] = {
        unique: index.unique === 1,
        partial: index.partial === 1,
        columns: columnsOf.rows.map((row) => row.name ?? '(expr)').join(','),
      };
    }
  }
  const triggers = await sql<{ name: string }>`select name from sqlite_schema where type = 'trigger'`.execute(
    db,
  );
  schema.triggers = triggers.rows
    .map((row) => row.name)
    .filter((name) => !SQLITE_ONLY_TRIGGERS.includes(name));
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

// Needs a PostgreSQL server; SQLite and MySQL runs have none.
const skipReason =
  testDialect() === 'postgres' ? undefined : 'compares against a migrated PostgreSQL database';

describe.skipIf(skipReason)(
  withSkipReason('SQLite baseline matches the PostgreSQL migrations', skipReason),
  () => {
    let postgres: TestDatabase;
    let directory: string;
    let sqlite: Kysely<DB>;

    beforeAll(async () => {
      postgres = await createTestDatabase();
      directory = mkdtempSync(join(tmpdir(), 'shapio-baseline-'));
      sqlite = createSqliteDb<DB>({
        location: { kind: 'file', path: join(directory, 'baseline.db') },
        readers: 1,
      });
      const { error } = await createMigrator(sqlite).migrateToLatest();
      expect(error).toBeUndefined();
    });
    afterAll(async () => {
      await sqlite?.destroy();
      rmSync(directory, { recursive: true, force: true });
      await postgres?.drop();
    });

    it('has the same tables, columns, keys, indexes, checks and triggers', async () => {
      const expected = sortedSchema(await readPostgres(postgres.db));
      const actual = sortedSchema(await readSqlite(sqlite));
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
      const tables = Object.keys((await readPostgres(postgres.db)).tables);
      expect(await seededRows(sqlite, tables)).toEqual(await seededRows(postgres.db, tables));
    });

    it('rolls back and forward again', async () => {
      const migrator = createMigrator(sqlite);
      expect((await migrator.migrateTo(NO_MIGRATIONS)).error).toBeUndefined();
      const { rows } = await sql<{ name: string }>`
      select name from sqlite_schema where type = 'table' and name not like 'kysely_%' and name <> 'sqlite_sequence'`.execute(
        sqlite,
      );
      expect(rows).toEqual([]);
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
    });
  },
);
