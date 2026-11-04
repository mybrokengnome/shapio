import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, type EditorState } from '@tiptap/pm/state';
import type { TextRange } from '../selectionAnchor';

/** Blocks of the selection are sent to the model separated by a blank line, and come back the same way. */
const BLOCK_SEPARATOR = '\n\n';

export type CapturedSelection = TextRange & { text: string };

/** The plain text of a range: blocks separated by a blank line, images and other leaves left out. */
export const textOfRange = (doc: ProseMirrorNode, { from, to }: TextRange) =>
  doc.textBetween(from, to, BLOCK_SEPARATOR, '');

/**
 * A selection's range held to the text it covers. A triple-click selects a paragraph up to the start of the
 * next block (or from before it, between blocks); replacing that would also take the boundary and leave an
 * empty paragraph. Each end moves into the nearest textblock: the start forward, an end at the very start of
 * a block (or between blocks) back to the end of the text before it.
 */
export const textRangeOf = (doc: ProseMirrorNode, { from, to }: TextRange): TextRange => {
  const start = Selection.findFrom(doc.resolve(from), 1, true)?.from ?? from;
  const $to = doc.resolve(to);
  const atBlockStart = $to.parent.isTextblock && $to.parentOffset === 0 && to > start;
  const end = !$to.parent.isTextblock
    ? (Selection.findFrom($to, -1, true)?.to ?? to)
    : atBlockStart
      ? (Selection.findFrom(doc.resolve($to.before()), -1, true)?.to ?? to)
      : to;
  return end > start ? { from: start, to: end } : { from, to };
};

/** The selected text and where it is, or null when nothing but whitespace is selected. */
export const captureSelection = (state: EditorState): CapturedSelection | null => {
  if (state.selection.empty) {
    return null;
  }
  const range = textRangeOf(state.doc, state.selection);
  const text = textOfRange(state.doc, range);
  return text.trim() === '' ? null : { ...range, text };
};

/** The range still holds the text that was sent (nobody typed into it meanwhile). */
export const isRangeUnchanged = (doc: ProseMirrorNode, captured: CapturedSelection) =>
  captured.to <= doc.content.size && textOfRange(doc, captured) === captured.text;

const inlineOf = (paragraph: string): JSONContent[] =>
  paragraph
    .split('\n')
    .flatMap((line, index): JSONContent[] => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line === '' ? [] : [{ type: 'text', text: line }]),
    ]);

/**
 * The rewritten text as content to put in place of the selection. One paragraph stays inline, so it takes
 * the block it lands in (a heading stays a heading); several become paragraphs. Formatting marks are not
 * carried over (v1): the result is plain text, as the rewrite popover says.
 */
export const contentOfRewrite = (text: string): JSONContent[] => {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim() !== '');
  if (paragraphs.length <= 1) {
    return inlineOf(paragraphs[0] ?? '');
  }
  return paragraphs.map((paragraph) => ({ type: 'paragraph', content: inlineOf(paragraph) }));
};
