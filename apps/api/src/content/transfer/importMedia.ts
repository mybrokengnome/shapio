import { JOB_PRIORITY } from '../../constants/jobPriorities.js';
import { MEDIA_JOB_MAX_ATTEMPTS, MEDIA_PROCESS_JOB } from '../../constants/media.js';
import type { Database } from '../../db/index.js';
import { enqueueJob } from '../../jobs/queue.js';
import { digestStream } from '../../media/checksum.js';
import { isValidStorageKey, visibilityOfKey } from '../../media/keys.js';
import type { MediaStorage } from '../../media/types.js';
import * as transferImportRepository from '../../repositories/transferImport.js';
import type { MediaAssetRecord } from './format.js';

/**
 * Media rows of an import (package L). The files are already in the target's storage under the bundle's
 * keys: uploaded by `shapio import` from a `--with-media` bundle (checked against the manifest's SHA-256
 * on upload), or copied there by the operator (same bucket, rsync of MEDIA_PATH). Each new asset's file is
 * verified against the manifest before its row is written; its variants are then rendered again by the
 * usual `media.process` job, so they are never copied.
 */
export type MediaImportError = { id: string; code: string; message: string };

/** `<visibility>/<asset id>/...`: an import may only point an asset at its own objects. */
export const isAssetKey = (asset: Pick<MediaAssetRecord, 'id' | 'storageKey' | 'visibility'>) =>
  isValidStorageKey(asset.storageKey) &&
  visibilityOfKey(asset.storageKey) === asset.visibility &&
  asset.storageKey.split('/')[1] === asset.id;

const verifyFile = async (
  storage: MediaStorage,
  asset: MediaAssetRecord,
): Promise<MediaImportError | string> => {
  if (!isAssetKey(asset)) {
    return {
      id: asset.id,
      code: 'MEDIA_KEY_INVALID',
      message: `${asset.storageKey} is not a key of asset ${asset.id}`,
    };
  }
  const adapter = storage.active;
  if (!(await adapter.exists(asset.storageKey))) {
    return {
      id: asset.id,
      code: 'MEDIA_FILE_MISSING',
      message: `${asset.filename}: ${asset.storageKey} is not in ${adapter.driver} storage (import with a --with-media bundle, or copy the file there)`,
    };
  }
  const { sha256, size } = await digestStream(await adapter.getStream(asset.storageKey));
  if ((asset.sha256 !== null && sha256 !== asset.sha256) || size !== asset.sizeBytes) {
    return {
      id: asset.id,
      code: 'MEDIA_CHECKSUM_MISMATCH',
      message: `${asset.filename}: the stored file does not match the bundle's checksum and size`,
    };
  }
  return sha256;
};

export type MediaBatchResult = { added: number; unchanged: number; errors: MediaImportError[] };

export const importMediaBatch = async (
  db: Database,
  storage: MediaStorage,
  siteId: string,
  assets: readonly MediaAssetRecord[],
): Promise<MediaBatchResult> => {
  const existing = new Set(
    (await transferImportRepository.findAssets(assets.map((asset) => asset.id))).map((row) => row.id),
  );
  const folders = await transferImportRepository.findFolderIds(
    assets.flatMap((asset) => (asset.folderId ? [asset.folderId] : [])),
  );
  const result: MediaBatchResult = { added: 0, unchanged: 0, errors: [] };
  for (const asset of assets) {
    if (existing.has(asset.id)) {
      result.unchanged += 1;
      continue;
    }
    const verified = await verifyFile(storage, asset);
    if (typeof verified !== 'string') {
      result.errors.push(verified);
      continue;
    }
    await db.transaction().execute(async (trx) => {
      await transferImportRepository.insertAsset(
        {
          id: asset.id,
          site_id: siteId,
          folder_id: asset.folderId && folders.has(asset.folderId) ? asset.folderId : null,
          storage_driver: storage.active.driver,
          storage_key: asset.storageKey,
          original_filename: asset.filename,
          mime_type: asset.mimeType,
          size_bytes: asset.sizeBytes,
          width: asset.width,
          height: asset.height,
          checksum_sha256: verified,
          alt: asset.alt,
          caption: asset.caption,
          focal_x: asset.focalX,
          focal_y: asset.focalY,
          visibility: asset.visibility,
          status: 'processing',
          created_at: asset.createdAt,
          updated_at: asset.updatedAt,
          created_by: null,
        },
        trx,
      );
      await enqueueJob(
        {
          type: MEDIA_PROCESS_JOB,
          payload: { assetId: asset.id, storageKey: asset.storageKey },
          priority: JOB_PRIORITY.interactive,
          idempotencyKey: `${MEDIA_PROCESS_JOB}:${asset.storageKey}`,
          maxAttempts: MEDIA_JOB_MAX_ATTEMPTS,
        },
        trx,
      );
    });
    result.added += 1;
  }
  return result;
};
