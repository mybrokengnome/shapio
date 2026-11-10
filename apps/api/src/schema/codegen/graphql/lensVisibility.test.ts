import { normalizeDefinition, type DefinitionInput, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, type ActiveDefinition } from '../../snapshot.js';
import { lensVisibility } from './lensVisibility.js';
import { FULL_VISIBILITY, type ModelVisibility, type SchemaVisibility } from './visibility.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: DefinitionInput & { id: string }): SchemaDefinition =>
  normalizeDefinition(input as Parameters<typeof normalizeDefinition>[0]);
const active = (definition: SchemaDefinition): ActiveDefinition => ({
  definition,
  version: 1,
  revisionId: uuid(900),
  hash: 'h',
  activatedAt: new Date(0),
  siteId: null,
});

const ARTICLE = uuid(1);
const GADGET = uuid(2);
const HIDDEN = uuid(3);
const TITLE = uuid(11);
const SECRET = uuid(12);
const INTERNAL = uuid(13);
const GONE = uuid(14);

/** The client's version: an article with a public title and secret, a private note, and a field gone since. */
const clientView = buildSnapshot(
  3,
  [
    define({
      id: ARTICLE,
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { id: TITLE, apiKey: 'title', label: 'Title', type: 'string' },
        { id: SECRET, apiKey: 'secret', label: 'Secret', type: 'string' },
        { id: INTERNAL, apiKey: 'internal', label: 'Internal', type: 'string', public: false },
        { id: GONE, apiKey: 'gone', label: 'Gone', type: 'string' },
      ],
    }),
    define({ id: GADGET, kind: 'collection', apiKey: 'gadget', label: 'Gadget', fields: [] }),
    define({ id: HIDDEN, kind: 'collection', apiKey: 'hidden', label: 'Hidden', fields: [] }),
  ].map(active),
  [],
);
/** Today: the gadget is deleted, the hidden model still exists. */
const current = buildSnapshot(
  9,
  [
    define({
      id: ARTICLE,
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [
        { id: TITLE, apiKey: 'headline', label: 'Headline', type: 'string' },
        { id: SECRET, apiKey: 'secret', label: 'Secret', type: 'string', public: false },
        { id: INTERNAL, apiKey: 'internal', label: 'Internal', type: 'string', public: false },
      ],
    }),
    define({ id: HIDDEN, kind: 'collection', apiKey: 'hidden', label: 'Hidden', fields: [] }),
  ].map(active),
  [],
);

const delivery = (models: Record<string, Partial<ModelVisibility>>): SchemaVisibility => ({
  key: 'delivery:today',
  models: new Map(
    Object.entries(models).map(([id, model]) => [
      id,
      { readable: true, readFields: new Set(), writeFields: new Set(), ...model },
    ]),
  ),
  componentFields: 'public',
});

describe('lensVisibility', () => {
  it('shows admin callers the client version whole, models deleted since without mutations', () => {
    const lens = lensVisibility(FULL_VISIBILITY, clientView, current);
    expect(lens.models).toBeNull();
    expect([...(lens.readOnly ?? [])]).toEqual([GADGET]);
    expect(lens.key).not.toBe(FULL_VISIBILITY.key);
    expect(lensVisibility(FULL_VISIBILITY, current, current)).toBe(FULL_VISIBILITY);
  });

  it("names today's writable fields and, when the caller may write, the client's public ones", () => {
    const writer = lensVisibility(
      delivery({ [ARTICLE]: { writeFields: new Set([TITLE, INTERNAL]) } }),
      clientView,
      current,
    );
    expect([...(writer.models?.get(ARTICLE)?.writeFields ?? [])].sort()).toEqual(
      [TITLE, SECRET, INTERNAL, GONE].sort(),
    );
    const reader = lensVisibility(delivery({ [ARTICLE]: {} }), clientView, current);
    expect(reader.models?.get(ARTICLE)?.writeFields.size).toBe(0);
    expect(reader.readOnly?.has(ARTICLE)).toBeFalsy();
  });

  it("names today's readable fields and the client's public ones, never its private ones", () => {
    const lens = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE]) } }),
      clientView,
      current,
    );
    expect([...(lens.models?.get(ARTICLE)?.readFields ?? [])].sort()).toEqual([TITLE, SECRET, GONE].sort());
    expect(lens.models?.get(ARTICLE)?.writeFields.size).toBe(0);
    expect(lens.key).toMatch(/^lens:/);
    const granted = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE, INTERNAL]) } }),
      clientView,
      current,
    );
    expect(granted.models?.get(ARTICLE)?.readFields.has(INTERNAL)).toBe(true);
    expect(granted.key).not.toBe(lens.key);
  });

  it('keeps models deleted since, read only, for a caller who reads something; models as today otherwise', () => {
    const lens = lensVisibility(delivery({ [ARTICLE]: {} }), clientView, current);
    expect([...(lens.models?.keys() ?? [])].sort()).toEqual([ARTICLE, GADGET].sort());
    expect([...(lens.readOnly ?? [])]).toEqual([GADGET]);
    // A model the caller may only write keeps its mutations and has no reads; nothing deleted is added.
    const writeOnly = lensVisibility(
      delivery({ [ARTICLE]: { readable: false, writeFields: new Set([TITLE]) } }),
      clientView,
      current,
    );
    expect([...(writeOnly.models?.keys() ?? [])]).toEqual([ARTICLE]);
    expect(writeOnly.models?.get(ARTICLE)).toMatchObject({ readable: false });
    expect(writeOnly.models?.get(ARTICLE)?.readFields.size).toBe(0);
    expect(writeOnly.readOnly).toBeUndefined();
  });
});
