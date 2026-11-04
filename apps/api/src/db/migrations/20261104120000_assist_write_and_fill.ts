import { sql, type Kysely } from 'kysely';

/**
 * Assist: write and fill (plan write-and-fill).
 * - `assist_runs.action` gains `write` and `suggest`.
 * - `assist_runs.change_set_id`: the change set a fill run's accepted values go into, opened by the first
 *   accept (under the run row's lock) and replaced when that set shipped or was discarded meanwhile. Null for
 *   every other run, and when the set is deleted.
 * MySQL and SQLite have their own twins; SQLite rebuilds the table.
 *
 * `down` deletes the `write` and `suggest` runs: they are usage records (the audit log keeps each request), and
 * the narrower check cannot hold them.
 */
export const ACTIONS_BEFORE = [
  'alt_text',
  'summarize',
  'translate',
  'rewrite',
  'schema_draft',
  'content_ops',
] as const;
export const ACTIONS_ADDED = ['write', 'suggest'] as const;

const actionCheck = (actions: readonly string[]) =>
  sql`action in (${sql.join(actions.map((action) => sql.lit(action)))})`;

const replaceActionCheck = async (db: Kysely<unknown>, actions: readonly string[]) => {
  await sql`alter table assist_runs drop constraint assist_runs_action_check`.execute(db);
  await sql`alter table assist_runs add constraint assist_runs_action_check check (${actionCheck(actions)}) not valid`.execute(
    db,
  );
  await sql`alter table assist_runs validate constraint assist_runs_action_check`.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await replaceActionCheck(db, [...ACTIONS_BEFORE, ...ACTIONS_ADDED]);
  await sql`
    alter table assist_runs add column change_set_id uuid
      constraint assist_runs_change_set_id_fkey references change_sets (id) on delete set null
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table assist_runs drop column change_set_id`.execute(db);
  await sql`delete from assist_runs where action in (${sql.join(ACTIONS_ADDED.map((action) => sql.lit(action)))})`.execute(
    db,
  );
  await replaceActionCheck(db, ACTIONS_BEFORE);
};
