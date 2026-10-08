import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

/**
 * CodeMirror's look, on the admin's theme tokens (CSS variables with a value per theme and variant), so every
 * editor follows the chosen look without a second palette.
 */
export const codeMirrorTheme = EditorView.theme({
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

/**
 * Token colours, from the text tokens only (`link`, the status colours, `muted-foreground`), so every look
 * keeps its contrast. JSON uses the first four rules; the rest cover HTML, CSS, JavaScript, YAML, Markdown.
 */
export const codeHighlightStyle = HighlightStyle.define([
  // JSON, YAML keys and CSS properties
  { tag: tags.propertyName, color: 'var(--link)' },
  { tag: [tags.string, tags.special(tags.string), tags.attributeValue], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: 'var(--warning)' },
  {
    tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation],
    color: 'var(--muted-foreground)',
  },
  // HTML
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--info)' },
  { tag: tags.attributeName, color: 'var(--link)' },
  // CSS and JavaScript
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword], color: 'var(--info)' },
  { tag: [tags.className, tags.typeName, tags.labelName], color: 'var(--warning)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--link)' },
  { tag: [tags.regexp, tags.escape], color: 'var(--destructive)' },
  { tag: [tags.comment, tags.meta, tags.processingInstruction], color: 'var(--muted-foreground)' },
  // Markdown
  { tag: tags.heading, color: 'var(--link)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: [tags.link, tags.url], color: 'var(--link)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--success)' },
  { tag: tags.invalid, color: 'var(--destructive)' },
]);
