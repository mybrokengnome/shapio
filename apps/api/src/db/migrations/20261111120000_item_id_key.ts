import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';

/**
 * Item IDs (plan item-ids): `system_versions.item_id_key`, a random secret written once. An item of a component
 * list or zone stored before item IDs existed has none; reads derive one from it with this key (a keyed hash over
 * the item's content), so the ID never lets a caller test guesses of values it cannot read. Portable Kysely
 * only, so every dialect runs this same module. Running `up` again finishes it: MySQL commits the column on its
 * own, so a run stopped between the two statements leaves the column without a key, which the next run (or the
 * first read, `getItemIdKey`) fills.
 */
export const dialectNeutral = true;

type Versions = { system_versions: { item_id_key: string | null } };

const hasColumn = async (db: Kysely<unknown>) =>
  (await db.introspection.getTables()).some(
    (table) =>
      table.name === 'system_versions' && table.columns.some((column) => column.name === 'item_id_key'),
  );

export const up = async (db: Kysely<unknown>): Promise<void> => {
  if (!(await hasColumn(db))) {
    await db.schema.alterTable('system_versions').addColumn('item_id_key', 'text').execute();
  }
  await (db as unknown as Kysely<Versions>)
    .updateTable('system_versions')
    .set({ item_id_key: randomBytes(32).toString('hex') })
    .where('item_id_key', 'is', null)
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  if (await hasColumn(db)) {
    await db.schema.alterTable('system_versions').dropColumn('item_id_key').execute();
  }
};
