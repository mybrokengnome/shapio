import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LockFile, SchemaDefinition } from '@shapio/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definitionPath, readLocalFiles, writeDefinitionFile, type LocalFile } from './files.js';
import {
  baseForSite,
  coverSiteIfHeld,
  editedFilesForSite,
  filesForSite,
  scopesOf,
  staleFilesAfterPull,
} from './siteTree.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (path: string, site: string | null, n?: number, hash?: string): LocalFile => ({
  path,
  raw: {},
  site,
  ...(n === undefined ? {} : { id: id(n), hash: hash ?? `h${n}` }),
});

/** One tree holding the shared folders and two sites. */
const TREE = [
  file('models/page.json', null, 1),
  file('sites/blog/models/post.json', 'blog', 2),
  file('sites/shop/models/post.json', 'shop', 3),
  file('sites/shop/components/price.json', 'shop', 4),
];

const LOCK: LockFile = {
  formatVersion: 2,
  schemaVersion: 9,
  sites: ['blog', 'shop'],
  definitions: {
    [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1', site: null },
    [id(2)]: { kind: 'collection', apiKey: 'post', version: 1, hash: 'h2', site: 'blog' },
    [id(3)]: { kind: 'collection', apiKey: 'post', version: 1, hash: 'h3', site: 'shop' },
    [id(4)]: { kind: 'component', apiKey: 'price', version: 1, hash: 'h4', site: 'shop' },
  },
};

describe('one site of a schema tree', () => {
  it("an apply for a site sends the shared files and the site's, never another site's", () => {
    const sent = filesForSite(TREE, 'blog');
    expect(sent.map((candidate) => candidate.path)).toEqual([
      'models/page.json',
      'sites/blog/models/post.json',
    ]);
    expect(scopesOf(sent)).toEqual(['network', 'site']);
  });

  it("the base it sends holds no other site's IDs (so --prune cannot reach them), and keeps `sites`", () => {
    const base = baseForSite(LOCK, 'blog');
    expect(Object.keys(base.definitions)).toEqual([id(1), id(2)]);
    expect(base.sites).toEqual(['blog', 'shop']);
  });

  it('upgrades a format 1 lock to shared entries', () => {
    const v1: LockFile = {
      formatVersion: 1,
      schemaVersion: 2,
      definitions: { [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1' } },
    };
    expect(baseForSite(v1, 'blog')).toEqual({
      formatVersion: 2,
      schemaVersion: 2,
      sites: [],
      definitions: { [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1', site: null } },
    });
  });

  it("finds local edits in the site's view only", () => {
    const edited = [
      file('models/page.json', null, 1),
      file('sites/blog/models/post.json', 'blog', 2, 'changed'),
      file('sites/shop/models/post.json', 'shop', 3, 'changed'),
    ];
    expect(editedFilesForSite(edited, LOCK, 'blog').map((candidate) => candidate.path)).toEqual([
      'sites/blog/models/post.json',
    ]);
    expect(editedFilesForSite(edited, LOCK, 'docs')).toEqual([]);
    // Nothing of the view was pulled yet: a first pull adopts the instance.
    expect(editedFilesForSite(edited, { ...LOCK, definitions: {} }, 'blog')).toEqual([]);
  });

  it("a pull removes stale files in the pulled folders only, never another site's", () => {
    // blog's post was deleted on the instance; page is written again.
    const written = new Map([[id(1), 'models/page.json']]);
    expect(staleFilesAfterPull(TREE, 'blog', written).map((candidate) => candidate.path)).toEqual([
      'sites/blog/models/post.json',
    ]);
  });

  it('a pull removes the old file of a definition whose scope changed on the instance', () => {
    // shop's post became shared: it is written to models/post.json now.
    const written = new Map([
      [id(1), 'models/page.json'],
      [id(3), 'models/post.json'],
    ]);
    expect(staleFilesAfterPull(TREE, 'blog', written).map((candidate) => candidate.path)).toEqual([
      'sites/blog/models/post.json',
      'sites/shop/models/post.json',
    ]);
  });

  it('an apply covers the site only once the tree holds one of its own definitions', () => {
    const shared = baseForSite(
      { ...LOCK, sites: [], definitions: { [id(1)]: LOCK.definitions[id(1)]! } },
      'x',
    );
    expect(coverSiteIfHeld(shared, 'blog').sites).toEqual([]);
    const withBlog = baseForSite({ ...LOCK, sites: [] }, 'blog');
    expect(coverSiteIfHeld(withBlog, 'blog').sites).toEqual(['blog']);
  });
});

describe('schema files on disk', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-tree-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const definition = (n: number, apiKey: string, kind: SchemaDefinition['kind'] = 'collection') =>
    ({
      id: id(n),
      kind,
      apiKey,
      label: apiKey,
      ...(kind === 'collection' ? { pluralApiKey: `${apiKey}s`, draftAndPublish: true } : {}),
      ...(kind === 'singleton' ? { draftAndPublish: true } : {}),
      localized: false,
      fields: [],
    }) as unknown as SchemaDefinition;

  it('writes each scope into its folder and reads every folder back with its scope', async () => {
    await writeDefinitionFile(dir, definition(1, 'page'), null);
    await writeDefinitionFile(dir, definition(2, 'post'), 'blog');
    await writeDefinitionFile(dir, definition(3, 'post'), 'shop');
    // Not schema files: a stray file in sites/ and a note in a site folder.
    await writeFile(join(dir, 'sites', 'README.md'), 'notes');
    await mkdir(join(dir, 'sites', 'blog', 'drafts'), { recursive: true });
    const files = await readLocalFiles(dir);
    expect(files.map((found) => [found.path.slice(dir.length + 1), found.site])).toEqual([
      ['models/page.json', null],
      ['sites/blog/models/post.json', 'blog'],
      ['sites/shop/models/post.json', 'shop'],
    ]);
    expect(definitionPath(dir, { kind: 'component', apiKey: 'hero' }, 'blog')).toBe(
      join(dir, 'sites', 'blog', 'components', 'hero.json'),
    );
  });
});
