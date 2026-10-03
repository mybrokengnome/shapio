import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ShapioClient } from '@shapio/client';
import { mimeTypeOf, uploadFile } from '@shapio/client/node';
import type { ConversionWarning, ImportMedia } from './types.js';

/**
 * One media item into the library: a local file when the source has one (an extracted export, `--media-dir`),
 * else a download into the plan's cache (kept, so a re-run does not fetch it again). Alt text and caption are
 * set after the upload; failing that is a warning, never a lost upload.
 */
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_ALT_LENGTH = 1000;
const MAX_CAPTION_LENGTH = 4000;

export type MediaContext = {
  client: ShapioClient;
  baseUrl: string;
  cacheDir: string;
  fetch: typeof globalThis.fetch;
  warnings: ConversionWarning[];
};

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const cachePath = (cacheDir: string, media: ImportMedia) =>
  join(
    cacheDir,
    `${createHash('sha256').update(media.sourceId).digest('hex').slice(0, 24)}${extname(media.filename).toLowerCase()}`,
  );

const contentTypeOf = (response: Response) => {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return type && type !== 'application/octet-stream' ? type : undefined;
};

const download = async (url: string, path: string, context: MediaContext) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`not an http(s) URL: ${url}`);
  }
  const response = await context.fetch(parsed, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`download failed: HTTP ${response.status} for ${url}`);
  }
  await mkdir(context.cacheDir, { recursive: true });
  const body: unknown = response.body;
  await pipeline(
    Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(`${path}.part`),
  );
  await rename(`${path}.part`, path);
  return contentTypeOf(response);
};

/** The file to upload and its type. */
const localFile = async (media: ImportMedia, context: MediaContext) => {
  if (media.path && (await exists(media.path))) {
    return { path: media.path, mimeType: media.mimeType ?? mimeTypeOf(media.filename) };
  }
  if (!media.url) {
    throw new Error(`no file for ${media.filename}${media.path ? ` (${media.path} is missing)` : ''}`);
  }
  const path = cachePath(context.cacheDir, media);
  const downloadedType = (await exists(path)) ? undefined : await download(media.url, path, context);
  return { path, mimeType: media.mimeType ?? mimeTypeOf(media.filename) ?? downloadedType };
};

/** Uploads one item; returns the new asset's ID. */
export const importMedia = async (media: ImportMedia, context: MediaContext): Promise<string> => {
  const file = await localFile(media, context);
  if (!file.mimeType) {
    throw new Error(`unknown file type for ${media.filename}`);
  }
  const asset = await uploadFile(context.client, {
    baseUrl: context.baseUrl,
    path: file.path,
    filename: media.filename,
    mimeType: file.mimeType,
  });
  const alt = media.alt?.trim().slice(0, MAX_ALT_LENGTH);
  const caption = media.caption?.trim().slice(0, MAX_CAPTION_LENGTH);
  if (alt || caption) {
    try {
      await context.client.admin.media.assets.update(asset.id, {
        expectedVersion: asset.version,
        ...(alt ? { alt } : {}),
        ...(caption ? { caption } : {}),
      });
    } catch (error) {
      context.warnings.push({
        code: 'mediaTextNotSet',
        detail: `${media.filename}: ${(error as Error).message}`,
      });
    }
  }
  return asset.id;
};
