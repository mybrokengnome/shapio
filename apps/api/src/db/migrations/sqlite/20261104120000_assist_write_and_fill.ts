import { sql, type Kysely } from 'kysely';
import { ACTIONS_ADDED, ACTIONS_BEFORE } from '../20261104120000_assist_write_and_fill.js';
import { rebuildWithCheck } from './rebuildWithCheck.js';

/**
 * SQLite twin of `../20261104120000_assist_write_and_fill.ts`. SQLite cannot change a check constraint, nor
 * drop a column a foreign key uses, so `assist_runs` is rebuilt both ways (`./rebuildWithCheck.ts`) with the
 * action list and the `change_set_id` column swapped. Nothing references `assist_runs`.
 */
const STEP = 'assist_write_and_fill';
const listOf = (actions: readonly string[]) => actions.map((action) => `'${action}'`).join(', ');
const BEFORE = `(action IN (${listOf(ACTIONS_BEFORE)}))`;
const AFTER = `(action IN (${listOf([...ACTIONS_BEFORE, ...ACTIONS_ADDED])}))`;
const LAST_COLUMN = '"finished_at" text_timestamptz,';
const COLUMN = `"change_set_id" text_uuid,`;
const FOREIGN_KEY =
  'constraint "assist_runs_change_set_id_fkey" foreign key (change_set_id) references change_sets (id) on delete set null,';

const expect = (definition: string, part: string) => {
  if (!definition.includes(part)) {
    throw new Error(`assist_runs: expected ${part} in its definition`);
  }
};

export const up = (db: Kysely<unknown>): Promise<void> =>
  rebuildWithCheck(db, {
    table: 'assist_runs',
    step: STEP,
    rewrite: (definition) => {
      expect(definition, BEFORE);
      expect(definition, LAST_COLUMN);
      return definition
        .replace(BEFORE, AFTER)
        .replace(LAST_COLUMN, `${LAST_COLUMN}\n    ${COLUMN}\n    ${FOREIGN_KEY}`);
    },
  });

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from "assist_runs" where "action" in (${sql.join(ACTIONS_ADDED.map((action) => sql.lit(action)))})`.execute(
    db,
  );
  await rebuildWithCheck(db, {
    table: 'assist_runs',
    step: STEP,
    rewrite: (definition) => {
      expect(definition, AFTER);
      expect(definition, COLUMN);
      expect(definition, FOREIGN_KEY);
      return definition
        .replace(AFTER, BEFORE)
        .replace(`\n    ${COLUMN}`, '')
        .replace(`\n    ${FOREIGN_KEY}`, '');
    },
  });
};
