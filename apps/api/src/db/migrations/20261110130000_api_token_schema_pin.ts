import type { Kysely } from 'kysely';

/**
 * Schema lenses (plan schema-lenses): `api_tokens.pinned_schema_version`, the global schema version a token is
 * pinned to. A request made with the token that names no schema version reads and writes as if it had named
 * this one. Null: no pin (today's shape). Portable Kysely only, so every dialect runs this same module.
 */
export const dialectNeutral = true;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('api_tokens').addColumn('pinned_schema_version', 'integer').execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('api_tokens').dropColumn('pinned_schema_version').execute();
};
