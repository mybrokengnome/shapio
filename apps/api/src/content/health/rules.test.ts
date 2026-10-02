import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../schema/snapshot.js';
import { resolveModel } from '../model.js';
import { imageUsesOf } from './imageUses.js';
import { evaluateHealth, type HealthInputs, type HeadSnapshot } from './rules.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-02T12:00:00.000Z');

const figure = normalizeDefinition({
  id: id(100),
  kind: 'component',
  apiKey: 'figure',
  label: 'Figure',
  fields: [{ id: id(101), apiKey: 'image', label: 'Image', type: 'media' }],
}) as ComponentDefinition;

const article = normalizeDefinition({
  id: id(1),
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  localized: true,
  fields: [
    { id: id(2), apiKey: 'title', label: 'Title', type: 'string', required: true, localized: true },
    { id: id(3), apiKey: 'cover', label: 'Cover', type: 'media' },
    { id: id(4), apiKey: 'body', label: 'Body', type: 'richtext', localized: true },
    {
      id: id(5),
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [id(100)] },
    },
    {
      id: id(6),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: id(1), cardinality: 'one' },
    },
  ],
}) as ModelDefinition;

const snapshot = buildSnapshot(
  1,
  [article, figure].map((definition, index) => ({
    definition,
    version: 1,
    revisionId: id(900 + index),
    hash: 'x',
    activatedAt: NOW,
  })),
  [
    { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
    { code: 'fr', label: 'French', isDefault: false, fallbacks: ['en'] },
  ],
);
const model = resolveModel(snapshot, 'article');

const image = (mediaId: string, alt: string | null) => ({
  type: 'image',
  attrs: { mediaId, alt, title: null },
});
const body = (...content: unknown[]) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content },
});

const head = (overrides: Partial<HeadSnapshot> = {}): HeadSnapshot => ({
  locale: 'en',
  data: { [id(2)]: 'Hello' },
  revisionId: 'r1',
  updatedAt: NOW,
  autosavedAt: null,
  ...overrides,
});

const inputs = (overrides: Partial<HealthInputs> = {}): HealthInputs => ({
  model,
  locales: ['en', 'fr'],
  drafts: [head(), head({ locale: 'fr' })],
  published: [],
  issuesByLocale: new Map(),
  assets: new Map(),
  edges: [],
  uniqueConflicts: [],
  now: NOW,
  staleDays: 14,
  ...overrides,
});

const rulesOf = (found: ReturnType<typeof evaluateHealth>) =>
  found.map((f) => `${f.locale} ${f.rule} ${f.subject}`);

describe('imageUsesOf', () => {
  it('finds media values and rich-text images, also inside zone items, with per-use alt text', () => {
    const data = {
      [id(3)]: 'a',
      [id(4)]: body(image('b', 'A bird'), { type: 'paragraph' }, image('b', null)),
      [id(5)]: [{ __component: id(100), [id(101)]: 'c' }],
    };
    expect(imageUsesOf(model, data)).toEqual([
      { path: '/cover', assetId: 'a', alt: null, occurrence: 0 },
      { path: '/body', assetId: 'b', alt: 'A bird', occurrence: 0 },
      { path: '/body', assetId: 'b', alt: null, occurrence: 1 },
      { path: '/sections/0/image', assetId: 'c', alt: null, occurrence: 0 },
    ]);
  });
});

describe('evaluateHealth', () => {
  it('reports nothing for a complete entry', () => {
    expect(evaluateHealth(inputs())).toEqual([]);
  });

  it('reports empty required fields from the validator issues', () => {
    const found = evaluateHealth(
      inputs({
        issuesByLocale: new Map([['fr', [{ path: '/title', code: 'REQUIRED', message: 'required' }]]]),
      }),
    );
    expect(rulesOf(found)).toEqual(['fr requiredEmpty /title']);
    expect(found[0]).toMatchObject({ path: '/title', severity: 'warning' });
  });

  it('reports images without alt text in the use or the library, and ignores other files', () => {
    const data = {
      [id(2)]: 'Hi',
      [id(3)]: 'cover',
      [id(4)]: body(image('inline', null), image('described', 'Ok')),
    };
    const assets = new Map([
      ['cover', { alt: '', mimeType: 'image/png' }],
      ['inline', { alt: '  ', mimeType: 'image/jpeg' }],
      ['described', { alt: '', mimeType: 'image/png' }],
    ]);
    expect(rulesOf(evaluateHealth(inputs({ drafts: [head({ data })], locales: ['en'], assets })))).toEqual([
      'en altMissing /cover#cover#0',
      'en altMissing /body#inline#0',
    ]);
    const withLibraryAlt = new Map(
      [...assets].map(([key]) => [key, { alt: 'Library', mimeType: 'image/png' }]),
    );
    expect(
      evaluateHealth(inputs({ drafts: [head({ data })], locales: ['en'], assets: withLibraryAlt })),
    ).toEqual([]);
    const pdf = new Map([['cover', { alt: '', mimeType: 'application/pdf' }]]);
    expect(
      evaluateHealth(
        inputs({ drafts: [head({ data: { [id(3)]: 'cover' } })], locales: ['en'], assets: pdf }),
      ),
    ).toEqual([]);
  });

  it('reports configured locales the entry has no version in', () => {
    expect(rulesOf(evaluateHealth(inputs({ drafts: [head()] })))).toEqual(['fr localeMissing ']);
  });

  it('reports links to deleted entries and to entries without a published version', () => {
    const edges = [
      { locale: 'en', fieldId: id(6), targetEntryId: 'gone' },
      {
        locale: 'en',
        fieldId: id(6),
        targetEntryId: 'draft-only',
        target: { modelId: id(1), publishedLocales: ['fr'], alwaysLive: false, localized: true },
      },
      {
        locale: 'en',
        fieldId: id(6),
        targetEntryId: 'live',
        target: { modelId: id(1), publishedLocales: ['en'], alwaysLive: false, localized: true },
      },
      {
        locale: 'en',
        fieldId: id(6),
        targetEntryId: 'settings',
        target: { modelId: id(1), publishedLocales: [], alwaysLive: true, localized: false },
      },
    ];
    expect(rulesOf(evaluateHealth(inputs({ edges })))).toEqual([
      `en relationMissing ${id(6)}:gone`,
      `en relationUnpublished ${id(6)}:draft-only`,
    ]);
  });

  it('reports unique values another published entry holds', () => {
    expect(rulesOf(evaluateHealth(inputs({ uniqueConflicts: [{ locale: 'fr', fieldId: id(2) }] })))).toEqual([
      `fr uniqueConflict ${id(2)}`,
    ]);
  });

  it('reports stale drafts and old unpublished changes', () => {
    const old = new Date(NOW.getTime() - 20 * DAY);
    const found = evaluateHealth(
      inputs({
        drafts: [head({ updatedAt: old }), head({ locale: 'fr', updatedAt: old, revisionId: 'r2' })],
        published: [head({ updatedAt: old }), head({ locale: 'fr', updatedAt: old })],
      }),
    );
    expect(rulesOf(found)).toEqual(['fr unpublishedChanges ']);
    expect(found[0]?.params).toEqual({ days: 20 });
    expect(rulesOf(evaluateHealth(inputs({ drafts: [head({ updatedAt: old })], locales: ['en'] })))).toEqual([
      'en staleDraft ',
    ]);
  });
});
