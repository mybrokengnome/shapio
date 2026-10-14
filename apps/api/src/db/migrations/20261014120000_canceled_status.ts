import { sql, type Kysely } from 'kysely';

/**
 * The `cancelled` status of schema change jobs and scheduled publications becomes `canceled`. Rows are
 * rewritten and the check constraints swapped. MySQL has its own twin; SQLite rebuilds the two tables
 * (`./sqlite/20261014120000_canceled_status.ts`).
 */
const TABLES = [
  { table: 'schema_change_jobs', values: ['pending', 'running', 'activated', 'failed'] },
  { table: 'scheduled_publications', values: ['scheduled', 'done', 'failed'] },
] as const;

const swap = async (db: Kysely<unknown>, from: string, to: string): Promise<void> => {
  for (const { table, values } of TABLES) {
    const constraint = `${table}_status_check`;
    await sql`alter table ${sql.table(table)} drop constraint ${sql.id(constraint)}`.execute(db);
    await sql`update ${sql.table(table)} set status = ${to} where status = ${from}`.execute(db);
    const allowed = sql.join([...values, to].map((value) => sql.lit(value)));
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(constraint)} check (status in (${allowed}))`.execute(
      db,
    );
  }
};

export const up = (db: Kysely<unknown>): Promise<void> => swap(db, 'cancelled', 'canceled');

export const down = (db: Kysely<unknown>): Promise<void> => swap(db, 'canceled', 'cancelled');
