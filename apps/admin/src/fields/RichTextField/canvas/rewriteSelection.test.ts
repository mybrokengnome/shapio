import { getSchema } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { richTextExtensions } from '../extensions';
import { captureSelection, contentOfRewrite, isRangeUnchanged, textRangeOf } from './rewriteSelection';

const schema = getSchema(richTextExtensions());

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const stateOf = (blocks: unknown[], from: number, to: number) => {
  const doc = ProseMirrorNode.fromJSON(schema, { type: 'doc', content: blocks });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
};

describe('captureSelection', () => {
  it('reads the selected text, blocks separated by a blank line', () => {
    // "Hello world" at 1..12, "Second" at 14..20.
    const state = stateOf([paragraph('Hello world'), paragraph('Second')], 7, 20);
    expect(captureSelection(state)).toEqual({ from: 7, to: 20, text: 'world\n\nSecond' });
  });

  it('is null for an empty or whitespace-only selection', () => {
    expect(captureSelection(stateOf([paragraph('Hello')], 2, 2))).toBeNull();
    expect(captureSelection(stateOf([paragraph('a   b')], 2, 5))).toBeNull();
  });
});

describe('textRangeOf (a triple-click selection)', () => {
  // "One" is 1..4 inside 0..5, "Two" 6..9 inside 5..10.
  const { doc } = stateOf([paragraph('One'), paragraph('Two')], 1, 1);

  it('ends a paragraph selection that reaches the start of the next block at the end of its text', () => {
    expect(textRangeOf(doc, { from: 1, to: 6 })).toEqual({ from: 1, to: 4 });
  });

  it('moves ends between blocks into the text', () => {
    expect(textRangeOf(doc, { from: 0, to: 5 })).toEqual({ from: 1, to: 4 });
    expect(textRangeOf(doc, { from: 0, to: 10 })).toEqual({ from: 1, to: 9 });
  });

  it('leaves a selection inside the text as it is', () => {
    expect(textRangeOf(doc, { from: 2, to: 8 })).toEqual({ from: 2, to: 8 });
  });

  it('captures and replaces only the paragraph, so no empty paragraph is left', () => {
    const state = stateOf([paragraph('One'), paragraph('Two')], 1, 6);
    const captured = captureSelection(state);
    expect(captured).toEqual({ from: 1, to: 4, text: 'One' });
    if (!captured) {
      return;
    }
    const replaced = state.apply(state.tr.insertText('Uno', captured.from, captured.to));
    expect(replaced.doc.toJSON()).toEqual({ type: 'doc', content: [paragraph('Uno'), paragraph('Two')] });
  });
});

describe('isRangeUnchanged', () => {
  it('holds while the range still has the sent text, and fails once it was edited', () => {
    const state = stateOf([paragraph('Hello world')], 7, 12);
    const captured = captureSelection(state);
    expect(captured).not.toBeNull();
    if (!captured) {
      return;
    }
    expect(isRangeUnchanged(state.doc, captured)).toBe(true);
    const edited = state.apply(state.tr.insertText('big ', 7));
    expect(isRangeUnchanged(edited.doc, captured)).toBe(false);
    expect(isRangeUnchanged(stateOf([paragraph('Hi')], 1, 1).doc, captured)).toBe(false);
  });
});

describe('contentOfRewrite', () => {
  it('keeps one paragraph inline, with line breaks as hard breaks', () => {
    expect(contentOfRewrite('  Short one\nnext line ')).toEqual([
      { type: 'text', text: 'Short one' },
      { type: 'hardBreak' },
      { type: 'text', text: 'next line' },
    ]);
  });

  it('turns blank-line separated text into paragraphs', () => {
    expect(contentOfRewrite('First\r\n\r\nSecond\n\n\nThird')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Third' }] },
    ]);
  });

  it('gives nothing for empty text', () => {
    expect(contentOfRewrite('  ')).toEqual([]);
  });
});
