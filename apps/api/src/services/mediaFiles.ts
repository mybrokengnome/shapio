import type { Readable } from 'node:stream';
import { AppError } from '../helpers/appError.js';
import { isValidStorageKey, type MediaVisibility } from '../media/keys.js';
import { verifyMediaGet } from '../media/signing.js';
import type { ByteRange, MediaStorage, StorageDriver } from '../media/types.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as mediaVariantsRepository from '../repositories/mediaVariants.js';

export type ServableFile = {
  key: string;
  driver: StorageDriver;
  mimeType: string;
  sizeBytes: number;
  filename: string;
  visibility: MediaVisibility;
  /** Unix seconds when a signed URL stops working; undefined for public files. */
  expiresAt?: number;
};

export type FileSignature = { expires?: number; signature?: string };

const notFound = () => new AppError(404, 'NOT_FOUND', 'Media file not found');

const findFile = async (key: string): Promise<ServableFile | undefined> => {
  const asset = await mediaAssetsRepository.findLiveByStorageKey(key);
  if (asset) {
    return {
      key,
      driver: asset.storage_driver as StorageDriver,
      mimeType: asset.mime_type,
      sizeBytes: Number(asset.size_bytes),
      filename: asset.original_filename,
      visibility: asset.visibility as MediaVisibility,
    };
  }
  const variant = await mediaVariantsRepository.findServableByStorageKey(key);
  return variant
    ? {
        key,
        driver: variant.storage_driver as StorageDriver,
        mimeType: variant.mime_type,
        sizeBytes: Number(variant.size_bytes ?? 0),
        filename: variant.original_filename,
        visibility: variant.visibility as MediaVisibility,
      }
    : undefined;
};

/**
 * The file behind `/api/media/f/<key>`, if the caller may read it: public files of live assets for
 * anyone; private ones only with a valid, unexpired signature for this exact key (product rule 7). The
 * database decides visibility, so a visibility change or delete takes effect immediately.
 */
export const authorizeMediaFile = async (
  signingSecret: string,
  key: string,
  { expires, signature }: FileSignature,
): Promise<ServableFile> => {
  const file = isValidStorageKey(key) ? await findFile(key) : undefined;
  if (!file) {
    throw notFound();
  }
  if (file.visibility === 'public') {
    return file;
  }
  if (expires === undefined || signature === undefined) {
    throw new AppError(403, 'MEDIA_SIGNATURE_REQUIRED', 'This file is private; use a signed URL');
  }
  const check = verifyMediaGet(signingSecret, key, expires, signature);
  if (check === 'expired') {
    throw new AppError(403, 'MEDIA_URL_EXPIRED', 'This signed URL has expired');
  }
  if (check !== 'valid') {
    throw new AppError(403, 'MEDIA_SIGNATURE_INVALID', 'The URL signature is not valid');
  }
  return { ...file, expiresAt: expires };
};

export const openMediaFile = (
  storage: MediaStorage,
  file: ServableFile,
  range?: ByteRange,
): Promise<Readable> => storage.get(file.driver).getStream(file.key, range);
