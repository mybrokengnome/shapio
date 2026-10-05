import { sql, type Kysely } from 'kysely';

/**
 * Delivery perf 2 (ADR 0001 amendment): the entry's `created_at` on each head (`entry_created_at`), so a list
 * in the default newest-first order walks `entry_heads_entry_order_idx` and stops at the page instead of
 * joining every matching head to `entries` and sorting them. `entries.created_at` never changes, and every head
 * insert copies it (repositories `entryHeads.insert`, `transferImport.insertHead`).
 *
 * The column is added nullable (a catalog-only change) and backfilled here in batches. The index is built
 * here on an empty table (a new install). With heads present it is built `CONCURRENTLY`, which cannot run
 * in a migration's transaction, by the `schema.entryOrderIndex` job this migration enqueues
 * (schema/planner/indexes.ts), so writes continue while it builds; queries are correct without it.
 */
const INDEX = 'entry_heads_entry_order_idx';
const JOB_TYPE = 'schema.entryOrderIndex';
const IDEMPOTENCY_KEY = 'schema.entryOrderIndex:v1';
const BATCH = 5000;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table entry_heads add column entry_created_at timestamptz`.execute(db);
  for (;;) {
    const result = await sql`
      update entry_heads h set entry_created_at = e.created_at
      from entries e
      where e.id = h.entry_id and (h.entry_id, h.locale, h.state) in (
        select entry_id, locale, state from entry_heads where entry_created_at is null limit ${BATCH}
      )
    `.execute(db);
    if (Number(result.numAffectedRows ?? 0n) < BATCH) {
      break;
    }
  }
  const { rows } = await sql<{
    present: boolean;
  }>`select exists (select 1 from entry_heads) as present`.execute(db);
  if (rows[0]?.present) {
    await sql`
      insert into jobs (type, payload, max_attempts, idempotency_key)
      values (${JOB_TYPE}, '{}'::jsonb, 5, ${IDEMPOTENCY_KEY})
      on conflict do nothing
    `.execute(db);
    return;
  }
  await sql`
    create index ${sql.id(INDEX)} on entry_heads (site_id, model_id, state, entry_created_at desc, entry_id)
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from jobs where idempotency_key = ${IDEMPOTENCY_KEY} and status = 'pending'`.execute(db);
  await sql`drop index if exists ${sql.id(INDEX)}`.execute(db);
  await sql`alter table entry_heads drop column entry_created_at`.execute(db);
};
