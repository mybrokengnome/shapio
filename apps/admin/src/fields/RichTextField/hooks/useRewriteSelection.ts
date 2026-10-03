import type { AssistTextResult } from '@shapio/client';
import type { Editor } from '@tiptap/core';
import { useState } from 'react';
import { useRewriteText } from '@/api/assist';
import { REWRITE_MAX_TEXT } from '@/constants/assist';
import {
  captureSelection,
  contentOfRewrite,
  isRangeUnchanged,
  type CapturedSelection,
} from '../canvas/rewriteSelection';

/**
 * "Rewrite…" on the selected text: the selection is captured when the popover opens, the model's text comes
 * back as an editable proposal, and Replace puts it in place only if nobody changed that text meanwhile.
 */
export const useRewriteSelection = (editor: Editor) => {
  const [open, setOpen] = useState(false);
  const [captured, setCaptured] = useState<CapturedSelection | null>(null);
  const [result, setResult] = useState<AssistTextResult | null>(null);
  const [draft, setDraft] = useState('');
  const [stale, setStale] = useState(false);
  const rewrite = useRewriteText();

  const reset = () => {
    setResult(null);
    setDraft('');
    setStale(false);
    rewrite.reset();
  };
  const start = () => {
    const selection = captureSelection(editor.state);
    if (!selection) {
      return;
    }
    reset();
    setCaptured(selection);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const run = (instruction: string) => {
    if (!captured || instruction.trim() === '') {
      return;
    }
    setStale(false);
    rewrite.mutate(
      { text: captured.text, instruction: instruction.trim() },
      {
        onSuccess: (answer) => {
          setResult(answer);
          setDraft(answer.text);
        },
      },
    );
  };
  const apply = () => {
    if (!captured || draft.trim() === '') {
      return;
    }
    if (!isRangeUnchanged(editor.state.doc, captured)) {
      setStale(true);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContentAt({ from: captured.from, to: captured.to }, contentOfRewrite(draft))
      .run();
    close();
  };
  return {
    open,
    captured,
    tooLong: (captured?.text.length ?? 0) > REWRITE_MAX_TEXT,
    result,
    draft,
    setDraft,
    stale,
    pending: rewrite.isPending,
    error: rewrite.error,
    start,
    close,
    run,
    apply,
    /** Back to the instruction, to try another one. */
    discard: reset,
  };
};

export type RewriteSelection = ReturnType<typeof useRewriteSelection>;
