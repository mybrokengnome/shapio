import { sql, type Kysely } from 'kysely';

/**
 * SQLite twin of `../20261005120000_entry_heads_entry_created_at.ts`. One process holds the write lock, so
 * the backfill is one statement and the index is built here (a plain `CREATE INDEX`; writers wait for it, the
 * documented single-process limitation of ADR 0001, "D2: as built").
 */
const INDEX = 'entry_heads_entry_order_idx';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "entry_heads" add column "entry_created_at" text_timestamptz`.execute(db);
  await sql`update "entry_heads" set entry_created_at = (
    select e.created_at from "entries" e where e.id = "entry_heads".entry_id
  ) where entry_created_at is null`.execute(db);
  await sql`create index ${sql.id(INDEX)} on "entry_heads" (site_id, model_id, state, entry_created_at desc, entry_id)`.execute(
    db,
  );
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists ${sql.id(INDEX)}`.execute(db);
  await sql`alter table "entry_heads" drop column "entry_created_at"`.execute(db);
};
