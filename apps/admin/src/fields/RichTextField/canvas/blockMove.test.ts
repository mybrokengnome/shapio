import { getSchema } from '@tiptap/core';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { richTextExtensions } from '../extensions';
import { moveBlock, topLevelBlockAt } from './blockMove';

const schema = getSchema(richTextExtensions());

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const stateOf = (blocks: unknown[]) =>
  EditorState.create({
    schema,
    doc: ProseMirrorNode.fromJSON(schema, { type: 'doc', content: blocks }),
  });

const texts = (state: EditorState) => {
  const result: string[] = [];
  state.doc.forEach((node) => result.push(node.type.name === 'image' ? 'image' : node.textContent));
  return result;
};

const run = (state: EditorState, direction: 'up' | 'down') => {
  let next = state;
  const moved = moveBlock(state, direction, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return { moved, next };
};

describe('topLevelBlockAt', () => {
  it('finds the document child around a position', () => {
    const state = stateOf([paragraph('one'), paragraph('two')]);
    expect(topLevelBlockAt(state.doc, 2)?.index).toBe(0);
    expect(topLevelBlockAt(state.doc, 6)).toMatchObject({ index: 1, pos: 5 });
  });
});

describe('moveBlock (⌥↑ / ⌥↓ and the drag handle share it)', () => {
  it('moves the block with the cursor down and keeps the cursor in it', () => {
    const start = stateOf([paragraph('one'), paragraph('two'), paragraph('three')]);
    const state = start.apply(start.tr.setSelection(TextSelection.create(start.doc, 2)));
    const { moved, next } = run(state, 'down');
    expect(moved).toBe(true);
    expect(texts(next)).toEqual(['two', 'one', 'three']);
    expect(topLevelBlockAt(next.doc, next.selection.from)?.node.textContent).toBe('one');
  });

  it('moves a selected image up', () => {
    const start = stateOf([
      paragraph('one'),
      { type: 'image', attrs: { mediaId: '00000000-0000-4000-8000-000000000001', alt: null, title: null } },
    ]);
    const state = start.apply(start.tr.setSelection(NodeSelection.create(start.doc, 5)));
    const { moved, next } = run(state, 'up');
    expect(moved).toBe(true);
    expect(texts(next)).toEqual(['image', 'one']);
    expect(next.selection).toBeInstanceOf(NodeSelection);
  });

  it('does nothing at the edges', () => {
    const state = stateOf([paragraph('one'), paragraph('two')]);
    expect(run(state, 'up').moved).toBe(false);
    const last = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));
    expect(run(last, 'down').moved).toBe(false);
  });
});
