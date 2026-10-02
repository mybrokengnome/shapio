import { describe, expect, it } from 'vitest';
import { field, id, model } from '../testing/fixtures.js';
import { parseDefinition } from '../validators/parse.js';
import { canonicalJson, serializeDefinition } from './canonical.js';
import { hashDefinition, sha256 } from './hash.js';
import {
  LOCK_FILE_FORMAT_VERSION,
  LockFileError,
  parseLockFile,
  serializeLockFile,
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
    expect(() => parseLockFile(JSON.stringify({ ...lock, formatVersion: 2 }))).toThrow(/formatVersion/);
    expect(() => parseLockFile(JSON.stringify({ ...lock, extra: true }))).toThrow(/unknown property: extra/);
  });
});
