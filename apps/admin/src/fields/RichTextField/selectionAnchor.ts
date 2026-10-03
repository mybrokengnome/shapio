import type { Editor } from '@tiptap/core';

export type TextRange = { from: number; to: number };

/**
 * Where a range of the document is on screen (the current selection by default), as a virtual anchor for a
 * popover attached to the text (the link and rewrite popovers).
 */
export const selectionAnchor = (editor: Editor, range?: TextRange) => ({
  current: {
    getBoundingClientRect: () => {
      const { from, to } = range ?? editor.state.selection;
      const size = editor.state.doc.content.size;
      const start = editor.view.coordsAtPos(Math.min(from, size));
      const end = editor.view.coordsAtPos(Math.min(to, size));
      return new DOMRect(start.left, start.top, Math.max(end.right - start.left, 1), end.bottom - start.top);
    },
  },
});
