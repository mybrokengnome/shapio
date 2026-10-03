import { sql, type Kysely } from 'kysely';
import { isMysql, isSqlite } from './dialect.js';
import { fieldIndexColumnName } from './mysql/fieldIndexColumns.js';
import type { DB } from './types.js';

/**
 * Catalog lookups for index builds. Kept in db/ so no other module writes catalog SQL. PostgreSQL reads
 * `pg_catalog`; SQLite reads `sqlite_schema`, where an index is either there or not (no invalid state).
 * MySQL reads `information_schema`; a field index there is built on a virtual column added first, so a
 * column without its index is what an interrupted build leaves ('invalid').
 */

export type IndexState = 'missing' | 'valid' | 'invalid';

/** Whether a relation exists in the current schema (e.g. content tables before package E's migration). */
export const tableExists = async (db: Kysely<DB>, table: string): Promise<boolean> => {
  if (isMysql()) {
    const { rows } = await sql<{ name: string }>`
      select table_name as name from information_schema.tables
      where table_schema = database() and table_name = ${table}`.execute(db);
    return rows.length > 0;
  }
  if (isSqlite()) {
    const { rows } = await sql<{ name: string }>`
      select name from sqlite_schema where type = 'table' and name = ${table}`.execute(db);
    return rows.length > 0;
  }
  const { rows } = await sql<{ exists: boolean }>`select to_regclass(${table}) is not null as exists`.execute(
    db,
  );
  return rows[0]?.exists ?? false;
};

/**
 * An index left INVALID by a failed or interrupted `CREATE INDEX CONCURRENTLY` still exists and must be
 * dropped before the build is retried (`IF NOT EXISTS` would otherwise keep the broken one).
 */
export const getIndexState = async (db: Kysely<DB>, indexName: string): Promise<IndexState> => {
  if (isMysql()) {
    return mysqlIndexState(db, indexName);
  }
  if (isSqlite()) {
    const { rows } = await sql<{ name: string }>`
      select name from sqlite_schema where type = 'index' and name = ${indexName}`.execute(db);
    return rows.length > 0 ? 'valid' : 'missing';
  }
  const { rows } = await sql<{ valid: boolean }>`
    select i.indisvalid as valid
    from pg_catalog.pg_class c
    join pg_catalog.pg_index i on i.indexrelid = c.oid
    where c.relname = ${indexName} and pg_catalog.pg_table_is_visible(c.oid)
  `.execute(db);
  const row = rows[0];
  if (!row) {
    return 'missing';
  }
  return row.valid ? 'valid' : 'invalid';
};

const mysqlIndexState = async (db: Kysely<DB>, indexName: string): Promise<IndexState> => {
  const { rows } = await sql<{ indexes: string | number; columns: string | number }>`
    select
      (select count(*) from information_schema.statistics
        where table_schema = database() and index_name = ${indexName}) as indexes,
      (select count(*) from information_schema.columns
        where table_schema = database() and column_name = ${fieldIndexColumnName(indexName)}) as columns`.execute(
    db,
  );
  const row = rows[0];
  if (row && Number(row.indexes) > 0) {
    return 'valid';
  }
  return row && Number(row.columns) > 0 ? 'invalid' : 'missing';
};
