import { describe, expect, it } from 'vitest';
import { field, id, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { previewSections } from './previewSections';

const NAME = id(1);
const PRICE = id(2);
const SKU = id(3);
const BODY = id(4);

const product = (layout?: 'form') =>
  model({
    display: {
      titleFieldId: NAME,
      ...(layout ? { layout } : {}),
      groups: [{ id: 'pricing', label: 'Pricing', fieldIds: [PRICE, SKU] }],
    },
    fields: [
      field({ id: NAME, apiKey: 'name' }),
      field({ id: PRICE, apiKey: 'price', type: 'decimal', ...(layout ? { width: 'half' } : {}) }),
      field({ id: SKU, apiKey: 'sku', ...(layout ? { width: 'half' } : {}) }),
      field({ id: BODY, apiKey: 'body', type: 'richtext' }),
    ],
  });

const shape = (sections: ReturnType<typeof previewSections>) =>
  sections.map((section) => ({
    kind: section.kind,
    label: section.label,
    fields: section.fields.map((item) => item.apiKey),
  }));

describe('previewSections', () => {
  it('shows a document as the document, then its properties by group', () => {
    expect(shape(previewSections(product()))).toEqual([
      { kind: 'document', label: undefined, fields: ['name', 'body'] },
      { kind: 'properties', label: 'Pricing', fields: ['price', 'sku'] },
    ]);
  });

  it('shows a form as its sections in field order, the title and rich text among the fields', () => {
    expect(shape(previewSections(product('form')))).toEqual([
      { kind: 'properties', label: undefined, fields: ['name'] },
      { kind: 'properties', label: 'Pricing', fields: ['price', 'sku'] },
      { kind: 'properties', label: undefined, fields: ['body'] },
    ]);
  });

  it('gives every form section a distinct id', () => {
    const ids = previewSections(product('form')).map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
