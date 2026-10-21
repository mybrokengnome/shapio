import { sql, type Kysely } from 'kysely';
import { assertNoInterfaces, TABLES } from '../20261021120000_interface_kind.js';

/**
 * SQLite twin of `../20261021120000_interface_kind.ts`. SQLite cannot change a check constraint, so each table
 * is rebuilt from its own stored `create table` statement with the kind list swapped: renamed aside (with
 * `legacy_alter_table` on, so the references other tables hold keep naming the real table), recreated,
 * refilled, and its indexes recreated from `sqlite_master`. Dropping the renamed table deletes nothing the
 * other tables reference.
 */
const BEFORE = `'singleton', 'component')`;
const AFTER = `'singleton', 'component', 'interface')`;

const rebuild = async (db: Kysely<unknown>, table: string, from: string, to: string): Promise<void> => {
  const { rows: created } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'table' and name = ${table}
  `.execute(db);
  const { rows: indexes } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'index' and tbl_name = ${table} and sql is not null
  `.execute(db);
  const definition = created[0]?.sql;
  if (!definition || !definition.includes(from)) {
    throw new Error(`${table}: expected a kind check ending ${from}`);
  }
  // An earlier migration's `down` can leave `<table>_before_<step>` in this table's own foreign keys (SQLite
  // rewrites references on rename). Point them back at the real table, or the copy fails on the missing name.
  const repaired = definition.replace(
    /references\s+("?)(\w+?)_before_\w+\1/gi,
    (_, quote: string, base: string) => `references ${quote}${base}${quote}`,
  );
  const aside = `${table}_before_interface_kind`;
  await sql`pragma legacy_alter_table = on`.execute(db);
  await sql`alter table ${sql.table(table)} rename to ${sql.table(aside)}`.execute(db);
  await sql.raw(repaired.replace(from, to)).execute(db);
  const { rows: columns } = await sql<{ name: string }>`
    select name from pragma_table_info(${aside}) order by cid
  `.execute(db);
  const names = sql.join(columns.map(({ name }) => sql.id(name)));
  await sql`insert into ${sql.table(table)} (${names}) select ${names} from ${sql.table(aside)}`.execute(db);
  await sql`drop table ${sql.table(aside)}`.execute(db);
  await sql`pragma legacy_alter_table = off`.execute(db);
  for (const { sql: index } of indexes) {
    await sql.raw(index).execute(db);
  }
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    await rebuild(db, table, BEFORE, AFTER);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await assertNoInterfaces(db);
  for (const table of TABLES) {
    await rebuild(db, table, AFTER, BEFORE);
  }
};
