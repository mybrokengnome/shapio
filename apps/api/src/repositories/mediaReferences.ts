import type { Insertable, Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, MediaReferences } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type NewMediaReference = Insertable<MediaReferences>;

export const insertMany = async (rows: readonly NewMediaReference[], trx: Executor = db) => {
  if (rows.length === 0) {
    return;
  }
  await trx
    .insertInto('media_references')
    .values([...rows])
    .onConflict((oc) => oc.doNothing())
    .execute();
};

export type ReferenceScope = { entryId: string; locale?: string; state?: 'draft' | 'published' };

export const deleteForEntry = async ({ entryId, locale, state }: ReferenceScope, trx: Executor = db) =>
  Number(
    (
      await trx
        .deleteFrom('media_references')
        .where('entry_id', '=', entryId)
        .$if(locale !== undefined, (qb) => qb.where('locale', '=', locale ?? ''))
        .$if(state !== undefined, (qb) => qb.where('state', '=', state ?? 'draft'))
        .executeTakeFirst()
    ).numDeletedRows,
  );

export const listForAsset = (assetId: string, limit: number, trx: Executor = db) =>
  trx
    .selectFrom('media_references')
    .select(['entry_id', 'model_id', 'field_id', 'locale', 'state', 'created_at'])
    .where('asset_id', '=', assetId)
    .orderBy('created_at', 'desc')
    .orderBy('entry_id')
    .orderBy('field_id')
    .orderBy('locale')
    .orderBy('state')
    .limit(limit)
    .execute();

export const countForAsset = async (assetId: string, trx: Executor = db) =>
  Number(
    (
      await trx
        .selectFrom('media_references')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('asset_id', '=', assetId)
        .executeTakeFirstOrThrow()
    ).count,
  );

export const deleteForAsset = (assetId: string, trx: Executor = db) =>
  trx.deleteFrom('media_references').where('asset_id', '=', assetId).execute();

/** Entries using an asset (re-checking alt text after the library's changes). */
export const listEntryIdsForAsset = async (assetId: string, executor: Executor = db) =>
  (
    await executor
      .selectFrom('media_references')
      .select('entry_id')
      .distinct()
      .where('asset_id', '=', assetId)
      .execute()
  ).map((row) => row.entry_id);
