import { sql } from 'kysely';
import type { Database } from './index.js';

/**
 * `entry_heads_entry_order_idx` (ADR 0001, "Delivery perf 2"): the default newest-first list order on the
 * heads. The `20261005120000_entry_heads_entry_created_at` migration builds it on an empty table, else the
 * `schema.entryOrderIndex` job builds it here, `CONCURRENTLY` (PostgreSQL only: SQLite and MySQL build it in
 * their migrations).
 */
export const ENTRY_ORDER_INDEX = 'entry_heads_entry_order_idx';

export const createEntryOrderIndexConcurrently = (db: Database): Promise<unknown> =>
  sql`create index concurrently if not exists ${sql.id(ENTRY_ORDER_INDEX)}
    on entry_heads (site_id, model_id, state, entry_created_at desc, entry_id)`.execute(db);

/** Drops an INVALID index left by an interrupted build, so the next build starts over. */
export const dropEntryOrderIndexConcurrently = (db: Database): Promise<unknown> =>
  sql`drop index concurrently if exists ${sql.id(ENTRY_ORDER_INDEX)}`.execute(db);
