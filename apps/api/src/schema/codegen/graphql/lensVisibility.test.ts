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
const HERO = uuid(4);
const OLD_HERO = uuid(5);
const TITLE = uuid(11);
const SECRET = uuid(12);
const INTERNAL = uuid(13);
const GONE = uuid(14);
const BODY = uuid(15);
const HERO_FIELD = uuid(16);
const OLD_HERO_FIELD = uuid(17);
const HEADING = uuid(21);
const NOTE = uuid(22);
const REMOVED = uuid(23);
const QUOTE = uuid(31);

const string = (id: string, apiKey: string, isPublic = true) => ({
  id,
  apiKey,
  label: apiKey,
  type: 'string' as const,
  public: isPublic,
});

/**
 * The client's version: an article with public title, body and secret, a private note, a field removed since,
 * and two components (one gone since).
 */
const clientView = buildSnapshot(
  3,
  [
    define({
      id: HERO,
      kind: 'component',
      apiKey: 'hero',
      label: 'Hero',
      fields: [string(HEADING, 'heading'), string(NOTE, 'note'), string(REMOVED, 'removed')],
    }),
    define({
      id: OLD_HERO,
      kind: 'component',
      apiKey: 'oldHero',
      label: 'Old hero',
      fields: [string(QUOTE, 'quote')],
    }),
    define({
      id: ARTICLE,
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        string(TITLE, 'title'),
        string(BODY, 'body'),
        string(SECRET, 'secret'),
        string(INTERNAL, 'internal', false),
        string(GONE, 'gone'),
        { id: HERO_FIELD, apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: HERO } },
        {
          id: OLD_HERO_FIELD,
          apiKey: 'oldHero',
          label: 'Old',
          type: 'component',
          settings: { component: OLD_HERO },
        },
      ],
    }),
    define({
      id: GADGET,
      kind: 'collection',
      apiKey: 'gadget',
      label: 'Gadget',
      fields: [string(uuid(41), 'name')],
    }),
    define({ id: HIDDEN, kind: 'collection', apiKey: 'hidden', label: 'Hidden', fields: [] }),
  ].map(active),
  [],
);
/** Today: renamed, the secret and the hero note private, a field and a component gone, the gadget deleted. */
const current = buildSnapshot(
  9,
  [
    define({
      id: HERO,
      kind: 'component',
      apiKey: 'hero',
      label: 'Hero',
      fields: [string(HEADING, 'title'), string(NOTE, 'note', false)],
    }),
    define({
      id: ARTICLE,
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [
        string(TITLE, 'headline'),
        string(BODY, 'body'),
        string(SECRET, 'secret', false),
        string(INTERNAL, 'internal', false),
        { id: HERO_FIELD, apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: HERO } },
      ],
    }),
    define({ id: HIDDEN, kind: 'collection', apiKey: 'hidden', label: 'Hidden', fields: [] }),
  ].map(active),
  [],
);

const ids = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort();

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

  it('names only what a field-restricted grant reads today: no other public field, nothing removed', () => {
    const lens = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE]) } }),
      clientView,
      current,
    );
    expect(ids(lens.models?.get(ARTICLE)?.readFields)).toEqual([TITLE]);
    expect(ids(lens.componentFieldIds?.get(HERO))).toEqual([HEADING]);
    expect(ids(lens.componentFieldIds?.get(OLD_HERO))).toEqual([]);
    expect(lens.key).toMatch(/^lens:/);
  });

  it('decides "unrestricted" by the grant\'s shape, never by what its mask covers today', () => {
    // Granted the title, body and hero by name: that is every public field today, yet a named grant.
    const named = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE, BODY, HERO_FIELD]), unrestrictedRead: false } }),
      clientView,
      current,
    );
    expect(ids(named.models?.get(ARTICLE)?.readFields)).toEqual([TITLE, BODY, HERO_FIELD].sort());
    expect(ids(named.componentFieldIds?.get(HERO))).toEqual([HEADING]);
    expect(ids(named.componentFieldIds?.get(OLD_HERO))).toEqual([]);
  });

  it('names removed public fields for an unrestricted grant, never fields hidden today', () => {
    // Today's wildcard grant: every public field of today's model (the secret is private now).
    const lens = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE, BODY, HERO_FIELD]), unrestrictedRead: true } }),
      clientView,
      current,
    );
    expect(ids(lens.models?.get(ARTICLE)?.readFields)).toEqual(
      [TITLE, BODY, GONE, HERO_FIELD, OLD_HERO_FIELD].sort(),
    );
    expect(ids(lens.componentFieldIds?.get(HERO))).toEqual([HEADING, REMOVED].sort());
    expect(ids(lens.componentFieldIds?.get(OLD_HERO))).toEqual([QUOTE]);
    // A private field is named only when today's grant names it.
    const granted = lensVisibility(
      delivery({
        [ARTICLE]: { readFields: new Set([TITLE, BODY, HERO_FIELD, INTERNAL]), unrestrictedRead: true },
      }),
      clientView,
      current,
    );
    expect(granted.models?.get(ARTICLE)?.readFields.has(INTERNAL)).toBe(true);
    expect(granted.models?.get(ARTICLE)?.readFields.has(SECRET)).toBe(false);
    expect(granted.key).not.toBe(lens.key);
  });

  it("names inputs by today's write mask, removed fields only for an unrestricted one", () => {
    const restricted = lensVisibility(
      delivery({ [ARTICLE]: { writeFields: new Set([TITLE, INTERNAL]) } }),
      clientView,
      current,
    );
    expect(ids(restricted.models?.get(ARTICLE)?.writeFields)).toEqual([TITLE, INTERNAL].sort());
    const open = lensVisibility(
      delivery({ [ARTICLE]: { writeFields: new Set([TITLE, BODY, HERO_FIELD]), unrestrictedWrite: true } }),
      clientView,
      current,
    );
    expect(ids(open.models?.get(ARTICLE)?.writeFields)).toEqual(
      [TITLE, BODY, GONE, HERO_FIELD, OLD_HERO_FIELD].sort(),
    );
  });

  it("leaves models deleted since out of a delivery caller's schema; others are as today", () => {
    const lens = lensVisibility(
      delivery({ [ARTICLE]: { readFields: new Set([TITLE]) } }),
      clientView,
      current,
    );
    expect([...(lens.models?.keys() ?? [])]).toEqual([ARTICLE]);
    expect(lens.readOnly).toBeUndefined();
    const writeOnly = lensVisibility(
      delivery({ [ARTICLE]: { readable: false, writeFields: new Set([TITLE]) } }),
      clientView,
      current,
    );
    expect(writeOnly.models?.get(ARTICLE)).toMatchObject({ readable: false });
    expect(writeOnly.models?.get(ARTICLE)?.readFields.size).toBe(0);
  });
});
