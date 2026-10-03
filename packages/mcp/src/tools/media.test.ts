import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveMediaPath } from './media.js';

describe('resolveMediaPath', () => {
  let base: string;
  let root: string;
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'shapio-mcp-'));
    root = join(base, 'root');
    await mkdir(join(root, 'img'), { recursive: true });
    await writeFile(join(root, 'img', 'a.png'), 'x');
    await writeFile(join(base, 'secret.txt'), 'x');
    await symlink(join(base, 'secret.txt'), join(root, 'link.txt'));
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts files under the root, relative or absolute', async () => {
    await expect(resolveMediaPath(root, 'img/a.png')).resolves.toMatch(/img[/\\]a\.png$/);
    await expect(resolveMediaPath(root, join(root, 'img', 'a.png'))).resolves.toMatch(/a\.png$/);
  });

  it('refuses paths and symlinks that leave the root, the root itself and missing files', async () => {
    await expect(resolveMediaPath(root, '../secret.txt')).rejects.toThrow(/only reads files under/);
    await expect(resolveMediaPath(root, 'link.txt')).rejects.toThrow(/only reads files under/);
    await expect(resolveMediaPath(root, '.')).rejects.toThrow(/only reads files under/);
    await expect(resolveMediaPath(root, 'nope.png')).rejects.toThrow(/No file/);
  });
});
