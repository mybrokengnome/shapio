import { sql, type Kysely } from 'kysely';

/** SQLite twin of `../20261029120000_schema_change_outcome.ts`: JSON columns are `text_jsonb`. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "schema_change_jobs" add column "outcome" text_jsonb`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table "schema_change_jobs" drop column "outcome"`.execute(db);
};
