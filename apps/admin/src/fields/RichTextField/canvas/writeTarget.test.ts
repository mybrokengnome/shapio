import { getSchema } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { richTextExtensions } from '../extensions';
import {
  contextAround,
  insertionRange,
  mapTarget,
  targetAtBlock,
  targetOf,
  type WriteTarget,
} from './writeTarget';

const schema = getSchema(richTextExtensions());

const paragraph = (text?: string) =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };

const stateOf = (blocks: unknown[]) =>
  EditorState.create({ schema, doc: ProseMirrorNode.fromJSON(schema, { type: 'doc', content: blocks }) });

/** Applies a change and maps the target through it, as the hook does on every transaction. */
const after = (state: EditorState, target: WriteTarget, change: (tr: Transaction) => Transaction) => {
  const tr = change(state.tr);
  return { doc: state.apply(tr).doc, target: mapTarget(target, tr.mapping) };
};

// "One" is 0..5, the empty paragraph 5..7, "Two" 7..12.
const doc3 = () => stateOf([paragraph('One'), paragraph(), paragraph('Two')]);

describe('targetAtBlock', () => {
  it('replaces the empty paragraph the cursor is in', () => {
    expect(targetAtBlock(doc3().doc, 6)).toEqual({ from: 5, to: 7 });
  });

  it('goes after a block with text', () => {
    expect(targetAtBlock(doc3().doc, 2)).toEqual({ from: 5, to: 5 });
  });

  it('goes after the whole top-level block when the cursor is inside a list', () => {
    const state = stateOf([
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] },
      paragraph('After'),
    ]);
    const list = state.doc.child(0);
    expect(targetAtBlock(state.doc, 4)).toEqual({ from: list.nodeSize, to: list.nodeSize });
  });
});

describe('targetOf', () => {
  it('takes a boundary or a range, kept inside the document', () => {
    const { doc } = doc3();
    expect(targetOf(doc, 5)).toEqual({ from: 5, to: 5 });
    expect(targetOf(doc, 99)).toEqual({ from: 12, to: 12 });
    expect(targetOf(doc, { from: 5, to: 7 })).toEqual({ from: 5, to: 7 });
  });
});

describe('contextAround', () => {
  it('sends the text before the split and after the target', () => {
    const { doc } = doc3();
    expect(contextAround(doc, 5, 7)).toEqual({ before: 'One', after: 'Two' });
  });
});

describe('mapTarget and insertionRange', () => {
  it('follows text typed before the target', () => {
    const state = doc3();
    const moved = after(state, { from: 5, to: 7 }, (tr) => tr.insertText('Hey ', 1));
    expect(moved.target).toEqual({ from: 9, to: 11 });
    expect(moved.target && insertionRange(moved.doc, moved.target)).toEqual({ from: 9, to: 11 });
  });

  it('keeps a point right after its block when a block is added at the same place', () => {
    const state = doc3();
    const moved = after(state, { from: 5, to: 5 }, (tr) => tr.insert(5, schema.nodes.paragraph!.create()));
    expect(moved.target).toEqual({ from: 5, to: 5 });
  });

  it('goes after the paragraph when someone typed into the one it would replace', () => {
    const state = doc3();
    const moved = after(state, { from: 5, to: 7 }, (tr) => tr.insertText('Typed', 6));
    expect(moved.target).toEqual({ from: 5, to: 12 });
    expect(moved.target && insertionRange(moved.doc, moved.target)).toEqual({ from: 12, to: 12 });
  });

  it('is gone when the paragraph to replace was deleted', () => {
    const state = doc3();
    expect(after(state, { from: 5, to: 7 }, (tr) => tr.delete(5, 7)).target).toBeNull();
  });

  it('is gone when the block before a point was deleted', () => {
    const state = doc3();
    expect(after(state, { from: 5, to: 5 }, (tr) => tr.delete(0, 5)).target).toBeNull();
  });

  it('is gone when the whole document was replaced (a reload)', () => {
    const state = doc3();
    const replaced = after(state, { from: 5, to: 7 }, (tr) =>
      tr.replaceWith(0, tr.doc.content.size, schema.nodes.paragraph!.create(null, schema.text('New'))),
    );
    expect(replaced.target).toBeNull();
  });

  it('refuses a point that is no longer between top-level blocks', () => {
    const { doc } = doc3();
    expect(insertionRange(doc, { from: 2, to: 2 })).toBeNull();
    expect(insertionRange(doc, { from: 40, to: 40 })).toBeNull();
  });
});
