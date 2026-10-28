import { Extension, type Editor } from '@tiptap/core';

/**
 * The cursor sits at the very start of a list item that has an item above it in the same list: the item's
 * first block is a textblock, the caret is at its start, and nothing is selected.
 */
const atStartOfLaterListItem = (editor: Editor): boolean => {
  const { selection } = editor.state;
  if (!selection.empty) {
    return false;
  }
  const { $from } = selection;
  const itemDepth = $from.depth - 1;
  return (
    itemDepth > 0 &&
    $from.parentOffset === 0 &&
    $from.node(itemDepth).type.name === 'listItem' &&
    $from.index(itemDepth) === 0 &&
    $from.index(itemDepth - 1) > 0
  );
};

/**
 * Backspace at the start of a list item joins it into the item above: its paragraphs become that item's
 * next paragraphs, and the list stays one list, numbered straight through. Tiptap's `ListKeymap` would lift
 * the item out of the list instead, splitting it (the rest restarts at 1). Every other Backspace (the first
 * item, mid-text, a selection) falls through to `ListKeymap` and the defaults; priority 101 runs this first.
 */
export const ListItemJoin = Extension.create({
  name: 'listItemJoin',
  priority: 101,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => atStartOfLaterListItem(editor) && editor.commands.joinBackward(),
    };
  },
});
