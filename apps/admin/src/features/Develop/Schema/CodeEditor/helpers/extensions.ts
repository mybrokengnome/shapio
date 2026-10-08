import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { json, jsonLanguage, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { hoverTooltip } from '@codemirror/view';
import type { ValidationIssue } from '@shapio/schema';
import { baseExtensions } from '@/components/CodeMirror/helpers/baseExtensions';
import type { JSONSchema7 } from './editorSchema';
import { rangeOfPointer } from './pointer';
import { schemaCompletion, schemaHover } from './schemaAssist';

/** Issues from the server's validators (JSON-pointer paths) as diagnostics on the text they are about. */
const semanticLinter = (lint: (text: string) => readonly ValidationIssue[]) =>
  linter(
    (view): Diagnostic[] =>
      lint(view.state.doc.toString()).map((issue) => ({
        ...rangeOfPointer(view.state, issue.path),
        severity: 'error',
        message: `${issue.path || '/'}: ${issue.message}`,
        source: issue.code,
      })),
    { delay: 300 },
  );

export type EditorOptions = {
  label: string;
  /** Id of the element listing the file's problems (`aria-describedby`). */
  describedBy: string | undefined;
  readOnly: boolean;
  schema: JSONSchema7 | undefined;
  /** Semantic issues for a text; a new function reconfigures the editor, which lints again. */
  lint: (text: string) => readonly ValidationIssue[];
};

/**
 * CodeMirror set up for schema files: the shared base (theme, highlighting, Tab left unbound) plus JSON,
 * close brackets, schema completion and hover, and JSON and semantic lint.
 */
export const editorExtensions = ({
  label,
  describedBy,
  readOnly,
  schema,
  lint,
}: EditorOptions): Extension[] => [
  ...baseExtensions({
    label,
    describedBy,
    readOnly,
    keys: [...closeBracketsKeymap, ...completionKeymap, ...lintKeymap],
  }),
  closeBrackets(),
  autocompletion(),
  json(),
  lintGutter(),
  linter(jsonParseLinter()),
  semanticLinter(lint),
  ...(schema
    ? [jsonLanguage.data.of({ autocomplete: schemaCompletion(schema) }), hoverTooltip(schemaHover(schema))]
    : []),
];
