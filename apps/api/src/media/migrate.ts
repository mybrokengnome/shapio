import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { describeError } from '../helpers/errors.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { MediaAssetRow } from '../repositories/mediaAssets.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import { copyObjectVerified } from './objects.js';
import type { MediaStorage, StorageAdapter, StorageDriver } from './types.js';

export type MigrateMediaOptions = {
  db: Kysely<DB>;
  storage: MediaStorage;
  from: StorageDriver;
  to: StorageDriver;
  /** Delete each object from the source after its asset has moved. Off by default: the source stays a backup. */
  deleteSource?: boolean;
  batchSize?: number;
  /** Progress lines (one per asset). */
  report?: (line: string) => void;
};

export type MigrateMediaResult = {
  migrated: number;
  /** Still processing (variants being written); run the command again later. */
  skipped: number;
  failed: { assetId: string; error: string }[];
};

type AssetObject = { key: string; mimeType: string; checksum: string | null };

const objectsOf = async (db: Kysely<DB>, asset: MediaAssetRow): Promise<AssetObject[]> => [
  { key: asset.storage_key, mimeType: asset.mime_type, checksum: asset.checksum_sha256 },
  ...(await mediaVariantsRepository.listForAssets([asset.id], db)).flatMap((variant) =>
    variant.storage_key
      ? [{ key: variant.storage_key, mimeType: variant.mime_type, checksum: variant.checksum_sha256 }]
      : [],
  ),
];

/**
 * Moves one asset: copy every object (verifying checksums against the database and by reading the copy
 * back), then switch the asset's driver in one transaction, only if nothing changed meanwhile.
 */
const migrateAsset = async (
  options: MigrateMediaOptions,
  source: StorageAdapter,
  target: StorageAdapter,
  asset: MediaAssetRow,
): Promise<'migrated' | 'skipped'> => {
  const { db } = options;
  if (asset.status === 'processing') {
    return 'skipped';
  }
  const objects = await objectsOf(db, asset);
  const verified = new Map<string, string>();
  for (const object of objects) {
    const { sha256 } = await copyObjectVerified({
      from: source,
      fromKey: object.key,
      to: target,
      toKey: object.key,
      contentType: object.mimeType,
      expectedSha256: object.checksum,
    });
    verified.set(object.key, sha256);
  }
  const switched = await db.transaction().execute(async (trx) => {
    const locked = await mediaAssetsRepository.lockById(asset.id, trx);
    if (
      !locked ||
      locked.deleted_at !== null ||
      locked.storage_driver !== options.from ||
      locked.storage_key !== asset.storage_key
    ) {
      return false;
    }
    await mediaAssetsRepository.update(
      asset.id,
      { storage_driver: options.to, checksum_sha256: verified.get(asset.storage_key) ?? null },
      trx,
    );
    return true;
  });
  if (!switched) {
    return 'skipped';
  }
  if (options.deleteSource) {
    for (const object of objects) {
      await source.delete(object.key);
    }
  }
  return 'migrated';
};

/**
 * `shapio media migrate`: moves every live asset (original and variants) from one driver to another while
 * the server keeps serving, since each asset is read from the driver its row records. Resumable and
 * idempotent: progress is the rows themselves (a moved asset no longer matches `from`), copies overwrite
 * the same keys, and an interrupted run simply continues with the assets still on `from`.
 */
export const migrateMedia = async (options: MigrateMediaOptions): Promise<MigrateMediaResult> => {
  if (options.from === options.to) {
    throw new Error('--from and --to must differ');
  }
  const source = options.storage.get(options.from);
  const target = options.storage.get(options.to);
  const batchSize = options.batchSize ?? 100;
  const result: MigrateMediaResult = { migrated: 0, skipped: 0, failed: [] };
  let afterId: string | undefined;
  for (;;) {
    const batch = await mediaAssetsRepository.listLiveByDriver(options.from, afterId, batchSize, options.db);
    if (batch.length === 0) {
      return result;
    }
    for (const asset of batch) {
      try {
        const outcome = await migrateAsset(options, source, target, asset);
        result[outcome] += 1;
        options.report?.(`${outcome} ${asset.id} ${asset.original_filename}`);
      } catch (error) {
        result.failed.push({ assetId: asset.id, error: describeError(error) });
        options.report?.(`failed ${asset.id} ${asset.original_filename}: ${describeError(error)}`);
      }
    }
    afterId = batch.at(-1)?.id;
  }
};
