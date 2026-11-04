import type { WriteInput, WriteResult } from '@shapio/client';
import type { Editor, JSONContent } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { useEffect, useRef, useState } from 'react';
import { useWriteText } from '@/api/assist';
import { ASSIST_WRITE_MAX_TITLE } from '@/constants/assist';
import type { WriteKind } from '../canvas/blocks';
import { insertionRange, mapTarget, type WriteContext, type WriteTarget } from '../canvas/writeTarget';

/** What the model is told besides the text around the insertion point. */
export type WriteDocument = {
  /** The entry's title as it is in the form now (read when the write starts). */
  title: () => string | undefined;
  fieldLabel: string;
  locale: string | null;
};

type StartOptions = { kind: WriteKind; target: WriteTarget; context: WriteContext };

/**
 * "Write…" and "Continue writing" in a rich-text canvas: the insertion point is captured when the write
 * starts and follows the person's edits (ProseMirror position mapping), the model's Markdown comes back as
 * an editable proposal, and Insert puts the proposal's blocks there, or says the place is gone.
 */
export const useWriteProposal = (editor: Editor, about: WriteDocument) => {
  const write = useWriteText();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WriteKind>('section');
  /** Where the popover sits: the target, or its last place once it is gone (the popover then says so). */
  const [anchor, setAnchor] = useState<WriteTarget | null>(null);
  const [instruction, setInstruction] = useState('');
  const [context, setContext] = useState<WriteContext>({ before: '', after: '' });
  const [result, setResult] = useState<WriteResult | null>(null);
  /** Counts the answers, so the proposal editor starts over with each one. */
  const [answer, setAnswer] = useState(0);
  const [stale, setStale] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const targetRef = useRef<WriteTarget | null>(null);
  const titleRef = useRef<string | undefined>(undefined);

  // The insertion point follows every change to the document while the write is open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const follow = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged || !targetRef.current) {
        return;
      }
      const next = mapTarget(targetRef.current, transaction.mapping);
      targetRef.current = next;
      if (next) {
        setAnchor(next);
      } else {
        setStale(true);
      }
    };
    editor.on('transaction', follow);
    return () => {
      editor.off('transaction', follow);
    };
  }, [editor, open]);

  const resetProposal = () => {
    setResult(null);
    setHasText(false);
    setConfirmingDiscard(false);
    write.reset();
  };

  /** Asks the model, with the context captured when the write started (or `around`, while it starts). */
  const send = (writeKind: WriteKind, around: WriteContext, instruction?: string) => {
    const steer = instruction?.trim() ?? '';
    if (writeKind === 'section' && steer === '') {
      return;
    }
    const title = titleRef.current?.slice(0, ASSIST_WRITE_MAX_TITLE);
    const shared = {
      before: around.before,
      ...(around.after ? { after: around.after } : {}),
      ...(title ? { title } : {}),
      fieldLabel: about.fieldLabel,
      ...(about.locale ? { locale: about.locale } : {}),
    };
    const input: WriteInput =
      writeKind === 'section'
        ? { ...shared, kind: 'section', instruction: steer }
        : { ...shared, kind: 'continue', ...(steer ? { instruction: steer } : {}) };
    write.mutate(input, {
      onSuccess: (answered) => {
        setResult(answered);
        setAnswer((count) => count + 1);
      },
    });
  };

  const start = ({ kind: requested, target: at, context: around }: StartOptions) => {
    // Nothing to continue in an empty document: ask what to write instead.
    const next = requested === 'continue' && around.before.trim() === '' ? 'section' : requested;
    resetProposal();
    targetRef.current = at;
    titleRef.current = about.title();
    setAnchor(at);
    setInstruction('');
    setContext(around);
    setStale(false);
    setKind(next);
    setOpen(true);
    if (next === 'continue') {
      send('continue', around);
    }
  };

  const close = () => {
    setOpen(false);
    resetProposal();
    targetRef.current = null;
  };

  const insert = (content: JSONContent[]) => {
    const at = targetRef.current;
    const range = at ? insertionRange(editor.state.doc, at) : null;
    if (!range) {
      setStale(true);
      return;
    }
    if (content.length === 0 || editor.isDestroyed) {
      return;
    }
    close();
    editor.chain().insertContentAt(range, content, { updateSelection: true }).focus().run();
  };

  return {
    open,
    kind,
    anchor,
    /** The instruction being typed ("Try again" keeps it). */
    instruction,
    setInstruction,
    result,
    answer,
    stale,
    pending: write.isPending,
    error: write.error,
    hasText,
    setHasText,
    confirmingDiscard,
    start,
    /** Writes with the instruction ("Write…") or again ("Try again" on a continuation). */
    run: (preset?: string) => send(kind, context, preset ?? instruction),
    /** Back to the instruction (a section), or another continuation. */
    tryAgain: () => {
      resetProposal();
      if (kind === 'continue') {
        send('continue', context);
      }
    },
    /** Escape or a click outside: asks first while the proposal holds text. */
    requestClose: () => {
      if (result && hasText) {
        setConfirmingDiscard(true);
        return;
      }
      close();
    },
    keepEditing: () => setConfirmingDiscard(false),
    /** Discard, chosen on purpose (the footer's button or the confirm step). */
    discard: close,
    insert,
  };
};

export type WriteProposal = ReturnType<typeof useWriteProposal>;
