import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { digestStream } from './checksum.js';
import { ObjectNotFoundError } from './errors.js';
import type { StorageAdapter } from './types.js';

export class ChecksumMismatchError extends Error {
  constructor(key: string, where: 'source' | 'destination', expected: string, actual: string) {
    super(`Checksum mismatch for ${key} at the ${where}: expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export type CopyObjectInput = {
  from: StorageAdapter;
  fromKey: string;
  to: StorageAdapter;
  toKey: string;
  contentType: string;
  /** The checksum the database records; the source must still match it. */
  expectedSha256?: string | null;
};

/**
 * Copies one object between adapters (or keys) and proves it arrived intact: the source is hashed while it
 * streams, compared with the recorded checksum, then the destination is read back and hashed again.
 * Idempotent: running it twice writes the same bytes. Returns the verified checksum.
 */
export const copyObjectVerified = async ({
  from,
  fromKey,
  to,
  toKey,
  contentType,
  expectedSha256,
}: CopyObjectInput): Promise<{ sha256: string; size: number }> => {
  const info = await from.head(fromKey);
  if (!info) {
    throw new ObjectNotFoundError(fromKey);
  }
  const hash = createHash('sha256');
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const source = await from.getStream(fromKey);
  source.on('error', (error) => hashing.destroy(error));
  await to.put(toKey, source.pipe(hashing), { contentType, contentLength: info.size });
  const sourceSha256 = hash.digest('hex');
  if (expectedSha256 && expectedSha256 !== sourceSha256) {
    throw new ChecksumMismatchError(fromKey, 'source', expectedSha256, sourceSha256);
  }
  const copied = await digestStream(await to.getStream(toKey));
  if (copied.sha256 !== sourceSha256) {
    throw new ChecksumMismatchError(toKey, 'destination', sourceSha256, copied.sha256);
  }
  return { sha256: sourceSha256, size: copied.size };
};
