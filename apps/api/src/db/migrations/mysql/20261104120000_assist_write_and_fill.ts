import { sql, type Kysely } from 'kysely';
import { ACTIONS_ADDED, ACTIONS_BEFORE } from '../20261104120000_assist_write_and_fill.js';

/**
 * MySQL twin of `../20261104120000_assist_write_and_fill.ts`: MySQL 8.4 drops a check constraint with
 * `drop check`, not `drop constraint`.
 */
const replaceActionCheck = async (db: Kysely<unknown>, actions: readonly string[]) => {
  const allowed = sql.join(actions.map((action) => sql.lit(action)));
  await sql`alter table \`assist_runs\` drop check \`assist_runs_action_check\``.execute(db);
  await sql`alter table \`assist_runs\` add constraint \`assist_runs_action_check\` check ((\`action\` in (${allowed})))`.execute(
    db,
  );
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await replaceActionCheck(db, [...ACTIONS_BEFORE, ...ACTIONS_ADDED]);
  await sql`
    alter table \`assist_runs\`
      add column \`change_set_id\` char(36) character set ascii collate ascii_general_ci,
      add constraint \`assist_runs_change_set_id_fkey\` foreign key (\`change_set_id\`)
        references \`change_sets\` (\`id\`) on delete set null
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`assist_runs\` drop foreign key \`assist_runs_change_set_id_fkey\``.execute(db);
  await sql`alter table \`assist_runs\` drop column \`change_set_id\``.execute(db);
  await sql`delete from \`assist_runs\` where \`action\` in (${sql.join(ACTIONS_ADDED.map((action) => sql.lit(action)))})`.execute(
    db,
  );
  await replaceActionCheck(db, ACTIONS_BEFORE);
};
