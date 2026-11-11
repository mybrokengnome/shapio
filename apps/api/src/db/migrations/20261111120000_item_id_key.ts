import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';

/**
 * Item IDs (plan item-ids): `system_versions.item_id_key`, a random secret written once. An item of a component
 * list or zone stored before item IDs existed has none; reads derive one from it with this key (an HMAC over
 * the item's content), so the ID never lets a caller test guesses of values it cannot read. Portable Kysely
 * only, so every dialect runs this same module.
 */
export const dialectNeutral = true;

type Versions = { system_versions: { item_id_key: string | null } };

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('system_versions').addColumn('item_id_key', 'text').execute();
  await (db as unknown as Kysely<Versions>)
    .updateTable('system_versions')
    .set({ item_id_key: randomBytes(32).toString('hex') })
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable('system_versions').dropColumn('item_id_key').execute();
};
