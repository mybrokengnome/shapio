import { createDecipheriv, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import type { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extract } from 'tar';

/**
 * Unpacks a `strapi export` archive (Strapi v5, `@strapi/data-transfer`'s file format): a tar, gzip-compressed
 * unless exported with `--no-compress`, and encrypted unless exported with `--no-encrypt`. Encrypted archives
 * use Strapi's default cipher, AES-128-ECB with the key derived by `scrypt(key, '', 16)`. Entries are extracted
 * with node-tar's defaults, which refuse absolute paths and `..`.
 */
const GZIP_MAGIC = [0x1f, 0x8b];
const USTAR_OFFSET = 257;

export class EncryptedExportError extends Error {
  constructor(path: string) {
    super(
      `${path} is encrypted: pass the key it was exported with (--key), or export again with --no-encrypt`,
    );
    this.name = 'EncryptedExportError';
  }
}

const readHead = async (path: string) => {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(USTAR_OFFSET + 5);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/** A gzip stream or a plain tar: anything else is taken as encrypted. */
const isReadableArchive = (head: Buffer) =>
  (head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]) ||
  head.subarray(USTAR_OFFSET, USTAR_OFFSET + 5).toString('latin1') === 'ustar';

export const strapiDecipher = (key: string): Transform =>
  createDecipheriv('aes-128-ecb', scryptSync(key, '', 16), null);

/** Extracts the archive into `dir` (emptied first). */
export const extractStrapiExport = async (path: string, dir: string, key?: string): Promise<void> => {
  const head = await readHead(path);
  if (!key && !isReadableArchive(head)) {
    throw new EncryptedExportError(path);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const unpack = extract({
    cwd: dir,
    strict: true,
    filter: (_path, entry) => !('type' in entry) || entry.type === 'File' || entry.type === 'Directory',
  });
  try {
    await (key
      ? pipeline(createReadStream(path), strapiDecipher(key), unpack)
      : pipeline(createReadStream(path), unpack));
  } catch (error) {
    throw new Error(
      `${path} could not be unpacked${key ? ' (is the key right?)' : ''}: ${(error as Error).message}`,
      { cause: error },
    );
  }
};
