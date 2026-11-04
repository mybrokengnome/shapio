import { sql, type Kysely } from 'kysely';

/**
 * Rebuilds a SQLite table whose `create table` statement must change in a way `alter table` cannot express
 * (a check constraint, a column with a foreign key): the stored statement is rewritten, the table renamed
 * aside (with `legacy_alter_table` on, so references to the name keep pointing at it), recreated from the
 * rewritten statement, refilled with the columns both versions have, and its indexes recreated from
 * `sqlite_master`. `rewrite` must throw when the statement is not what the migration expects. The migrator
 * runs SQLite migrations with foreign keys off and checks every reference afterwards.
 */
export const rebuildWithCheck = async (
  db: Kysely<unknown>,
  input: { table: string; step: string; rewrite: (definition: string) => string },
): Promise<void> => {
  const { table, step, rewrite } = input;
  const { rows: created } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'table' and name = ${table}
  `.execute(db);
  const { rows: indexes } = await sql<{ sql: string }>`
    select sql from sqlite_master where type = 'index' and tbl_name = ${table} and sql is not null
  `.execute(db);
  const definition = created[0]?.sql;
  if (!definition) {
    throw new Error(`${table}: the table does not exist`);
  }
  // An earlier migration's `down` can leave `<table>_before_<step>` in this table's own foreign keys (SQLite
  // rewrites references on rename). Point them back at the real table, or the copy fails on the missing name.
  const repaired = rewrite(definition).replace(
    /references\s+("?)(\w+?)_before_\w+\1/gi,
    (_, quote: string, base: string) => `references ${quote}${base}${quote}`,
  );
  const aside = `${table}_before_${step}`;
  await sql`pragma legacy_alter_table = on`.execute(db);
  await sql`alter table ${sql.table(table)} rename to ${sql.table(aside)}`.execute(db);
  await sql.raw(repaired).execute(db);
  const columnsOf = async (name: string) =>
    (
      await sql<{ name: string }>`select name from pragma_table_info(${name}) order by cid`.execute(db)
    ).rows.map((row) => row.name);
  const kept = new Set(await columnsOf(table));
  const names = sql.join(
    (await columnsOf(aside)).filter((name) => kept.has(name)).map((name) => sql.id(name)),
  );
  await sql`insert into ${sql.table(table)} (${names}) select ${names} from ${sql.table(aside)}`.execute(db);
  await sql`drop table ${sql.table(aside)}`.execute(db);
  await sql`pragma legacy_alter_table = off`.execute(db);
  for (const { sql: index } of indexes) {
    await sql.raw(index).execute(db);
  }
};
