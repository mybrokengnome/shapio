import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { MediaVisibility } from '../media/keys.js';
import type { MediaStorage, StorageDriver } from '../media/types.js';
import { resolveObjectUrl } from '../media/urls.js';
import type { MediaAssetRow } from '../repositories/mediaAssets.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';
import type { MediaVariantRow } from '../repositories/mediaVariants.js';

export type MediaVariantView = {
  name: string;
  width: number | null;
  height: number | null;
  format: string;
  mimeType: string;
  sizeBytes: number | null;
  status: 'pending' | 'ready' | 'failed';
  /** Present once the variant is ready. */
  url: string | null;
};

export type MediaAssetView = {
  id: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  checksumSha256: string | null;
  alt: string;
  caption: string;
  focalPoint: { x: number; y: number } | null;
  visibility: MediaVisibility;
  /** `processing` until the checksum, dimensions and variants are done. */
  status: 'processing' | 'ready' | 'failed';
  processingError: string | null;
  storageDriver: StorageDriver;
  url: string;
  /** When `url` stops working (private assets); null for stable public URLs. */
  urlExpiresAt: Date | null;
  variants: MediaVariantView[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

type ViewDependencies = { storage: MediaStorage; urls: UrlBuilder };

const toVariantView = async (
  deps: ViewDependencies,
  asset: MediaAssetRow,
  variant: MediaVariantRow,
): Promise<MediaVariantView> => ({
  name: variant.name,
  width: variant.width,
  height: variant.height,
  format: variant.format,
  mimeType: variant.mime_type,
  sizeBytes: variant.size_bytes === null ? null : Number(variant.size_bytes),
  status: variant.status as MediaVariantView['status'],
  url:
    variant.status === 'ready' && variant.storage_key
      ? (
          await resolveObjectUrl(deps.storage, deps.urls, {
            driver: asset.storage_driver as StorageDriver,
            key: variant.storage_key,
            visibility: asset.visibility as MediaVisibility,
            filename: asset.original_filename,
            mimeType: variant.mime_type,
          })
        ).url
      : null,
});

const toAssetView = async (
  deps: ViewDependencies,
  asset: MediaAssetRow,
  variants: readonly MediaVariantRow[],
): Promise<MediaAssetView> => {
  const { url, expiresAt } = await resolveObjectUrl(deps.storage, deps.urls, {
    driver: asset.storage_driver as StorageDriver,
    key: asset.storage_key,
    visibility: asset.visibility as MediaVisibility,
    filename: asset.original_filename,
    mimeType: asset.mime_type,
  });
  return {
    id: asset.id,
    folderId: asset.folder_id,
    filename: asset.original_filename,
    mimeType: asset.mime_type,
    sizeBytes: Number(asset.size_bytes),
    width: asset.width,
    height: asset.height,
    checksumSha256: asset.checksum_sha256,
    alt: asset.alt,
    caption: asset.caption,
    focalPoint:
      asset.focal_x !== null && asset.focal_y !== null ? { x: asset.focal_x, y: asset.focal_y } : null,
    visibility: asset.visibility as MediaVisibility,
    status: asset.status as MediaAssetView['status'],
    processingError: asset.processing_error,
    storageDriver: asset.storage_driver as StorageDriver,
    url,
    urlExpiresAt: expiresAt,
    variants: await Promise.all(variants.map((variant) => toVariantView(deps, asset, variant))),
    createdBy: asset.created_by,
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    version: asset.version,
  };
};

/**
 * API views of assets with their variants (one query for all variants) and URLs: stable for public
 * assets, signed and expiring for private ones. Package E can use this to resolve media fields.
 */
export const toAssetViews = async (
  deps: ViewDependencies,
  assets: readonly MediaAssetRow[],
): Promise<MediaAssetView[]> => {
  const variants = await mediaVariantsRepository.listForAssets(assets.map((asset) => asset.id));
  const byAsset = Map.groupBy(variants, (variant) => variant.asset_id);
  return Promise.all(assets.map((asset) => toAssetView(deps, asset, byAsset.get(asset.id) ?? [])));
};

export const toAssetViewOne = async (
  deps: ViewDependencies,
  asset: MediaAssetRow,
): Promise<MediaAssetView> => {
  const [view] = await toAssetViews(deps, [asset]);
  if (!view) {
    throw new Error('Asset view missing');
  }
  return view;
};
