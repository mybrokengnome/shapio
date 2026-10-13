import { createDefinitionIndex, type ModelDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { component, field, id, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { titleFieldCandidates, withAddedField, withDocumentPlacement } from './display';
import { pruneLayout } from './draft';
import { parentChoices, resolveDraft, type ScopedModel } from './inheritance';

const products = model({
  id: id(1),
  apiKey: 'product',
  pluralApiKey: 'products',
  label: 'Products',
  localized: true,
  fields: [
    field({ id: id(11), apiKey: 'name', label: 'Name' }),
    field({ id: id(12), apiKey: 'cover', label: 'Cover', type: 'media', settings: { multiple: false } }),
    field({ id: id(13), apiKey: 'body', label: 'Body', type: 'richtext' }),
  ],
});
const digital = model({
  id: id(2),
  apiKey: 'digitalProduct',
  pluralApiKey: 'digital',
  label: 'Digital',
  localized: true,
  extends: id(1),
  fields: [field({ id: id(21), apiKey: 'downloadUrl', label: 'Download', type: 'url' })],
});
const apparel = model({ id: id(3), apiKey: 'apparel', label: 'Apparel', extends: id(2), localized: true });
const media = model({ id: id(4), apiKey: 'medium', label: 'Media' });
const index = createDefinitionIndex([products, digital, apparel, media, component({ id: id(5) })]);
const parent = index.resolve(id(1));

describe('resolveDraft', () => {
  it('puts the parent’s fields first, marked, and merges the display', () => {
    const draft = { ...digital, display: { titleFieldId: id(21) } };
    const resolved = resolveDraft(draft, parent) as ModelDefinition & { ancestorIds: string[] };
    expect(resolved.fields.map((candidate) => candidate.apiKey)).toEqual([
      'name',
      'cover',
      'body',
      'downloadUrl',
    ]);
    expect(resolved.fields[0]).toMatchObject({ inheritedFrom: id(1) });
    expect(resolved.display.titleFieldId).toBe(id(21));
    expect(resolved.ancestorIds).toEqual([id(1)]);
    expect(resolveDraft(products, undefined)).toBe(products);
  });

  it('keeps the declaring ancestor on a grandparent’s field', () => {
    const resolved = resolveDraft(apparel, index.resolve(id(2)));
    expect(
      resolved.fields.map((candidate) => (candidate as { inheritedFrom?: string }).inheritedFrom),
    ).toEqual([id(1), id(1), id(1), id(2)]);
  });
});

describe('display helpers on a kind', () => {
  it('offers inherited title candidates, even though the validator skips a kind’s display', () => {
    const resolved = resolveDraft(digital, parent);
    expect(titleFieldCandidates(resolved).map((candidate) => candidate.apiKey)).toEqual(['name']);
  });

  it('does not make a new own field the title when a title is inherited', () => {
    const kind = { ...digital, fields: [] };
    const sku = model({ fields: [field({ apiKey: 'sku', label: 'SKU' })] }).fields[0];
    if (!sku) {
      throw new Error('fixture');
    }
    expect(withAddedField(kind, sku, parent).display.titleFieldId).toBeUndefined();
    // A root with no title candidate yet takes it.
    expect(withAddedField({ ...media, fields: [] }, sku).display.titleFieldId).toBe(sku.id);
  });

  it('keeps document references to inherited fields when pruning', () => {
    const draft = {
      ...digital,
      display: { canvasFieldIds: [id(13)], coverFieldId: id(12) },
    } as SchemaDefinition;
    expect(pruneLayout(draft, parent).display).toEqual(draft.display);
    // Without the parent they point at nothing.
    expect(pruneLayout(draft).display).toEqual({ canvasFieldIds: [] });
  });

  it('places an own field in the document after the inherited blocks', () => {
    const placed = withDocumentPlacement(digital, id(21), true, parent);
    expect(placed.display.canvasFieldIds).toEqual([id(13), id(21)]);
  });
});

describe('parentChoices', () => {
  const scoped = (
    definition: SchemaDefinition,
    scope: ScopedModel['scope'],
    siteId: string | null,
  ): ScopedModel => ({
    definition,
    scope,
    siteId,
  });
  const models = [
    scoped(products, 'site', 's1'),
    scoped(digital, 'site', 's1'),
    scoped(apparel, 'site', 's1'),
    scoped(media, 'network', null),
    scoped(model({ id: id(6), apiKey: 'home', label: 'Home', kind: 'singleton' }), 'site', 's1'),
  ];

  it('lists collections in the same scope, by label', () => {
    expect(
      parentChoices(models, index, { scope: 'site', siteId: 's1' }).map((choice) => choice.label),
    ).toEqual(['Apparel', 'Digital', 'Products']);
    expect(
      parentChoices(models, index, { scope: 'network', siteId: null }).map((choice) => choice.label),
    ).toEqual(['Media']);
    expect(parentChoices(models, index, { scope: 'site', siteId: 's2' })).toEqual([]);
  });

  it('never offers the model itself or its descendants', () => {
    expect(
      parentChoices(models, index, { scope: 'site', siteId: 's1' }, id(1)).map((choice) => choice.label),
    ).toEqual([]);
    expect(
      parentChoices(models, index, { scope: 'site', siteId: 's1' }, id(3)).map((choice) => choice.label),
    ).toEqual(['Digital', 'Products']);
  });
});
