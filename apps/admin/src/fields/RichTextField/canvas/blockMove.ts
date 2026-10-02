import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** A top-level block of the document: its node and where it starts. */
export type TopLevelBlock = { node: ProseMirrorNode; pos: number; index: number };

/** The top-level block containing a position (the document's direct child). */
export const topLevelBlockAt = (doc: ProseMirrorNode, pos: number): TopLevelBlock | undefined => {
  if (doc.childCount === 0) {
    return undefined;
  }
  const $pos = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  const index = $pos.depth === 0 ? Math.min($pos.index(0), doc.childCount - 1) : $pos.index(0);
  const node = doc.maybeChild(index);
  if (!node) {
    return undefined;
  }
  let start = 0;
  for (let at = 0; at < index; at += 1) {
    start += doc.child(at).nodeSize;
  }
  return { node, pos: start, index };
};

/**
 * Moves the top-level block holding the selection one place up or down (⌥↑ / ⌥↓), keeping the selection
 * inside it. Returns false at the edges, so the key falls through.
 */
export const moveBlock = (
  state: EditorState,
  direction: 'up' | 'down',
  dispatch?: (tr: Transaction) => void,
): boolean => {
  const { doc, selection } = state;
  const block = topLevelBlockAt(doc, selection.from);
  if (!block) {
    return false;
  }
  const neighbourIndex = direction === 'up' ? block.index - 1 : block.index + 1;
  const neighbour = doc.maybeChild(neighbourIndex);
  if (!neighbour) {
    return false;
  }
  if (dispatch) {
    const offset = selection.from - block.pos;
    const target = direction === 'up' ? block.pos - neighbour.nodeSize : block.pos + neighbour.nodeSize;
    const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize);
    tr.insert(target, block.node);
    const inside = tr.doc.resolve(Math.min(target + offset, tr.doc.content.size));
    tr.setSelection(
      selection instanceof NodeSelection ? NodeSelection.create(tr.doc, target) : TextSelection.near(inside),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Starts dragging a top-level block from the hover handle: selects it as a node and hands ProseMirror the
 * slice to move, so the editor's own drop handling (with its drop cursor) moves it. No collaboration
 * dependencies (owner decision: our own handle instead of `@tiptap/extension-drag-handle`).
 */
export const startBlockDrag = (view: EditorView, pos: number, event: DragEvent) => {
  const selection = NodeSelection.create(view.state.doc, pos);
  view.dispatch(view.state.tr.setSelection(selection));
  const slice = selection.content();
  view.dragging = { slice, move: true };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', selection.node.textContent);
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dom, 0, 0);
    }
  }
};

/** ⌥↑ / ⌥↓ move the current block (keyboard parity with the drag handle). */
export const BlockMoveKeys = Extension.create({
  name: 'blockMoveKeys',
  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': ({ editor }) => moveBlock(editor.state, 'up', editor.view.dispatch),
      'Alt-ArrowDown': ({ editor }) => moveBlock(editor.state, 'down', editor.view.dispatch),
    };
  },
});
