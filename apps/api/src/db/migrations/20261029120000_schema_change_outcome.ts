import { sql, type Kysely } from 'kysely';

/**
 * What an activated schema change left for people to do (ADR 0002 amendment 2026-10-29): a field made
 * required goes live even when entries have no value for it, and `outcome` records how many, per field
 * (`{ requiredGaps: [...] }`), for the builder, the change set and `schema apply` to report. Null when the
 * change left nothing to do, and on every change before this column. SQLite and MySQL have their own twins.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table schema_change_jobs add column outcome jsonb`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table schema_change_jobs drop column outcome`.execute(db);
};
