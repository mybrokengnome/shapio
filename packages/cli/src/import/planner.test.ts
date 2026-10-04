import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLockFile } from '@shapio/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalFiles } from '../commands/schema/files.js';
import { readImportMap, writeImportMap } from './importMap.js';
import { resolveMapSite } from './mapper.js';
import { writePlan } from './planner.js';
import { wordpressSource } from './wordpress/adapter.js';
import { readWxr } from './wordpress/wxr.js';

const FIXTURE = fileURLToPath(new URL('../../test/fixtures/wxr/blog.xml', import.meta.url));
const INFO = { kind: 'wordpress' as const, path: FIXTURE, sha256: 'abc' };

describe('writePlan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-plan-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes valid pull-format files, an empty lock and the import map', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    await writePlan(dir, source, INFO);
    const files = await readLocalFiles(join(dir, 'schema'));
    expect(files.map((file) => file.path.slice(dir.length))).toEqual([
      '/schema/models/author.json',
      '/schema/models/category.json',
      '/schema/models/page.json',
      '/schema/models/post.json',
      '/schema/models/tag.json',
    ]);
    expect(files.every((file) => file.id !== undefined)).toBe(true);
    const lock = parseLockFile(await readFile(join(dir, 'schema-lock.json'), 'utf8'));
    expect(lock).toMatchObject({ schemaVersion: 0, definitions: {} });

    const map = await readImportMap(dir);
    const post = JSON.parse(await readFile(join(dir, 'schema/models/post.json'), 'utf8')) as {
      id: string;
      draftAndPublish: boolean;
      pluralApiKey: string;
      fields: Array<{ id: string; apiKey: string; settings: Record<string, unknown> }>;
    };
    expect(post).toMatchObject({
      id: map.definitions.post?.id,
      draftAndPublish: true,
      pluralApiKey: 'posts',
    });
    const author = post.fields.find((field) => field.apiKey === 'author');
    expect(author?.id).toBe(map.definitions.post?.fields.author);
    expect(author?.settings.target).toBe(map.definitions.author?.id);
    const slug = post.fields.find((field) => field.apiKey === 'slug');
    expect(slug?.settings.sourceFieldId).toBe(map.definitions.post?.fields.title);
    expect(map.entries['post:20']).toEqual({
      definition: 'post',
      title: 'On the Analytical Engine',
      locales: [null],
      published: [null],
    });
    expect(map.entries['post:21']?.published).toEqual([]);
    expect(map.media['attachment:10']).toEqual({
      filename: 'engine.png',
      url: 'http://blog.test/wp-content/uploads/2024/05/engine.png',
    });
  });

  it("with --site, writes the planned definitions into that site's folder", async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    await writePlan(dir, source, INFO, { site: 'blog' });
    const files = await readLocalFiles(join(dir, 'schema'));
    expect(files.map((file) => [file.path.slice(dir.length), file.site])).toContainEqual([
      '/schema/sites/blog/models/post.json',
      'blog',
    ]);
    expect(files.every((file) => file.site === 'blog')).toBe(true);
    expect((await readImportMap(dir)).site).toBe('blog');
  });

  it('--map uses the planned site unless --site names it, and refuses another one', () => {
    expect(resolveMapSite({ site: 'blog' }, undefined)).toBe('blog');
    expect(resolveMapSite({ site: 'blog' }, 'blog')).toBe('blog');
    expect(() => resolveMapSite({ site: 'blog' }, 'shop')).toThrow(
      'This import was planned for site "blog", not "shop"',
    );
    // A plan without a site (or written before plans recorded one): --site decides, as before.
    expect(resolveMapSite({ site: null }, 'shop')).toBe('shop');
    expect(resolveMapSite({}, undefined)).toBeUndefined();
  });

  it('replaces a plan only with force, and never one whose import started', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    await writePlan(dir, source, INFO);
    await expect(writePlan(dir, source, INFO)).rejects.toThrow(/already holds a plan/);
    const first = await readImportMap(dir);
    await writePlan(dir, source, INFO, { force: true });
    const second = await readImportMap(dir);
    expect(second.definitions.post?.id).not.toBe(first.definitions.post?.id);
    second.state.entries['author:ada'] = { entryId: 'x', locales: [''], complete: true };
    await writeImportMap(dir, second);
    await expect(writePlan(dir, source, INFO, { force: true })).rejects.toThrow(/has started/);
  });
});
