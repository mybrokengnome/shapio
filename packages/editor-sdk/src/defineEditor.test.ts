import { describe, expect, it } from 'vitest';
import { defineEditor, isEditorDefinition } from './defineEditor.js';
import { EDITOR_CONTRACT_VERSION } from './types.js';

const Component = () => null;

describe('defineEditor', () => {
  it('stamps the current contract version', () => {
    const editor = defineEditor({ id: 'acme.rating', dataTypes: ['integer'], component: Component });
    expect(editor).toMatchObject({ id: 'acme.rating', contractVersion: EDITOR_CONTRACT_VERSION });
    expect(isEditorDefinition(editor)).toBe(true);
  });

  it('requires a namespaced ID and at least one data type', () => {
    expect(() => defineEditor({ id: 'rating', dataTypes: ['integer'], component: Component })).toThrow(
      /namespaced/,
    );
    expect(() => defineEditor({ id: 'acme.rating', dataTypes: [], component: Component })).toThrow(
      /at least one data type/,
    );
  });
});

describe('isEditorDefinition', () => {
  it.each([
    null,
    'acme.rating',
    { id: 'acme.rating', contractVersion: 1, dataTypes: ['integer'] },
    { id: 'rating', contractVersion: 1, dataTypes: ['integer'], component: Component },
    { id: 'acme.rating', contractVersion: '1', dataTypes: ['integer'], component: Component },
  ])('rejects %o', (value) => {
    expect(isEditorDefinition(value)).toBe(false);
  });
});
