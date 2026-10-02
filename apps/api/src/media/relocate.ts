import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import { visibilityOfKey, withVisibility, type MediaVisibility } from './keys.js';
import { copyObjectVerified } from './objects.js';
import type { MediaJobDependencies } from './process.js';
import { enqueuePurge } from './purge.js';
import type { StorageDriver } from './types.js';

export class AssetBusyError extends Error {
  constructor(assetId: string) {
    super(`Asset ${assetId} is still processing; it will be moved after`);
    this.name = 'AssetBusyError';
  }
}

/**
 * The `media.relocate` job: after a visibility change, copies the original and its variants under the
 * new visibility prefix (verified by checksum), points the rows at them, and purges the old objects.
 * Shapio's own routes honour the new visibility before this runs; the move matters for a CDN or bucket
 * policy that exposes only `public/`.
 */
export const relocateAsset = async (
  deps: MediaJobDependencies,
  payload: { assetId: string },
): Promise<'moved' | 'unchanged' | 'stale'> => {
  const asset = await mediaAssetsRepository.findById(payload.assetId, deps.db);
  if (!asset || asset.deleted_at !== null) {
    return 'stale';
  }
  const target = asset.visibility as MediaVisibility;
  if (visibilityOfKey(asset.storage_key) === target) {
    return 'unchanged';
  }
  if (asset.status === 'processing') {
    // Retried with backoff: the process job would otherwise write variants under the old prefix.
    throw new AssetBusyError(asset.id);
  }
  const driver = asset.storage_driver as StorageDriver;
  const adapter = deps.storage.get(driver);
  const variants = (await mediaVariantsRepository.listForAssets([asset.id], deps.db)).filter(
    (variant) => variant.storage_key !== null,
  );
  const moves = [
    { key: asset.storage_key, mimeType: asset.mime_type, checksum: asset.checksum_sha256 },
    ...variants.map((variant) => ({
      key: variant.storage_key ?? '',
      mimeType: variant.mime_type,
      checksum: variant.checksum_sha256,
    })),
  ];
  for (const move of moves) {
    await copyObjectVerified({
      from: adapter,
      fromKey: move.key,
      to: adapter,
      toKey: withVisibility(move.key, target),
      contentType: move.mimeType,
      expectedSha256: move.checksum,
    });
  }
  return deps.db.transaction().execute(async (trx) => {
    const locked = await mediaAssetsRepository.lockById(asset.id, trx);
    const current =
      locked &&
      locked.deleted_at === null &&
      locked.storage_key === asset.storage_key &&
      locked.storage_driver === asset.storage_driver &&
      locked.visibility === target;
    const purge = current
      ? moves.map((move) => move.key)
      : moves.map((move) => withVisibility(move.key, target));
    if (current) {
      await mediaAssetsRepository.update(
        asset.id,
        { storage_key: withVisibility(asset.storage_key, target) },
        trx,
      );
      for (const variant of variants) {
        await mediaVariantsRepository.updateStorageKey(
          variant.id,
          withVisibility(variant.storage_key ?? '', target),
          trx,
        );
      }
    }
    await enqueuePurge(
      trx,
      purge.map((key) => ({ driver, key })),
    );
    return current ? 'moved' : 'stale';
  });
};
