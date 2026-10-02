import { forceLinting } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ValidationIssue } from '@shapio/schema';
import { useEffect, useRef } from 'react';
import type { JSONSchema7 } from '../helpers/editorSchema';
import { editorExtensions } from '../helpers/extensions';

export type CodeMirrorViewProps = {
  value: string;
  onChange: (text: string) => void;
  /** The editor's accessible name ("schema/models/article.json"). */
  label: string;
  /** Id of the element listing the problems (linked with `aria-describedby`). */
  describedBy?: string;
  readOnly: boolean;
  schema: JSONSchema7 | undefined;
  /** Semantic issues for a text (the server's validators); re-run whenever this function changes. */
  lint: (text: string) => readonly ValidationIssue[];
};

/**
 * The CodeMirror instance (its own lazy chunk). Created once per mount; the parent remounts it per file
 * with a `key`. Outside changes to `value` (a reload) replace the document; the editor's own edits flow out
 * through `onChange` and come back equal, so they are a no-op.
 */
export const View = ({
  value,
  onChange,
  label,
  describedBy,
  readOnly,
  schema,
  lint,
}: CodeMirrorViewProps) => {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, lint });

  useEffect(() => {
    latest.current = { onChange, lint };
    if (view.current) {
      forceLinting(view.current);
    }
  }, [onChange, lint]);

  useEffect(() => {
    if (!host.current) {
      return undefined;
    }
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: editorExtensions({
          label,
          describedBy,
          readOnly,
          schema,
          lint: () => latest.current.lint,
          onChange: (text) => latest.current.onChange(text),
        }),
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The document is seeded once; later `value` changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, describedBy, readOnly, schema]);

  useEffect(() => {
    const current = view.current;
    if (current && current.state.doc.toString() !== value) {
      current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={host} className="h-full min-h-0" />;
};
