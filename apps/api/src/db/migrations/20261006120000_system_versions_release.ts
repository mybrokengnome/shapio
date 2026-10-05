import type { Kysely } from 'kysely';

/**
 * In-process delivery (plan next-in-process §2): the Shapio release the server runs, written at every start
 * after migrating (`services/deliveryDescriptor.ts`). An in-process reader compares it with its own release on
 * every call and refuses to read across versions. Nullable: null until a server of this release starts.
 * Portable Kysely only, so every dialect runs this same module.
 */
export const dialectNeutral = true;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('system_versions').addColumn('release', 'text').execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('system_versions').dropColumn('release').execute();
};
