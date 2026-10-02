import { describe, expect, it } from 'vitest';
import { field, id, model, withField } from '../testing/fixtures.js';
import type { FieldDefinition } from '../types/definitions.js';
import { diffDefinitions } from './diffDefinitions.js';

const base = () =>
  model({
    id: id(1),
    apiKey: 'page',
    label: 'Page',
    fields: [field({ apiKey: 'title', id: id(2) }), field({ apiKey: 'body', id: id(3), type: 'text' })],
  });

const kinds = (changes: ReturnType<typeof diffDefinitions>) =>
  changes.map((change) => [change.kind, change.fieldId ?? '', change.property ?? ''].join(' ').trim());

describe('diffDefinitions', () => {
  it('reports nothing for identical definitions', () => {
    expect(diffDefinitions(base(), base())).toEqual([]);
  });

  it('reports added and removed definitions', () => {
    expect(diffDefinitions(null, base())).toEqual([
      { kind: 'definition.added', definitionId: id(1), to: 'page' },
    ]);
    expect(diffDefinitions(base(), null)).toEqual([
      { kind: 'definition.removed', definitionId: id(1), from: 'page' },
    ]);
    expect(diffDefinitions(null, null)).toEqual([]);
  });

  it('reports a label change as metadata and keeps field identity', () => {
    const after = withField({ ...base(), label: 'Pages' }, id(2), (f) => ({ ...f, label: 'Headline' }));
    expect(kinds(diffDefinitions(base(), after))).toEqual([
      'definition.metadata  label',
      `field.metadata ${id(2)} label`,
    ]);
  });

  it('reports renames by stable ID, not as remove + add', () => {
    const after = withField({ ...base(), apiKey: 'landingPage' }, id(2), (f) => ({
      ...f,
      apiKey: 'headline',
    }));
    expect(diffDefinitions(base(), after)).toEqual([
      { kind: 'definition.apiKey', definitionId: id(1), from: 'page', to: 'landingPage' },
      { kind: 'field.apiKey', definitionId: id(1), fieldId: id(2), from: 'title', to: 'headline' },
    ]);
  });

  it('reports a plural API ID rename between collections', () => {
    expect(diffDefinitions(base(), { ...base(), pluralApiKey: 'landingPages' })).toEqual([
      { kind: 'definition.pluralApiKey', definitionId: id(1), from: 'pages', to: 'landingPages' },
    ]);
  });

  it('sees no plural change when a stored definition gets its derived plural', () => {
    const { pluralApiKey: _dropped, ...stored } = base();
    expect(diffDefinitions(stored, base())).toEqual([]);
  });

  it('reports a kind switch without a separate plural change', () => {
    const { pluralApiKey: _dropped, ...singleton } = { ...base(), kind: 'singleton' as const };
    expect(kinds(diffDefinitions(base(), singleton))).toEqual(['model.kind']);
    expect(kinds(diffDefinitions(singleton, base()))).toEqual(['model.kind']);
  });

  it('reports field additions, removals and reordering', () => {
    const before = base();
    const added = field({ apiKey: 'summary', id: id(4) });
    const after = model({
      ...before,
      fields: [
        field({ apiKey: 'body', id: id(3), type: 'text' }),
        field({ apiKey: 'title', id: id(2) }),
        added,
      ],
    });
    expect(kinds(diffDefinitions(before, after))).toEqual([`field.added ${id(4)}`, 'field.order']);
    const removed = model({ ...before, fields: [field({ apiKey: 'title', id: id(2) })] });
    expect(kinds(diffDefinitions(before, removed))).toEqual([`field.removed ${id(3)}`]);
  });

  it('reports flags, editor and settings per property', () => {
    const after = withField(
      base(),
      id(2),
      (f) =>
        ({
          ...f,
          required: true,
          unique: true,
          sortable: true,
          editor: { id: 'textarea', options: {} },
          settings: { maxLength: 80 },
        }) as FieldDefinition,
    );
    expect(kinds(diffDefinitions(base(), after))).toEqual([
      `field.editor ${id(2)}`,
      `field.settings ${id(2)} maxLength`,
      `field.required ${id(2)}`,
      `field.unique ${id(2)}`,
      `field.sortable ${id(2)}`,
    ]);
  });

  it('reports a type change without diffing type-specific settings', () => {
    const after = withField(base(), id(3), (f) => ({
      ...f,
      type: 'richtext',
      settings: { formatVersion: 1 },
    }));
    expect(kinds(diffDefinitions(base(), after))).toEqual([`field.type ${id(3)}`]);
  });

  it('reports model-level toggles', () => {
    const after = { ...base(), kind: 'singleton' as const, localized: true, draftAndPublish: false };
    expect(kinds(diffDefinitions(base(), after))).toEqual([
      'model.kind',
      'model.localized',
      'model.draftAndPublish',
    ]);
  });
});
