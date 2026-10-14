import { sql, type Kysely } from 'kysely';

/**
 * MySQL twin of `../20261014120000_canceled_status.ts`: MySQL 8.4 drops a check constraint with
 * `drop check`, not `drop constraint`.
 */
const TABLES = [
  { table: 'schema_change_jobs', values: ['pending', 'running', 'activated', 'failed'] },
  { table: 'scheduled_publications', values: ['scheduled', 'done', 'failed'] },
] as const;

const swap = async (db: Kysely<unknown>, from: string, to: string): Promise<void> => {
  for (const { table, values } of TABLES) {
    const constraint = `${table}_status_check`;
    await sql`alter table ${sql.table(table)} drop check ${sql.id(constraint)}`.execute(db);
    await sql`update ${sql.table(table)} set status = ${to} where status = ${from}`.execute(db);
    const allowed = sql.join([...values, to].map((value) => sql.lit(value)));
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(constraint)} check (status in (${allowed}))`.execute(
      db,
    );
  }
};

export const up = (db: Kysely<unknown>): Promise<void> => swap(db, 'cancelled', 'canceled');

export const down = (db: Kysely<unknown>): Promise<void> => swap(db, 'canceled', 'cancelled');
