// @vitest-environment jsdom
import { CompletionContext } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { editorSchemaFor } from './editorSchema';
import { schemaCompletion, schemaHover } from './schemaAssist';

const schema = editorSchemaFor('model');

/** `|` marks the cursor. */
const complete = (marked: string) => {
  const pos = marked.indexOf('|');
  const state = EditorState.create({ doc: marked.replace('|', ''), extensions: [json()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const result = schemaCompletion(schema)(new CompletionContext(state, pos, true));
  return result?.options.map((option) => option.label) ?? [];
};

describe('schema completion', () => {
  it('offers the definition’s keys that are not there yet', () => {
    const labels = complete('{\n  "kind": "collection",\n  |\n}');
    expect(labels).toEqual(expect.arrayContaining(['apiKey', 'label', 'fields']));
    expect(labels).not.toContain('kind');
  });

  it('offers a field’s keys inside the fields array', () => {
    const labels = complete('{ "fields": [ { "apiKey": "title", | } ] }');
    expect(labels).toEqual(expect.arrayContaining(['type', 'required', 'settings']));
    expect(labels).not.toContain('apiKey');
  });

  it('offers enum values', () => {
    expect(complete('{ "kind": | }')).toEqual(['"collection"', '"singleton"']);
    expect(complete('{ "fields": [ { "type": | } ] }')).toEqual(
      expect.arrayContaining(['"string"', '"relation"']),
    );
    expect(complete('{ "localized": | }')).toEqual(['true', 'false']);
  });

  it('narrows settings to the field’s data type', () => {
    const labels = complete('{ "fields": [ { "type": "relation", "settings": { | } } ] }');
    expect(labels).toEqual(expect.arrayContaining(['target', 'cardinality']));
    expect(labels).not.toContain('pattern');
  });
});

describe('schema hover', () => {
  it('shows a property’s allowed values', () => {
    const doc = '{ "kind": "collection" }';
    const state = EditorState.create({ doc, extensions: [json()] });
    ensureSyntaxTree(state, state.doc.length, 1000);
    const tooltip = schemaHover(schema)({ state }, doc.indexOf('kind') + 1, 1);
    const { dom } = tooltip?.create({} as never) ?? { dom: document.createElement('div') };
    expect(dom.textContent).toBe('"collection" | "singleton"');
  });
});
