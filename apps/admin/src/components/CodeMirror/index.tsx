import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { cn } from '@/helpers/cn';

/** Marks the transaction that replaces the document with an outside value (it is not an edit to report). */
const OUTSIDE_VALUE = Annotation.define<true>();

type CodeMirrorProps = {
  value: string;
  /** The editor's own edits, as the whole text. */
  onChange: (text: string) => void;
  /**
   * Everything the editor is set up with (`baseExtensions` plus a language and the rest). Memoise it: a new
   * value reconfigures the running editor (document, selection, history and focus stay).
   */
  extensions: Extension;
  className?: string;
};

/**
 * A CodeMirror 6 editor (import it from a lazy chunk). Created once per mount. Outside changes to `value` (a
 * reload, a restore) replace the document; the editor's own edits flow out through `onChange` and come back
 * equal, so they are a no-op.
 */
export const CodeMirror = ({ value, onChange, extensions, className }: CodeMirrorProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const setup = useRef({ compartment: new Compartment(), applied: extensions });
  const latestChange = useRef(onChange);

  useEffect(() => {
    latestChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!host.current) {
      return undefined;
    }
    const { compartment, applied } = setup.current;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          compartment.of(applied),
          EditorView.updateListener.of((update) => {
            const outside = update.transactions.some((transaction) => transaction.annotation(OUTSIDE_VALUE));
            if (update.docChanged && !outside) {
              latestChange.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The editor is created once; `value` and `extensions` changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current && setup.current.applied !== extensions) {
      setup.current.applied = extensions;
      current.dispatch({ effects: setup.current.compartment.reconfigure(extensions) });
    }
  }, [extensions]);

  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: value },
        annotations: OUTSIDE_VALUE.of(true),
      });
    }
  }, [value]);

  return <div ref={host} className={cn('h-full min-h-0', className)} />;
};
