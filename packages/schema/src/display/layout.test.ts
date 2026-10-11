import { describe, expect, it } from 'vitest';
import { hashDefinition } from '../fileFormat/hash.js';
import { field, id, model } from '../testing/fixtures.js';
import type { FieldInput, ModelDefinition } from '../types/definitions.js';
import {
  effectiveFormLayout,
  effectiveLayout,
  entryLayoutOf,
  richTextBodyOf,
  stripFieldsOf,
} from './layout.js';

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

describe('entryLayoutOf', () => {
  it('is document unless the model says form', () => {
    expect(entryLayoutOf(article())).toBe('document');
    expect(entryLayoutOf(article({ layout: 'form' }))).toBe('form');
  });
});

describe('effectiveFormLayout', () => {
  const run = (first: number) => `ungrouped-${id(first)}`;
  const sectionsOf = (definition: ModelDefinition) =>
    effectiveFormLayout(definition).sections.map((section) => [
      section.id,
      section.label,
      keys(section.fields),
    ]);
  const sections = (display: ModelDefinition['display'] = {}) =>
    sectionsOf(article({ layout: 'form', ...display }));

  it('without groups: one unlabelled section of every live field, the title included, in field order', () => {
    const layout = effectiveFormLayout(article({ layout: 'form' }));
    expect(layout.title?.apiKey).toBe('title');
    expect(sections()).toEqual([
      [run(1), undefined, ['title', 'slug', 'cover', 'body', 'seo', 'sections', 'gallery', 'faqs', 'thumb']],
    ]);
  });

  it('keeps a group between the ungrouped fields around it (a Product with a Pricing group)', () => {
    const product = model({
      apiKey: 'product',
      fields: [
        field({ id: id(1), apiKey: 'name' }),
        field({ id: id(2), apiKey: 'price', type: 'decimal' }),
        field({ id: id(3), apiKey: 'sku' }),
        field({ id: id(4), apiKey: 'description', type: 'richtext' }),
        field({ id: id(5), apiKey: 'gallery', type: 'media', settings: settings({ multiple: true }) }),
      ],
      display: { layout: 'form', groups: [{ id: 'pricing', label: 'Pricing', fieldIds: [id(3), id(2)] }] },
    });
    expect(sectionsOf(product)).toEqual([
      [run(1), undefined, ['name']],
      ['pricing', 'Pricing', ['price', 'sku']],
      [run(4), undefined, ['description', 'gallery']],
    ]);
  });

  it('gives each run of ungrouped fields between two groups its own section', () => {
    expect(
      sections({
        groups: [
          { id: 'meta', label: 'Meta', fieldIds: [id(2)] },
          { id: 'media', label: 'Media', fieldIds: [id(7), id(9)] },
        ],
      }),
    ).toEqual([
      [run(1), undefined, ['title']],
      ['meta', 'Meta', ['slug']],
      [run(3), undefined, ['cover', 'body', 'seo', 'sections']],
      ['media', 'Media', ['gallery', 'thumb']],
      [run(8), undefined, ['faqs']],
    ]);
  });

  it('places each group at its first field, with its fields in field order', () => {
    expect(
      sections({
        groups: [
          // Listed out of field order, and before the ungrouped fields: field order still decides.
          { id: 'media', label: 'Media', fieldIds: [id(9), id(3), id(7)] },
          { id: 'seo', label: 'SEO', fieldIds: [id(5), id(2)] },
        ],
      }),
    ).toEqual([
      [run(1), undefined, ['title']],
      ['seo', 'SEO', ['slug', 'seo']],
      ['media', 'Media', ['cover', 'gallery', 'thumb']],
      [run(4), undefined, ['body']],
      [run(6), undefined, ['sections']],
      [run(8), undefined, ['faqs']],
    ]);
  });

  it('opens with a group when the first field is grouped', () => {
    expect(sections({ groups: [{ id: 'main', label: 'Main', fieldIds: [id(1), id(2)] }] })).toEqual([
      ['main', 'Main', ['title', 'slug']],
      [run(3), undefined, ['cover', 'body', 'seo', 'sections', 'gallery', 'faqs', 'thumb']],
    ]);
  });

  it('skips deprecated and unknown ids and drops groups left empty', () => {
    expect(
      sections({
        groups: [
          { id: 'old', label: 'Old', fieldIds: [id(10), id(99)] },
          { id: 'main', label: 'Main', fieldIds: [id(1)] },
        ],
      })[0],
    ).toEqual(['main', 'Main', ['title']]);
  });

  it('never gives a run the ID of a group', () => {
    const ids = effectiveFormLayout(
      article({ layout: 'form', groups: [{ id: run(1), label: 'Odd', fieldIds: [id(2)] }] }),
    ).sections.map((section) => section.id);
    expect(ids).toEqual([`~${run(1)}`, run(1), run(3)]);
  });

  it('ignores the document-only settings', () => {
    const plain = effectiveFormLayout(article({ layout: 'form' }));
    const configured = effectiveFormLayout(
      article({ layout: 'form', canvasFieldIds: [id(2)], coverFieldId: id(9), stripFieldIds: [id(5)] }),
    );
    expect(configured).toEqual(plain);
  });
});

describe('richTextBodyOf', () => {
  it("is the document's rich-text canvas fields", () => {
    expect(keys(richTextBodyOf(article()))).toEqual(['body']);
    expect(keys(richTextBodyOf(article({ canvasFieldIds: [id(2)] })))).toEqual([]);
  });

  it('is every live rich-text field of a form, whatever the canvas says', () => {
    expect(keys(richTextBodyOf(article({ layout: 'form', canvasFieldIds: [id(2)] })))).toEqual(['body']);
  });
});
