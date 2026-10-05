import { describe, expect, it } from 'vitest';
import { hashDefinition } from '../fileFormat/hash.js';
import { field, id, model } from '../testing/fixtures.js';
import type { FieldInput, ModelDefinition } from '../types/definitions.js';
import { effectiveLayout, stripFieldsOf } from './layout.js';

const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];
const keys = (fields: readonly { apiKey: string }[] | null | undefined) => fields?.map((f) => f.apiKey);

const article = (display: ModelDefinition['display'] = {}) =>
  model({
    apiKey: 'article',
    fields: [
      field({ id: id(1), apiKey: 'title' }),
      field({ id: id(2), apiKey: 'slug', type: 'slug' }),
      field({ id: id(3), apiKey: 'cover', type: 'media' }),
      field({ id: id(4), apiKey: 'body', type: 'richtext' }),
      field({ id: id(5), apiKey: 'seo', type: 'component', settings: settings({ component: id(900) }) }),
      field({
        id: id(6),
        apiKey: 'sections',
        type: 'dynamiczone',
        settings: settings({ components: [id(900)] }),
      }),
      field({ id: id(7), apiKey: 'gallery', type: 'media', settings: settings({ multiple: true }) }),
      field({
        id: id(8),
        apiKey: 'faqs',
        type: 'component',
        settings: settings({ component: id(900), repeatable: true }),
      }),
      field({ id: id(9), apiKey: 'thumb', type: 'media' }),
      field({ id: id(10), apiKey: 'notes', type: 'richtext', deprecated: true }),
    ],
    display,
  });

describe('effectiveLayout', () => {
  it('derives defaults: every eligible field in the canvas, the first single media as the cover', () => {
    const layout = effectiveLayout(article());
    expect(layout.title?.apiKey).toBe('title');
    expect(layout.titleInline).toBe(true);
    expect(layout.cover?.apiKey).toBe('cover');
    expect(keys(layout.canvas)).toEqual(['body', 'sections', 'gallery', 'faqs']);
    expect(keys(layout.properties)).toEqual(['slug', 'seo', 'thumb']);
    expect(layout.strip).toBeNull();
  });

  it('uses configured ids in their order', () => {
    const layout = effectiveLayout(
      article({ canvasFieldIds: [id(6), id(4)], coverFieldId: id(9), stripFieldIds: [id(5), id(2)] }),
    );
    expect(layout.cover?.apiKey).toBe('thumb');
    expect(keys(layout.canvas)).toEqual(['sections', 'body']);
    expect(keys(layout.properties)).toEqual(['slug', 'cover', 'seo', 'gallery', 'faqs']);
    expect(keys(layout.strip)).toEqual(['seo', 'slug']);
  });

  it('skips deprecated, unknown and ineligible ids instead of failing', () => {
    const layout = effectiveLayout(
      article({
        canvasFieldIds: [id(10), id(99), id(1), id(4)],
        coverFieldId: id(7),
        stripFieldIds: [id(4)],
      }),
    );
    expect(keys(layout.canvas)).toEqual(['body']);
    // An ineligible configured cover falls back to the default one.
    expect(layout.cover?.apiKey).toBe('cover');
    expect(keys(layout.strip)).toEqual([]);
    expect(layout.properties.some((f) => f.apiKey === 'notes')).toBe(false);
  });

  it('places any configured field but the title in the document, in the configured order', () => {
    const layout = effectiveLayout(article({ canvasFieldIds: [id(2), id(4), id(5), id(1)] }));
    expect(keys(layout.canvas)).toEqual(['slug', 'body', 'seo']);
    expect(keys(layout.properties)).toEqual(['sections', 'gallery', 'faqs', 'thumb']);
    expect(layout.cover?.apiKey).toBe('cover');
  });

  it('moves the automatic cover to the next single image when the first one is in the document', () => {
    const layout = effectiveLayout(article({ canvasFieldIds: [id(4), id(3)] }));
    expect(keys(layout.canvas)).toEqual(['body', 'cover']);
    expect(layout.cover?.apiKey).toBe('thumb');
  });

  it('keeps the automatic title out of the document when it is listed', () => {
    const layout = effectiveLayout(article({ canvasFieldIds: [id(1), id(4)] }));
    expect(layout.title?.apiKey).toBe('title');
    expect(keys(layout.canvas)).toEqual(['body']);
  });

  it('keeps a non-text title as a read-only property', () => {
    const definition = model({
      fields: [
        field({ id: id(1), apiKey: 'handle', type: 'slug' }),
        field({ id: id(2), apiKey: 'age', type: 'integer' }),
      ],
    });
    const layout = effectiveLayout(definition);
    expect(layout.title?.apiKey).toBe('handle');
    expect(layout.titleInline).toBe(false);
    expect(keys(layout.properties)).toEqual(['handle', 'age']);
  });

  it('orders properties by groups, then field order', () => {
    const layout = effectiveLayout(
      article({ groups: [{ id: 'meta', label: 'Meta', fieldIds: [id(9), id(4), id(2)] }] }),
    );
    expect(layout.propertyGroups.map((group) => [group.label, keys(group.fields)])).toEqual([
      ['Meta', ['thumb', 'slug']],
      [undefined, ['seo']],
    ]);
    expect(keys(layout.properties)).toEqual(['thumb', 'slug', 'seo']);
  });

  it('gives a property-only model no canvas and no cover', () => {
    const layout = effectiveLayout(
      model({ fields: [field({ apiKey: 'name' }), field({ apiKey: 'bio', type: 'text' })] }),
    );
    expect(layout.canvas).toEqual([]);
    expect(layout.cover).toBeUndefined();
    expect(keys(layout.properties)).toEqual(['bio']);
  });
});

describe('stripFieldsOf', () => {
  it('shows the first non-empty properties up to the limit when not configured', () => {
    const layout = effectiveLayout(article());
    expect(keys(stripFieldsOf(layout, (f) => f.apiKey !== 'slug', 1))).toEqual(['seo']);
  });

  it('shows the configured properties whatever their values', () => {
    const layout = effectiveLayout(article({ stripFieldIds: [id(2)] }));
    expect(keys(stripFieldsOf(layout, () => false))).toEqual(['slug']);
  });
});

describe('definition hashes', () => {
  // Captured before the layout keys existed: normalize must not add layout defaults (pulled files and
  // stored hashes would all change).
  it('are unchanged for definitions without layout keys', async () => {
    const definition = model({
      id: id(1),
      apiKey: 'article',
      label: 'Article',
      fields: [
        field({ id: id(2), apiKey: 'title', type: 'string' }),
        field({ id: id(3), apiKey: 'body', type: 'richtext' }),
        field({ id: id(4), apiKey: 'cover', type: 'media' }),
      ],
      display: {
        titleFieldId: id(2),
        listFieldIds: [id(2)],
        groups: [{ id: 'main', label: 'Main', fieldIds: [id(2), id(3)] }],
      },
    });
    expect(await hashDefinition(definition)).toBe(
      'sha256:82715546da0f8b74d9194fa41351bfc7f260bda5390ea854597fbcece4dd5b2e',
    );
  });

  it('drop empty layout keys like other empty display values', async () => {
    const definition = model({
      id: id(1),
      apiKey: 'article',
      label: 'Article',
      fields: [field({ id: id(2), apiKey: 'title' })],
      display: {
        listFieldIds: [],
        titleFieldId: '',
        canvasFieldIds: [],
        coverFieldId: '',
        stripFieldIds: [],
      },
    });
    expect(definition.display).toEqual({});
    expect(await hashDefinition(definition)).toBe(
      'sha256:aff31b3668df6ad84073204b30cafb0165071b346a9987a5e01080d73785b98c',
    );
  });
});
