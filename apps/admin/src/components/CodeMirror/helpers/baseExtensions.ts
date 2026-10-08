import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type KeyBinding,
} from '@codemirror/view';
import { codeHighlightStyle, codeMirrorTheme } from './theme';

export type BaseExtensionsOptions = {
  /** The accessible name as text (`aria-label`). Use this or `labelledBy`. */
  label?: string;
  /** Id of the visible label (`aria-labelledby`). */
  labelledBy?: string;
  /** The content element's id (what a field's ids point at). */
  id?: string;
  /** Ids of the elements describing the editor (`aria-describedby`). */
  describedBy?: string | undefined;
  invalid?: boolean;
  readOnly: boolean;
  /** Bindings tried before the default keymap (completion, close brackets, lint). */
  keys?: readonly KeyBinding[];
};

/** The content element's ARIA wiring, plus an explicit tab stop (axe does not count a contenteditable). */
const contentAttributes = ({
  label,
  labelledBy,
  id,
  describedBy,
  invalid,
  readOnly,
}: BaseExtensionsOptions) =>
  EditorView.contentAttributes.of({
    tabindex: '0',
    ...(id ? { id } : {}),
    ...(label ? { 'aria-label': label } : {}),
    ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': 'true' } : {}),
    ...(readOnly ? { 'aria-readonly': 'true' } : {}),
  });

/**
 * What every CodeMirror editor in the admin has: line numbers, history, bracket matching, the active line,
 * syntax highlighting on the theme tokens and the default keymap. Tab is left unbound: it moves focus out of
 * the editor, as everywhere else in the admin; Mod-] and Mod-[ indent and outdent.
 */
export const baseExtensions = (options: BaseExtensionsOptions): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  drawSelection(),
  history(),
  indentOnInput(),
  bracketMatching(),
  syntaxHighlighting(codeHighlightStyle),
  codeMirrorTheme,
  keymap.of([...(options.keys ?? []), ...defaultKeymap, ...historyKeymap]),
  EditorState.readOnly.of(options.readOnly),
  contentAttributes(options),
];
