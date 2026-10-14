import { sql, type Kysely } from 'kysely';

/**
 * SQLite twin of `../20261014120000_canceled_status.ts`. SQLite cannot change a check constraint, so each
 * table is rebuilt from its own stored `create table` statement with the one value swapped: renamed aside
 * (with `legacy_alter_table` on, so references to the name keep pointing at it), recreated, refilled with the
 * status rewritten, and its indexes recreated from `sqlite_master`. Nothing references either table.
 */
const TABLES = ['schema_change_jobs', 'scheduled_publications'] as const;

const rebuild = async (db: Kysely<unknown>, table: string, from: string, to: string): Promise<void> => {
  const { rows: created } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'table' and name = ${table}
  `.execute(db);
  const { rows: indexes } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'index' and tbl_name = ${table} and sql is not null
  `.execute(db);
  const definition = created[0]?.sql;
  if (!definition || !definition.includes(`'${from}'`)) {
    throw new Error(`${table}: expected a status check allowing '${from}'`);
  }
  // A table rebuilt by an earlier migration's `down` can still name its temporary `<table>_before_<step>`
  // in this table's foreign keys (SQLite rewrites references on rename). Point them back at the real table,
  // or the copy below fails on the missing name.
  const repaired = definition.replace(
    /references\s+("?)(\w+?)_before_\w+\1/gi,
    (_, quote: string, base: string) => `references ${quote}${base}${quote}`,
  );
  const aside = `${table}_before_${to}`;
  await sql`pragma legacy_alter_table = on`.execute(db);
  await sql`alter table ${sql.table(table)} rename to ${sql.table(aside)}`.execute(db);
  await sql.raw(repaired.replace(`'${from}'`, `'${to}'`)).execute(db);
  // Copy every row, rewriting the status on the way: the new table's check no longer allows the old value.
  const { rows: columns } = await sql<{ name: string }>`
    select name from pragma_table_info(${aside}) order by cid
  `.execute(db);
  const names = columns.map(({ name }) => sql.id(name));
  const values = columns.map(({ name }) =>
    name === 'status' ? sql`case when status = ${from} then ${to} else status end` : sql.id(name),
  );
  await sql`insert into ${sql.table(table)} (${sql.join(names)}) select ${sql.join(values)} from ${sql.table(aside)}`.execute(
    db,
  );
  await sql`drop table ${sql.table(aside)}`.execute(db);
  await sql`pragma legacy_alter_table = off`.execute(db);
  for (const { sql: index } of indexes) {
    await sql.raw(index).execute(db);
  }
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    await rebuild(db, table, 'cancelled', 'canceled');
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    await rebuild(db, table, 'canceled', 'cancelled');
  }
};
