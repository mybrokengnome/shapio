import type { Editor, Range } from '@tiptap/core';
import { useCallback, useEffect, useRef } from 'react';
import { useEntryFormStore, useFieldsEnvironment } from '../../form/context';
import { entryTitle } from '../../helpers/titles';
import { edgeTarget, type WriteKind } from '../canvas/blocks';
import { contextAround, targetAtBlock, targetOf } from '../canvas/writeTarget';
import { useRewriteSelection } from './useRewriteSelection';
import { useWriteProposal } from './useWriteProposal';

/**
 * The assists of a rich-text field, the same in the document's canvas and the form's editor: Rewrite… on the
 * selection, and Write… / Continue writing, told the entry's title (as it is in the form), the field's label
 * and the locale. Each entry point only says where the text goes:
 * - `writeAt`: a `+` menu's boundary, or the empty paragraph at a field's edge it replaces;
 * - `writeAtCursor`: the cursor's top-level block (after it, or in place of it when it is empty), as the `/`
 *   menu and the form toolbar's Write… do;
 * - `continueAtEnd`: the end of the document (the text so far), the form toolbar's Continue writing.
 * The context sent always splits at that place, not at the cursor.
 */
export const useAssistActions = (editor: Editor, fieldLabel: string) => {
  const { model, locale } = useFieldsEnvironment();
  const store = useEntryFormStore();
  const rewrite = useRewriteSelection(editor);
  const write = useWriteProposal(editor, {
    title: () => entryTitle(model, store.getState().values),
    fieldLabel,
    locale,
  });
  // The actions stay the same between renders (menus and the canvas handle hold them); they call the current
  // `start`.
  const startWrite = useRef(write.start);
  useEffect(() => {
    startWrite.current = write.start;
  });
  const writeAt = useCallback(
    (kind: WriteKind, at: number | Range) => {
      const { doc } = editor.state;
      const target = targetOf(doc, at);
      startWrite.current({ kind, target, context: contextAround(doc, target.from, target.to) });
    },
    [editor],
  );
  const writeAtCursor = useCallback(
    (kind: WriteKind) => {
      const { doc, selection } = editor.state;
      const target = targetAtBlock(doc, selection.from);
      startWrite.current({ kind, target, context: contextAround(doc, target.from, target.to) });
    },
    [editor],
  );
  const continueAtEnd = useCallback(() => writeAt('continue', edgeTarget(editor, 'end')), [editor, writeAt]);
  return { rewrite, write, writeAt, writeAtCursor, continueAtEnd };
};
