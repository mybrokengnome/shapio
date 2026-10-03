import type { Kysely } from 'kysely';

/**
 * `audit_events.seq`: a monotonic tiebreaker after `occurred_at`, so events written in the same instant (one
 * transaction shares `now()`; SQLite and MySQL store milliseconds) list in the order they were written. The
 * UUID `id` is random and cannot order them. Adding an identity column rewrites the table once; existing rows
 * are numbered in the order the rewrite reads them. No index: the audit queries filter and sort by
 * `occurred_at` first, and `seq` only breaks ties.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable('audit_events')
    .addColumn('seq', 'bigint', (col) => col.notNull().generatedAlwaysAsIdentity())
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('audit_events').dropColumn('seq').execute();
};
