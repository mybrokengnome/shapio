import { sql, type Kysely } from 'kysely';
import { assertNoInterfaces, KINDS_AFTER, KINDS_BEFORE, TABLES } from '../20261021120000_interface_kind.js';

/**
 * MySQL twin of `../20261021120000_interface_kind.ts`: MySQL 8.4 drops a check constraint with `drop check`,
 * not `drop constraint`.
 */
const swap = async (db: Kysely<unknown>, kinds: readonly string[]): Promise<void> => {
  const allowed = sql.join(kinds.map((kind) => sql.lit(kind)));
  for (const table of TABLES) {
    const constraint = `${table}_kind_check`;
    await sql`alter table ${sql.table(table)} drop check ${sql.id(constraint)}`.execute(db);
    await sql`alter table ${sql.table(table)} add constraint ${sql.id(constraint)} check (kind in (${allowed}))`.execute(
      db,
    );
  }
};

export const up = (db: Kysely<unknown>): Promise<void> => swap(db, KINDS_AFTER);

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await assertNoInterfaces(db);
  await swap(db, KINDS_BEFORE);
};
