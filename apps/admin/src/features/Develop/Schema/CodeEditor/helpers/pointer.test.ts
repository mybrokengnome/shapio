import { json } from '@codemirror/lang-json';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { rangeOfPointer } from './pointer';

const DOC = `{
  "apiKey": "article",
  "a/b": 1,
  "fields": [
    { "apiKey": "title", "type": "string" },
    { "apiKey": "a/b", "settings": {} }
  ]
}
`;

const state = EditorState.create({ doc: DOC, extensions: [json()] });
const textAt = (pointer: string) => {
  const range = rangeOfPointer(state, pointer);
  return state.sliceDoc(range.from, range.to);
};

describe('rangeOfPointer', () => {
  it('marks a scalar value', () => {
    expect(textAt('/apiKey')).toBe('"article"');
    expect(textAt('/fields/0/type')).toBe('"string"');
  });

  it('marks an object or array by its property name or first line', () => {
    expect(textAt('/fields')).toBe('"fields"');
    expect(textAt('/fields/1')).toBe('{ "apiKey": "a/b", "settings": {} }');
    expect(textAt('/fields/1/settings')).toBe('"settings"');
  });

  it('stops at the deepest part that exists (a missing property)', () => {
    expect(textAt('/fields/0/label')).toBe('{ "apiKey": "title", "type": "string" }');
    expect(textAt('/fields/9/apiKey')).toBe('"fields"');
    expect(textAt('/missing')).toBe('{');
  });

  it('decodes escaped pointer segments', () => {
    expect(textAt('/a~1b')).toBe('1');
  });
});
