// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { richTextExtensions } from './extensions';

let editor: Editor | undefined;

afterEach(() => editor?.destroy());

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const orderedList = (...content: JSONContent[]): JSONContent => ({
  type: 'orderedList',
  attrs: { start: 1, type: null },
  content,
});

const create = (content: JSONContent[]) =>
  new Editor({ extensions: richTextExtensions(), content: { type: 'doc', content } });

/** Puts the caret at a text offset inside the paragraph whose text is `text`, then presses Backspace. */
const backspaceIn = (current: Editor, text: string, offset = 0) => {
  let target: number | undefined;
  current.state.doc.descendants((node, pos) => {
    if (target === undefined && node.type.name === 'paragraph' && node.textContent === text) {
      target = pos + 1 + offset;
    }
  });
  if (target === undefined) {
    throw new Error(`no paragraph "${text}"`);
  }
  current.view.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc, target)));
  current.commands.keyboardShortcut('Backspace');
};

/** The stored blocks, without the empty paragraph Tiptap keeps at the end of the document. */
const blocks = (current: Editor) =>
  (current.getJSON().content ?? []).filter((node) => !(node.type === 'paragraph' && !node.content));

describe('Backspace at the start of a list item', () => {
  it('joins the item into the one above as its next paragraph, keeping one list', () => {
    editor = create([orderedList(item(paragraph('one')), item(paragraph('two')), item(paragraph('three')))]);
    backspaceIn(editor, 'two');
    expect(blocks(editor)).toEqual([
      orderedList(item(paragraph('one'), paragraph('two')), item(paragraph('three'))),
    ]);
  });

  it('joins a two-item list into one item with two paragraphs', () => {
    editor = create([orderedList(item(paragraph('one')), item(paragraph('two')))]);
    backspaceIn(editor, 'two');
    expect(blocks(editor)).toEqual([orderedList(item(paragraph('one'), paragraph('two')))]);
  });

  it('still lifts the first item out of the list', () => {
    editor = create([orderedList(item(paragraph('one')), item(paragraph('two')))]);
    backspaceIn(editor, 'one');
    expect(blocks(editor)).toEqual([paragraph('one'), orderedList(item(paragraph('two')))]);
  });

  it('still joins two paragraphs of one item', () => {
    editor = create([orderedList(item(paragraph('one'), paragraph('two')))]);
    backspaceIn(editor, 'two');
    expect(blocks(editor)).toEqual([orderedList(item(paragraph('onetwo')))]);
  });

  it('leaves a Backspace inside the text to the browser', () => {
    // jsdom has no native editing, so a key no handler takes changes nothing here.
    editor = create([orderedList(item(paragraph('one')), item(paragraph('two')))]);
    backspaceIn(editor, 'two', 1);
    expect(blocks(editor)).toEqual([orderedList(item(paragraph('one')), item(paragraph('two')))]);
  });
});
