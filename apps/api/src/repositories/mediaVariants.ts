import type { Insertable, Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, MediaVariants } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type MediaVariantRow = Selectable<MediaVariants>;

export const listForAssets = (assetIds: readonly string[], trx: Executor = db) =>
  assetIds.length === 0
    ? Promise.resolve([])
    : trx
        .selectFrom('media_variants')
        .selectAll()
        .where('asset_id', 'in', assetIds)
        .orderBy('asset_id')
        .orderBy('width')
        .execute();

/** Creates (or resets to pending) the variants an asset will get. */
export const upsertPending = async (rows: readonly Insertable<MediaVariants>[], trx: Executor = db) => {
  if (rows.length === 0) {
    return;
  }
  await trx
    .insertInto('media_variants')
    .values(rows.map((row) => ({ ...row, status: 'pending' })))
    .onConflict((oc) =>
      oc.columns(['asset_id', 'name']).doUpdateSet((eb) => ({
        width: eb.ref('excluded.width'),
        height: eb.ref('excluded.height'),
        format: eb.ref('excluded.format'),
        mime_type: eb.ref('excluded.mime_type'),
        storage_key: null,
        size_bytes: null,
        checksum_sha256: null,
        status: 'pending',
        error: null,
        updated_at: new Date(),
      })),
    )
    .execute();
};

type VariantResult =
  | {
      status: 'ready';
      storageKey: string;
      width: number;
      height: number;
      sizeBytes: number;
      checksumSha256: string;
    }
  | { status: 'failed'; error: string };

/**
 * Records a variant's outcome, but only while the asset still has the original it was made from
 * (`assetStorageKey`); returns false when the asset was replaced, moved or deleted meanwhile.
 */
export const recordResult = async (
  assetId: string,
  name: string,
  assetStorageKey: string,
  result: VariantResult,
  trx: Executor = db,
) => {
  const updated = await trx
    .updateTable('media_variants')
    .set(
      result.status === 'ready'
        ? {
            status: 'ready',
            storage_key: result.storageKey,
            width: result.width,
            height: result.height,
            size_bytes: result.sizeBytes,
            checksum_sha256: result.checksumSha256,
            error: null,
            updated_at: new Date(),
          }
        : { status: 'failed', error: result.error, updated_at: new Date() },
    )
    .where('asset_id', '=', assetId)
    .where('name', '=', name)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('media_assets')
          .select('id')
          .where('id', '=', assetId)
          .where('storage_key', '=', assetStorageKey)
          .where('deleted_at', 'is', null),
      ),
    )
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n;
};

/** Removes an asset's variants; returns the stored keys so the objects can be purged. */
export const deleteForAsset = async (assetId: string, trx: Executor = db) =>
  (
    await trx.deleteFrom('media_variants').where('asset_id', '=', assetId).returning('storage_key').execute()
  ).flatMap((row) => (row.storage_key ? [row.storage_key] : []));

export const updateStorageKey = (id: string, storageKey: string, trx: Executor = db) =>
  trx
    .updateTable('media_variants')
    .set({ storage_key: storageKey, updated_at: new Date() })
    .where('id', '=', id)
    .execute();

/** A ready variant by its key, with what serving it needs from its (live) asset. */
export const findServableByStorageKey = (key: string, trx: Executor = db) =>
  trx
    .selectFrom('media_variants')
    .innerJoin('media_assets', 'media_assets.id', 'media_variants.asset_id')
    .select([
      'media_variants.storage_key',
      'media_variants.mime_type',
      'media_variants.size_bytes',
      'media_variants.name',
      'media_assets.storage_driver',
      'media_assets.visibility',
      'media_assets.original_filename',
    ])
    .where('media_variants.storage_key', '=', key)
    .where('media_variants.status', '=', 'ready')
    .where('media_assets.deleted_at', 'is', null)
    .executeTakeFirst();
