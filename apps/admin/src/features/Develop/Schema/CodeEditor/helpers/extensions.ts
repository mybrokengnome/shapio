import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json, jsonLanguage, jsonParseLinter } from '@codemirror/lang-json';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { ValidationIssue } from '@shapio/schema';
import type { JSONSchema7 } from './editorSchema';
import { rangeOfPointer } from './pointer';
import { schemaCompletion, schemaHover } from './schemaAssist';

/**
 * CodeMirror 6 set up for schema files. Colours come from the admin's theme tokens (CSS variables with a
 * light and a dark value), so the editor follows the theme without a second palette. Tab is left unbound:
 * it moves focus out of the editor, as everywhere else in the admin.
 */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--card)',
    color: 'var(--card-foreground)',
    fontSize: 'var(--text-meta)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--foreground)', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 70%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--accent)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent)',
    outline: '1px solid var(--input)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontFamily: 'var(--font-sans)',
    maxWidth: '28rem',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-tooltip-hover, .cm-tooltip-lint': { padding: '6px 10px' },
  '.cm-diagnostic': { padding: '4px 8px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--destructive)' },
  '.cm-diagnosticSource': { color: 'var(--muted-foreground)' },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--destructive)',
    textUnderlineOffset: '3px',
  },
  '.cm-panels': { backgroundColor: 'var(--muted)', color: 'var(--foreground)' },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--link)' },
  { tag: tags.string, color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  { tag: [tags.brace, tags.squareBracket, tags.separator], color: 'var(--muted-foreground)' },
]);

/** Issues from the server's validators (JSON-pointer paths) as diagnostics on the text they are about. */
const semanticLinter = (lint: () => (text: string) => readonly ValidationIssue[]) =>
  linter(
    (view): Diagnostic[] =>
      lint()(view.state.doc.toString()).map((issue) => ({
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
  /** Reads the current semantic lint function (a ref, so a new one applies without rebuilding the editor). */
  lint: () => (text: string) => readonly ValidationIssue[];
  onChange: (text: string) => void;
};

export const editorExtensions = ({
  label,
  describedBy,
  readOnly,
  schema,
  lint,
  onChange,
}: EditorOptions): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  history(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  json(),
  syntaxHighlighting(highlight),
  theme,
  lintGutter(),
  linter(jsonParseLinter()),
  semanticLinter(lint),
  ...(schema
    ? [jsonLanguage.data.of({ autocomplete: schemaCompletion(schema) }), hoverTooltip(schemaHover(schema))]
    : []),
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap]),
  EditorState.readOnly.of(readOnly),
  // An explicit tab stop: axe does not count a contenteditable as the scroller's focusable content.
  EditorView.contentAttributes.of({
    tabindex: '0',
    'aria-label': label,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  }),
];
