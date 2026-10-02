import { open, type FileHandle } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';

/**
 * A minimal POSIX ustar writer and reader for `shapio export --with-media` bundles: `bundle.ndjson` plus
 * `media/<asset id>` files. Regular files only, names under 100 bytes, sizes under 8 GiB. Kept here (no
 * dependency) because the CLI only ever writes and reads its own archives.
 */
const BLOCK = 512;
const MAX_SIZE = 0o77777777777;

export const BUNDLE_ENTRY = 'bundle.ndjson';
export const mediaEntryName = (assetId: string) => `media/${assetId}`;

const writeString = (buffer: Buffer, offset: number, length: number, value: string) => {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
};

const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, '0')}\0`;

export const tarHeader = (name: string, size: number, mtime = Math.floor(Date.now() / 1000)): Buffer => {
  if (Buffer.byteLength(name) >= 100) {
    throw new Error(`Archive entry name too long: ${name}`);
  }
  if (size > MAX_SIZE) {
    throw new Error(`Archive entry too large: ${name}`);
  }
  const header = Buffer.alloc(BLOCK);
  writeString(header, 0, 100, name);
  writeString(header, 100, 8, '0000644\0');
  writeString(header, 108, 8, '0000000\0');
  writeString(header, 116, 8, '0000000\0');
  writeString(header, 124, 12, octal(size, 12));
  writeString(header, 136, 12, octal(mtime, 12));
  writeString(header, 148, 8, '        ');
  header[156] = 0x30; // regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  writeString(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return header;
};

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

const write = (output: Writable, chunk: Buffer) =>
  new Promise<void>((resolve, reject) => {
    output.write(chunk, (error) => (error ? reject(error) : resolve()));
  });

/** Writes one entry: header, exactly `size` bytes from `content`, then padding. */
export const writeTarEntry = async (output: Writable, name: string, size: number, content: Readable) => {
  await write(output, tarHeader(name, size));
  let written = 0;
  for await (const chunk of content) {
    const buffer = chunk as Buffer;
    written += buffer.length;
    if (written > size) {
      throw new Error(`${name}: more data than its declared ${size} bytes`);
    }
    await write(output, buffer);
  }
  if (written !== size) {
    throw new Error(`${name}: got ${written} bytes, expected ${size}`);
  }
  await write(output, padding(size));
};

export const endTar = (output: Writable) => write(output, Buffer.alloc(BLOCK * 2));

export type TarEntry = { name: string; offset: number; size: number };

const readOctal = (buffer: Buffer, offset: number, length: number) =>
  parseInt(
    buffer
      .toString('utf8', offset, offset + length)
      .replace(/\0.*$/, '')
      .trim() || '0',
    8,
  );

const readName = (buffer: Buffer) => buffer.toString('utf8', 0, 100).replace(/\0.*$/, '');

/** Whether a file starts with a ustar header. */
export const isTar = async (path: string): Promise<boolean> => {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(BLOCK);
    const { bytesRead } = await handle.read(header, 0, BLOCK, 0);
    return bytesRead === BLOCK && header.toString('utf8', 257, 262) === 'ustar';
  } finally {
    await handle.close();
  }
};

/** The archive's table of contents: name, data offset and size of every regular file. */
export const listTar = async (path: string): Promise<Map<string, TarEntry>> => {
  const handle: FileHandle = await open(path, 'r');
  const entries = new Map<string, TarEntry>();
  try {
    const header = Buffer.alloc(BLOCK);
    for (let position = 0; ;) {
      const { bytesRead } = await handle.read(header, 0, BLOCK, position);
      if (bytesRead < BLOCK || header.every((byte) => byte === 0)) {
        break;
      }
      const name = readName(header);
      const size = readOctal(header, 124, 12);
      const type = String.fromCharCode(header[156] ?? 0x30);
      if (type === '0' || type === '\0') {
        entries.set(name, { name, offset: position + BLOCK, size });
      }
      position += BLOCK + size + ((BLOCK - (size % BLOCK)) % BLOCK);
    }
  } finally {
    await handle.close();
  }
  return entries;
};
