import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { endTar, isTar, listTar, writeTarEntry } from './tar.js';

describe('tar', () => {
  const dirs: string[] = [];
  afterAll(async () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

  it('writes entries that list back with their offsets and sizes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shapio-tar-'));
    dirs.push(dir);
    const path = join(dir, 'a.tar');
    const output = createWriteStream(path);
    const files: Array<[string, Buffer]> = [
      ['bundle.ndjson', Buffer.from('{"type":"header"}\n')],
      ['media/one', Buffer.alloc(1000, 7)],
      ['media/empty', Buffer.alloc(0)],
    ];
    for (const [name, data] of files) {
      await writeTarEntry(output, name, data.length, Readable.from([data]));
    }
    await endTar(output);
    await new Promise((resolve) => output.end(resolve));

    expect(await isTar(path)).toBe(true);
    const entries = await listTar(path);
    const bytes = await readFile(path);
    for (const [name, data] of files) {
      const entry = entries.get(name);
      expect(entry?.size).toBe(data.length);
      expect(bytes.subarray(entry?.offset, (entry?.offset ?? 0) + data.length).equals(data)).toBe(true);
    }
  });

  it('refuses content that does not match its declared size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shapio-tar-'));
    dirs.push(dir);
    const output = createWriteStream(join(dir, 'b.tar'));
    await expect(writeTarEntry(output, 'x', 5, Readable.from([Buffer.from('abc')]))).rejects.toThrow(
      'got 3 bytes, expected 5',
    );
    output.destroy();
  });
});
