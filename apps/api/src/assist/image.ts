import sharp from 'sharp';
import { ASSIST_IMAGE_MAX_EDGE, ASSIST_IMAGE_QUALITY } from '../constants/assist.js';
import { readStream } from '../media/checksum.js';
import type { MediaStorage, StorageDriver } from '../media/types.js';
import { MAX_INPUT_PIXELS, RASTER_IMAGE_TYPES } from '../media/variants.js';
import type { MediaAssetRow } from '../repositories/mediaAssets.js';
import { assistNotAnImage } from './errors.js';
import type { AssistImage } from './providers/types.js';

/**
 * The image a vision model sees: the original, auto-oriented and re-encoded as a JPEG that fits 1024 px, so
 * the request stays small and no metadata (EXIF, GPS) leaves the server. SVG and other non-raster files are
 * refused: they are never rasterised (media/variants.ts).
 */
export const assistImageOf = async (storage: MediaStorage, asset: MediaAssetRow): Promise<AssistImage> => {
  if (!RASTER_IMAGE_TYPES.has(asset.mime_type)) {
    throw assistNotAnImage();
  }
  const adapter = storage.get(asset.storage_driver as StorageDriver);
  const original = await readStream(await adapter.getStream(asset.storage_key), Number(asset.size_bytes));
  let jpeg: Buffer;
  try {
    jpeg = await sharp(original, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({
        width: ASSIST_IMAGE_MAX_EDGE,
        height: ASSIST_IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: ASSIST_IMAGE_QUALITY })
      .toBuffer();
  } catch {
    throw assistNotAnImage();
  }
  return { mediaType: 'image/jpeg', data: jpeg.toString('base64') };
};
