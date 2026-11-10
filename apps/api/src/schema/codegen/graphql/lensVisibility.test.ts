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
  it('shows admin callers the client version whole', () => {
    expect(lensVisibility(FULL_VISIBILITY, clientView, current)).toBe(FULL_VISIBILITY);
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

  it('keeps models deleted since for a caller who reads something, never models it may not read today', () => {
    const lens = lensVisibility(delivery({ [ARTICLE]: {} }), clientView, current);
    expect([...(lens.models?.keys() ?? [])].sort()).toEqual([ARTICLE, GADGET].sort());
    const writeOnly = lensVisibility(delivery({ [ARTICLE]: { readable: false } }), clientView, current);
    expect(writeOnly.models?.size).toBe(0);
  });
});
