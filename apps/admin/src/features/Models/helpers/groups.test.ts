import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { groupIdOf, withFieldInGroup, withFieldInNewGroup, withGroupLabel, withoutGroup } from './groups';

const model: ModelDefinition = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'collection',
  apiKey: 'product',
  label: 'Product',
  localized: false,
  draftAndPublish: true,
  fields: [],
  display: {
    titleFieldId: 'name',
    groups: [
      { id: 'pricing', label: 'Pricing', fieldIds: ['price', 'sku'] },
      { id: 'media', label: 'Media', fieldIds: ['gallery'] },
    ],
  },
};

const ungrouped: ModelDefinition = { ...model, display: { titleFieldId: 'name' } };

describe('groupIdOf', () => {
  it('finds the section a field is in', () => {
    expect(groupIdOf(model, 'sku')).toBe('pricing');
    expect(groupIdOf(model, 'name')).toBeUndefined();
    expect(groupIdOf(ungrouped, 'sku')).toBeUndefined();
  });
});

describe('withFieldInGroup', () => {
  it('moves a field from one section to the end of another', () => {
    const next = withFieldInGroup(model, 'sku', 'media');
    expect(next.display.groups).toEqual([
      { id: 'pricing', label: 'Pricing', fieldIds: ['price'] },
      { id: 'media', label: 'Media', fieldIds: ['gallery', 'sku'] },
    ]);
  });

  it('drops a section the field leaves empty', () => {
    const next = withFieldInGroup(model, 'gallery', 'pricing');
    expect(next.display.groups).toEqual([
      { id: 'pricing', label: 'Pricing', fieldIds: ['price', 'sku', 'gallery'] },
    ]);
  });

  it('ungroups a field with undefined, unsetting groups when none are left', () => {
    expect(withFieldInGroup(model, 'price', undefined).display.groups?.[0]?.fieldIds).toEqual(['sku']);
    const single: ModelDefinition = {
      ...model,
      display: { titleFieldId: 'name', groups: [{ id: 'media', label: 'Media', fieldIds: ['gallery'] }] },
    };
    const next = withFieldInGroup(single, 'gallery', undefined);
    expect(next.display).toEqual({ titleFieldId: 'name' });
  });

  it('changes nothing for the current section or an unknown one', () => {
    expect(withFieldInGroup(model, 'sku', 'pricing')).toBe(model);
    expect(withFieldInGroup(model, 'sku', 'missing')).toBe(model);
    expect(withFieldInGroup(ungrouped, 'sku', undefined)).toBe(ungrouped);
  });
});

describe('withFieldInNewGroup', () => {
  it('adds a section with the field last, taking it out of its old one', () => {
    const next = withFieldInNewGroup(model, 'gallery', { id: 'g-new', label: 'Images' });
    expect(next.display.groups).toEqual([
      { id: 'pricing', label: 'Pricing', fieldIds: ['price', 'sku'] },
      { id: 'g-new', label: 'Images', fieldIds: ['gallery'] },
    ]);
  });

  it('creates the first section of an ungrouped model', () => {
    const next = withFieldInNewGroup(ungrouped, 'sku', { id: 'g-new', label: 'Stock' });
    expect(next.display.groups).toEqual([{ id: 'g-new', label: 'Stock', fieldIds: ['sku'] }]);
  });
});

describe('withGroupLabel and withoutGroup', () => {
  it('renames a section and keeps its ID and fields', () => {
    expect(withGroupLabel(model, 'media', 'Images').display.groups?.[1]).toEqual({
      id: 'media',
      label: 'Images',
      fieldIds: ['gallery'],
    });
  });

  it('removes a section, leaving its fields ungrouped', () => {
    const next = withoutGroup(model, 'pricing');
    expect(next.display.groups).toEqual([{ id: 'media', label: 'Media', fieldIds: ['gallery'] }]);
    expect(groupIdOf(next, 'price')).toBeUndefined();
    expect(withoutGroup(next, 'media').display.groups).toBeUndefined();
  });
});
