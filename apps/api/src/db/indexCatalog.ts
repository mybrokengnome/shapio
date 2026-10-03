import { sql, type Kysely } from 'kysely';
import { isSqlite } from './dialect.js';
import type { DB } from './types.js';

/**
 * Catalog lookups for index builds. Kept in db/ so no other module writes catalog SQL. PostgreSQL reads
 * `pg_catalog`; SQLite reads `sqlite_schema`, where an index is either there or not (no invalid state).
 */

export type IndexState = 'missing' | 'valid' | 'invalid';

/** Whether a relation exists in the current schema (e.g. content tables before package E's migration). */
export const tableExists = async (db: Kysely<DB>, table: string): Promise<boolean> => {
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
