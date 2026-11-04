import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * Text is selected (not an image or rule, not inside code) in an editable editor: what the floating toolbar
 * and Rewrite… need.
 */
export const hasTextSelection = ({ editor }: { editor: Editor }) => {
  const { selection } = editor.state;
  return (
    editor.isEditable &&
    !selection.empty &&
    !(selection instanceof NodeSelection) &&
    !editor.isActive('codeBlock')
  );
};
