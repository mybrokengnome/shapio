import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../helpers/appError.js';
import type { MediaStorage, StorageDriver } from '../../media/types.js';
import { BUNDLE_CONTENT_TYPE } from './format.js';

/**
 * Where an uploaded bundle lives while it is planned and imported. The request stages it in a temporary
 * file (the plan reads it more than once); a real import then stores it in media storage under
 * `private/transfer/<import id>/bundle.ndjson`, so a dedicated worker on another host can read it, and the
 * import job removes it when done (the request does, when the import fails before its job is queued).
 * `private/` objects are never served without a signature.
 */
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024 * 1024;

export type StagedBundle = { path: string; size: number; open: () => Readable; remove: () => Promise<void> };

export type StoredBundle = { driver: StorageDriver; key: string };

const bundleTooLarge = () =>
  new AppError(413, 'BUNDLE_TOO_LARGE', `A bundle may be at most ${MAX_BUNDLE_BYTES} bytes`);

/** Copies the upload to a temporary file, enforcing the size limit while streaming. */
export const stageBundle = async (input: Readable): Promise<StagedBundle> => {
  const path = join(tmpdir(), `shapio-transfer-${randomBytes(8).toString('hex')}.ndjson`);
  const remove = () => rm(path, { force: true });
  let size = 0;
  input.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_BUNDLE_BYTES) {
      input.destroy(bundleTooLarge());
    }
  });
  try {
    await pipeline(input, createWriteStream(path, { mode: 0o600 }));
  } catch (error) {
    await remove();
    throw error;
  }
  return { path, size: (await stat(path)).size, open: () => createReadStream(path), remove };
};

export const bundleKeyFor = (importId: string) => `private/transfer/${importId}/bundle.ndjson`;

export const storeBundle = async (
  storage: MediaStorage,
  staged: StagedBundle,
  importId: string,
): Promise<StoredBundle> => {
  const key = bundleKeyFor(importId);
  await storage.active.put(key, staged.open(), {
    contentType: BUNDLE_CONTENT_TYPE,
    contentLength: staged.size,
  });
  return { driver: storage.active.driver, key };
};

export const openStoredBundle = (storage: MediaStorage, stored: StoredBundle) =>
  storage.get(stored.driver).getStream(stored.key);

export const removeStoredBundle = (storage: MediaStorage, stored: StoredBundle) =>
  storage.get(stored.driver).delete(stored.key);
