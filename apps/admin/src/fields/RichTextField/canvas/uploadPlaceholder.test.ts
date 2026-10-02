// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { richTextExtensions } from '../extensions';
import {
  addUploadPlaceholder,
  findUploadPlaceholder,
  removeUploadPlaceholder,
  UploadPlaceholder,
} from './uploadPlaceholder';

let editor: Editor | undefined;

afterEach(() => editor?.destroy());

const create = () =>
  new Editor({
    extensions: [...richTextExtensions(), UploadPlaceholder],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] },
  });

describe('upload placeholders', () => {
  it('follow edits before them and never reach the stored document', () => {
    editor = create();
    const before = JSON.stringify(editor.getJSON());
    editor.view.dispatch(addUploadPlaceholder(editor.state.tr, 'u1', 7, 'castle.png'));
    expect(findUploadPlaceholder(editor.state, 'u1')).toBe(7);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    editor.commands.insertContentAt(1, 'Oh, ');
    expect(findUploadPlaceholder(editor.state, 'u1')).toBe(11);
    editor.view.dispatch(removeUploadPlaceholder(editor.state.tr, 'u1'));
    expect(findUploadPlaceholder(editor.state, 'u1')).toBeUndefined();
  });
});
