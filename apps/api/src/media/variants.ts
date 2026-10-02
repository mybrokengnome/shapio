import sharp from 'sharp';

/** Raster formats sharp's prebuilt binaries decode. SVG is left as is (no rasterising of untrusted XML). */
export const RASTER_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
]);

export type VariantDefinition = { name: string; width: number; height?: number };

/** Every variant is WebP: small, and supported by every current browser. */
export const VARIANT_FORMAT = { format: 'webp', mimeType: 'image/webp', extension: 'webp' } as const;

/**
 * A thumbnail for the library, plus responsive widths. Responsive variants are only made when the original
 * is wider, so nothing is upscaled.
 */
export const VARIANT_DEFINITIONS: readonly VariantDefinition[] = [
  { name: 'thumbnail', width: 400, height: 400 },
  { name: 'w640', width: 640 },
  { name: 'w1280', width: 1280 },
  { name: 'w1920', width: 1920 },
];

export const variantsFor = (originalWidth: number): VariantDefinition[] =>
  VARIANT_DEFINITIONS.filter((variant) => variant.height !== undefined || originalWidth > variant.width);

/** Decoding limit: about 100 megapixels, so a decompression bomb cannot exhaust memory. */
const MAX_INPUT_PIXELS = 100_000_000;

const open = (input: Buffer) => sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS });

/** Display dimensions (EXIF orientation applied). Throws when the bytes are not a decodable image. */
export const readImageSize = async (input: Buffer): Promise<{ width: number; height: number }> => {
  const metadata = await open(input).metadata();
  const width = metadata.autoOrient?.width ?? metadata.width;
  const height = metadata.autoOrient?.height ?? metadata.height;
  if (!width || !height) {
    throw new Error('The image has no dimensions');
  }
  return { width, height };
};

export type RenderedVariant = { data: Buffer; width: number; height: number };

export const renderVariant = async (input: Buffer, variant: VariantDefinition): Promise<RenderedVariant> => {
  const { data, info } = await open(input)
    .rotate()
    .resize({
      width: variant.width,
      ...(variant.height ? { height: variant.height } : {}),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
