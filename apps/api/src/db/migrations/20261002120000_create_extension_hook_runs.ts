import { sql, type Kysely } from 'kysely';

/**
 * Extension points (package K, ADR 0009): the ledger of post-commit lifecycle hooks (`afterCreate`,
 * `afterPublish`, ...) that have run. One row per (outbox event, hook name), written in the same transaction
 * as the hook's own database work, so a hook re-run after a worker crash finds its row and is skipped:
 * exactly once for everything the hook does through its transaction.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('extension_hook_runs')
    .addColumn('event_id', 'uuid', (col) => col.notNull())
    // `<model API key, model ID or *>.<event>`, as the hook is keyed in shapio.config.
    .addColumn('hook', 'text', (col) => col.notNull())
    .addColumn('job_id', 'uuid')
    .addColumn('completed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('extension_hook_runs_pkey', ['event_id', 'hook'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('extension_hook_runs').execute();
};
