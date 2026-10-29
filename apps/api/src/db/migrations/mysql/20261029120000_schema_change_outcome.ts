import { sql, type Kysely } from 'kysely';

/** MySQL twin of `../20261029120000_schema_change_outcome.ts`: JSON columns are `json`. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`schema_change_jobs\` add column \`outcome\` json`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table \`schema_change_jobs\` drop column \`outcome\``.execute(db);
};
