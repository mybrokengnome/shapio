import type { ValidationIssue } from '@shapio/schema';
import { useMemo } from 'react';
import { CodeMirror } from '@/components/CodeMirror';
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
 * The schema file editor (its own lazy chunk); the parent remounts it per file with a `key`. A change to any
 * setting (a new lint function included) reconfigures the running editor, which lints again.
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
  const extensions = useMemo(
    () => editorExtensions({ label, describedBy, readOnly, schema, lint }),
    [label, describedBy, readOnly, schema, lint],
  );
  return <CodeMirror value={value} onChange={onChange} extensions={extensions} />;
};
