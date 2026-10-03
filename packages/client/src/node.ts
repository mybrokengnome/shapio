import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { buildUploadForm, resolveUploadUrl } from './admin/media.js';
import type { MediaAsset, MediaVisibility } from './admin/mediaTypes.js';
import type { ShapioClient } from './client.js';
import { ShapioApiError } from './errors.js';

/**
 * Node-only helpers (`@shapio/client/node`): reading files from disk. The main entry stays free of `node:`
 * imports so it also runs in browsers and edge runtimes.
 */

/** Common types by extension; anything else needs an explicit `mimeType`. The server checks the bytes. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

export const mimeTypeOf = (path: string): string | undefined => MIME_TYPES[extname(path).toLowerCase()];

export type UploadFileInput = {
  /** The Shapio base URL the client was created with (Shapio's own upload route is reached through it). */
  baseUrl: string;
  path: string;
  /** Defaults to the file's name. */
  filename?: string;
  /** Defaults to the type for the file's extension. */
  mimeType?: string;
  folderId?: string | null;
  visibility?: MediaVisibility;
  /** Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
};

/**
 * Uploads a file from disk into the media library: asks for a grant, sends the bytes to the grant's URL
 * (Shapio's upload route or a bucket's presigned POST), then confirms. Returns the new asset.
 */
export const uploadFile = async (client: ShapioClient, input: UploadFileInput): Promise<MediaAsset> => {
  const mimeType = input.mimeType ?? mimeTypeOf(input.path);
  if (!mimeType) {
    throw new Error(`Unknown file type for ${input.path}; pass mimeType`);
  }
  const filename = input.filename ?? basename(input.path);
  const { size } = await stat(input.path);
  const grant = await client.admin.media.uploads.create({
    filename,
    mimeType,
    sizeBytes: size,
    ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
  });
  const file = await openAsBlob(input.path, { type: mimeType });
  const send = input.fetch ?? globalThis.fetch;
  const response = await send(resolveUploadUrl(grant, input.baseUrl), {
    method: 'POST',
    body: buildUploadForm(grant, file, filename),
  });
  if (!response.ok) {
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON (a bucket's XML error): keep the text.
    }
    throw new ShapioApiError(response.status, body);
  }
  return client.admin.media.uploads.confirm(grant.grantId);
};
