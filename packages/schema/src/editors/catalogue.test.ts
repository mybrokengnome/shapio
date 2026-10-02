import { describe, expect, it } from 'vitest';
import { field, model } from '../testing/fixtures.js';
import { DATA_TYPES } from '../types/dataTypes.js';
import type { FieldInput } from '../types/definitions.js';
import { validateDefinition } from '../validators/definition.js';
import { DEFAULT_EDITORS, EDITOR_CATALOGUE, isCustomEditorId, listCompatibleEditors } from './catalogue.js';

const SETTINGS: Partial<Record<FieldInput['type'], FieldInput['settings']>> = {
  enum: { values: [{ value: 'a', label: 'A' }] },
  relation: { target: '00000000-0000-4000-8000-000000000001', cardinality: 'one' },
  component: { component: '00000000-0000-4000-8000-000000000002' },
  dynamiczone: { components: ['00000000-0000-4000-8000-000000000002'] },
};

describe('editor catalogue', () => {
  it.each(DATA_TYPES)('the default editor for %s exists and is compatible', (type) => {
    expect(EDITOR_CATALOGUE.has(DEFAULT_EDITORS[type])).toBe(true);
    const definition = model({
      fields: [field({ apiKey: 'f', type, ...(SETTINGS[type] ? { settings: SETTINGS[type] } : {}) })],
    });
    expect(validateDefinition(definition).filter((found) => found.path.includes('/editor'))).toEqual([]);
  });

  it('offers radio/segmented for single enums and checkboxGroup for multiple enums', () => {
    const single = model({ fields: [field({ apiKey: 'e', type: 'enum', settings: SETTINGS.enum })] })
      .fields[0];
    const multiple = model({
      fields: [field({ apiKey: 'e', type: 'enum', settings: { ...SETTINGS.enum, multiple: true } })],
    }).fields[0];
    expect(listCompatibleEditors(single!).map((entry) => entry.id)).toEqual(['segmented', 'select', 'radio']);
    expect(listCompatibleEditors(multiple!).map((entry) => entry.id)).toEqual(['select', 'checkboxGroup']);
  });

  it('offers toggle, checkbox and segmented for booleans', () => {
    const boolean = model({ fields: [field({ apiKey: 'b', type: 'boolean' })] }).fields[0];
    expect(listCompatibleEditors(boolean!).map((entry) => entry.id)).toEqual([
      'toggle',
      'checkbox',
      'segmented',
    ]);
  });

  it('recognises namespaced custom editor IDs', () => {
    expect(isCustomEditorId('acme.colorWheel')).toBe(true);
    expect(isCustomEditorId('textInput')).toBe(false);
    expect(isCustomEditorId('.bad')).toBe(false);
  });
});
