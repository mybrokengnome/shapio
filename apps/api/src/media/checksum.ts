import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export type StreamDigest = { sha256: string; size: number };

export const sha256Of = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** Reads a stream to the end, hashing it without buffering. */
export const digestStream = async (stream: Readable): Promise<StreamDigest> => {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    size += buffer.length;
  }
  return { sha256: hash.digest('hex'), size };
};

/** Reads a whole stream into memory, failing past `maxBytes` (images for sharp; bounded by the upload limit). */
export const readStream = async (stream: Readable, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) {
      stream.destroy();
      throw new Error(`Stream is larger than ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};
