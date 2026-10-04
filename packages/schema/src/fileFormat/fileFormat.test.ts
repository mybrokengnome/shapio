import { describe, expect, it } from 'vitest';
import { field, id, model } from '../testing/fixtures.js';
import { parseDefinition } from '../validators/parse.js';
import { canonicalJson, serializeDefinition } from './canonical.js';
import { hashDefinition, sha256 } from './hash.js';
import { schemaFilePath, scopeOfSchemaFilePath } from './layout.js';
import {
  LOCK_FILE_FORMAT_VERSION,
  LockFileError,
  lockCoversSite,
  lockEntriesForSite,
  mergePulledLock,
  parseLockFile,
  serializeLockFile,
  upgradeLockFile,
  type LockFile,
} from './lockFile.js';

describe('canonicalJson', () => {
  it('sorts object keys at every level, keeps array order, ends with a newline', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null }, u: undefined })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      1\n    ]\n  },\n  "b": 1\n}\n',
    );
  });
});

describe('definition files', () => {
  const definition = model({
    id: id(1),
    fields: [field({ apiKey: 'zeta', id: id(3) }), field({ apiKey: 'alpha', id: id(2) })],
  });

  it('keeps field order (the form order) while sorting keys', () => {
    const text = serializeDefinition(definition);
    expect(text.indexOf('"zeta"')).toBeLessThan(text.indexOf('"alpha"'));
    expect(text.indexOf('"apiKey"')).toBeLessThan(text.indexOf('"display"'));
  });

  it('round-trips: parse(serialize(d)) serializes and hashes identically', async () => {
    const text = serializeDefinition(definition);
    const reparsed = parseDefinition(JSON.parse(text));
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(serializeDefinition(reparsed.definition)).toBe(text);
      expect(await hashDefinition(reparsed.definition)).toBe(await hashDefinition(definition));
    }
  });

  it('hashes a minimal hand-written file the same as its normalized form', async () => {
    const minimal = {
      id: id(1),
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ id: id(2), apiKey: 'title', label: 'Title', type: 'string' }],
    };
    const explicit = {
      ...minimal,
      localized: false,
      draftAndPublish: true,
      fields: [{ ...minimal.fields[0], public: true, required: false }],
    };
    const a = parseDefinition(minimal);
    const b = parseDefinition(explicit);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(await hashDefinition(a.definition)).toBe(await hashDefinition(b.definition));
    }
  });

  it('produces sha256-prefixed hex hashes', async () => {
    expect(await sha256('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('lock file', () => {
  const lock: LockFile = {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    schemaVersion: 7,
    definitions: { [id(1)]: { kind: 'collection', apiKey: 'page', version: 3, hash: 'sha256:abc' } },
  };

  it('round-trips through its canonical serialization', () => {
    expect(parseLockFile(serializeLockFile(lock))).toEqual(lock);
  });

  it('rejects malformed lock files with a clear error', () => {
    expect(() => parseLockFile('{')).toThrow(LockFileError);
    expect(() => parseLockFile(JSON.stringify({ ...lock, formatVersion: 3 }))).toThrow(/formatVersion/);
    expect(() => parseLockFile(JSON.stringify({ ...lock, extra: true }))).toThrow(/unknown property: extra/);
  });
});

describe('lock file format 2 (per-site schemas)', () => {
  const v1: LockFile = {
    formatVersion: 1,
    schemaVersion: 4,
    definitions: { [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1' } },
  };
  const v2: LockFile = {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    schemaVersion: 9,
    sites: ['blog', 'shop'],
    definitions: {
      [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1', site: null },
      [id(2)]: { kind: 'collection', apiKey: 'post', version: 2, hash: 'h2', site: 'blog' },
      [id(3)]: { kind: 'collection', apiKey: 'post', version: 1, hash: 'h3', site: 'shop' },
    },
  };

  it('still reads format 1 and upgrades it to every definition shared, covering no site', () => {
    expect(parseLockFile(serializeLockFile(v1))).toEqual(v1);
    expect(upgradeLockFile(v1)).toEqual({
      formatVersion: 2,
      schemaVersion: 4,
      sites: [],
      definitions: { [id(1)]: { kind: 'collection', apiKey: 'page', version: 1, hash: 'h1', site: null } },
    });
  });

  it('round-trips format 2 and narrows entries to one site and the shared ones', () => {
    expect(parseLockFile(serializeLockFile(v2))).toEqual(v2);
    expect(Object.keys(lockEntriesForSite(v2, 'blog'))).toEqual([id(1), id(2)]);
    expect(Object.keys(lockEntriesForSite(v2, null))).toEqual([id(1)]);
  });

  it('covers a site when it lists it, or lists none (a shared-only or format 1 tree)', () => {
    expect(lockCoversSite(v2, 'blog')).toBe(true);
    expect(lockCoversSite(v2, 'docs')).toBe(false);
    expect(lockCoversSite(v1, 'docs')).toBe(true);
  });

  const exported = (n: number, apiKey: string, site: string | null) => ({
    definition: model({ id: id(n), apiKey }),
    version: 5,
    hash: `p${n}`,
    site,
  });

  it("a pull replaces the shared entries and the site's own, and keeps another site's", () => {
    const merged = mergePulledLock(v2, {
      schemaVersion: 12,
      siteKey: 'blog',
      // page (1) changed, blog's post (2) was deleted, a new blog model (4) appeared.
      definitions: [exported(1, 'page', null), exported(4, 'news', 'blog')],
    });
    expect(merged).toEqual({
      formatVersion: 2,
      schemaVersion: 12,
      sites: ['blog', 'shop'],
      definitions: {
        [id(1)]: { kind: 'collection', apiKey: 'page', version: 5, hash: 'p1', site: null },
        [id(3)]: { kind: 'collection', apiKey: 'post', version: 1, hash: 'h3', site: 'shop' },
        [id(4)]: { kind: 'collection', apiKey: 'news', version: 5, hash: 'p4', site: 'blog' },
      },
    });
  });

  it('pulling a second site into one tree keeps the first, and covers both', () => {
    const first = mergePulledLock(undefined, {
      schemaVersion: 1,
      siteKey: 'shop',
      definitions: [exported(1, 'page', null), exported(3, 'post', 'shop')],
    });
    const second = mergePulledLock(first, {
      schemaVersion: 2,
      siteKey: 'blog',
      definitions: [exported(1, 'page', null), exported(2, 'post', 'blog')],
    });
    expect(second.sites).toEqual(['blog', 'shop']);
    expect(Object.keys(second.definitions).sort()).toEqual([id(1), id(2), id(3)]);
  });

  it('upgrades a format 1 lock on pull, and a definition that moved scope keeps one entry', () => {
    const merged = mergePulledLock(v1, {
      schemaVersion: 7,
      siteKey: 'blog',
      definitions: [exported(1, 'page', 'blog')],
    });
    expect(merged.formatVersion).toBe(2);
    expect(merged.sites).toEqual(['blog']);
    expect(merged.definitions).toEqual({
      [id(1)]: { kind: 'collection', apiKey: 'page', version: 5, hash: 'p1', site: 'blog' },
    });
  });
});

describe('schema file layout', () => {
  it("puts shared definitions at the top and a site's own under sites/<key>/", () => {
    expect(schemaFilePath({ kind: 'collection', apiKey: 'post' }, null)).toBe('models/post.json');
    expect(schemaFilePath({ kind: 'component', apiKey: 'hero' }, 'blog')).toBe(
      'sites/blog/components/hero.json',
    );
  });

  it('reads a path back to its scope, and nothing else as a schema file', () => {
    expect(scopeOfSchemaFilePath('models/post.json')).toEqual({ site: null });
    expect(scopeOfSchemaFilePath('sites/blog/models/post.json')).toEqual({ site: 'blog' });
    expect(scopeOfSchemaFilePath('sites/blog/notes.json')).toBeUndefined();
    expect(scopeOfSchemaFilePath('models/readme.md')).toBeUndefined();
  });
});
