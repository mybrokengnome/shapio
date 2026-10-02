import type { Kysely } from 'kysely';
import type { DB } from '../db/types.js';
import { describeError } from '../helpers/errors.js';
import type { JobLogger } from '../jobs/types.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { MediaAssetRow } from '../repositories/mediaAssets.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import { digestStream, readStream, sha256Of } from './checksum.js';
import { buildVariantKey } from './keys.js';
import type { MediaStorage, StorageAdapter, StorageDriver } from './types.js';
import {
  RASTER_IMAGE_TYPES,
  readImageSize,
  renderVariant,
  VARIANT_FORMAT,
  variantsFor,
  type VariantDefinition,
} from './variants.js';

export type MediaJobDependencies = { db: Kysely<DB>; storage: MediaStorage; log: JobLogger };

export type ProcessPayload = { assetId: string; storageKey: string };

export type ProcessOutcome = 'stale' | 'ready' | 'failed';

type ImageInput = { buffer: Buffer; width: number; height: number };

/** Reads the original once: checksum for every file, decoded size for raster images. */
const inspectOriginal = async (
  adapter: StorageAdapter,
  asset: MediaAssetRow,
): Promise<{ sha256: string; image?: ImageInput; imageError?: string }> => {
  if (!RASTER_IMAGE_TYPES.has(asset.mime_type)) {
    return { sha256: (await digestStream(await adapter.getStream(asset.storage_key))).sha256 };
  }
  const buffer = await readStream(await adapter.getStream(asset.storage_key), Number(asset.size_bytes));
  try {
    return { sha256: sha256Of(buffer), image: { buffer, ...(await readImageSize(buffer)) } };
  } catch (error) {
    return {
      sha256: sha256Of(buffer),
      imageError: `The image could not be decoded: ${describeError(error)}`,
    };
  }
};

/** Renders and stores one variant. Returns false when the asset changed meanwhile (stop processing). */
const produceVariant = async (
  deps: MediaJobDependencies,
  adapter: StorageAdapter,
  asset: MediaAssetRow,
  image: ImageInput,
  variant: VariantDefinition,
): Promise<boolean> => {
  let rendered;
  try {
    rendered = await renderVariant(image.buffer, variant);
  } catch (error) {
    // Decoding problems are permanent for these bytes; storage problems below are retried.
    return mediaVariantsRepository.recordResult(
      asset.id,
      variant.name,
      asset.storage_key,
      { status: 'failed', error: describeError(error) },
      deps.db,
    );
  }
  const key = buildVariantKey(asset.storage_key, variant.name, VARIANT_FORMAT.extension);
  await adapter.put(key, rendered.data, { contentType: VARIANT_FORMAT.mimeType });
  const recorded = await mediaVariantsRepository.recordResult(
    asset.id,
    variant.name,
    asset.storage_key,
    {
      status: 'ready',
      storageKey: key,
      width: rendered.width,
      height: rendered.height,
      sizeBytes: rendered.data.length,
      checksumSha256: sha256Of(rendered.data),
    },
    deps.db,
  );
  if (!recorded) {
    await adapter.delete(key);
  }
  return recorded;
};

/**
 * The `media.process` job: checksum, dimensions and image variants for one stored original, written back
 * to the same storage. Idempotent (re-running overwrites the same keys) and stale-safe: every write is
 * conditioned on the asset still having `storageKey`, so a replaced or deleted asset is left alone.
 */
export const processAsset = async (
  deps: MediaJobDependencies,
  payload: ProcessPayload,
): Promise<ProcessOutcome> => {
  const asset = await mediaAssetsRepository.findById(payload.assetId, deps.db);
  if (!asset || asset.deleted_at !== null || asset.storage_key !== payload.storageKey) {
    return 'stale';
  }
  const adapter = deps.storage.get(asset.storage_driver as StorageDriver);
  const { sha256, image, imageError } = await inspectOriginal(adapter, asset);
  const variants = image ? variantsFor(image.width) : [];
  const prepared = await deps.db.transaction().execute(async (trx) => {
    const row = await mediaAssetsRepository.updateIfStorageKey(
      asset.id,
      asset.storage_key,
      {
        checksum_sha256: sha256,
        width: image?.width ?? null,
        height: image?.height ?? null,
        ...(imageError ? { status: 'failed', processing_error: imageError } : {}),
        ...(!image && !imageError ? { status: 'ready', processing_error: null } : {}),
      },
      trx,
    );
    if (row && variants.length > 0) {
      await mediaVariantsRepository.upsertPending(
        variants.map((variant) => ({
          asset_id: asset.id,
          name: variant.name,
          width: variant.width,
          height: variant.height ?? null,
          format: VARIANT_FORMAT.format,
          mime_type: VARIANT_FORMAT.mimeType,
        })),
        trx,
      );
    }
    return row !== undefined;
  });
  if (!prepared) {
    return 'stale';
  }
  if (!image) {
    deps.log.info({ assetId: asset.id, imageError }, 'media processed');
    return imageError ? 'failed' : 'ready';
  }
  for (const variant of variants) {
    if (!(await produceVariant(deps, adapter, asset, image, variant))) {
      return 'stale';
    }
  }
  const done = await mediaAssetsRepository.updateIfStorageKey(
    asset.id,
    asset.storage_key,
    { status: 'ready', processing_error: null },
    deps.db,
  );
  deps.log.info({ assetId: asset.id, variants: variants.length }, 'media processed');
  return done ? 'ready' : 'stale';
};

/** After the last attempt fails, the asset says so instead of staying `processing` forever. */
export const markProcessingFailed = async (
  deps: MediaJobDependencies,
  payload: ProcessPayload,
  error: unknown,
) => {
  await mediaAssetsRepository.updateIfStorageKey(
    payload.assetId,
    payload.storageKey,
    { status: 'failed', processing_error: describeError(error) },
    deps.db,
  );
};
