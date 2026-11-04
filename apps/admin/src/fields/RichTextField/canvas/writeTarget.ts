import type { Range } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Mappable } from '@tiptap/pm/transform';
import { ASSIST_WRITE_AFTER_CHARS, ASSIST_WRITE_BEFORE_CHARS } from '@/constants/assist';
import { topLevelBlockAt } from './blockMove';
import { textOfRange } from './rewriteSelection';

/**
 * Where a written proposal goes: a point between top-level blocks (`from === to`), or an empty paragraph
 * it replaces (`from`..`to` spans that paragraph).
 */
export type WriteTarget = { from: number; to: number };

/** The text around the insertion point, sent to the model (the server reads no entry). */
export type WriteContext = { before: string; after: string };

const isEmptyParagraph = (node: ProseMirrorNode | null | undefined) =>
  node?.type.name === 'paragraph' && node.content.size === 0;

/**
 * The target for a write started from the `/` menu, once the `/query` is removed: the top-level block the
 * cursor was in is replaced when it is now an empty paragraph, otherwise the proposal goes after it.
 */
export const targetAtBlock = (doc: ProseMirrorNode, cursor: number): WriteTarget => {
  const block = topLevelBlockAt(doc, cursor);
  if (!block) {
    return { from: doc.content.size, to: doc.content.size };
  }
  const end = block.pos + block.node.nodeSize;
  return isEmptyParagraph(block.node) ? { from: block.pos, to: end } : { from: end, to: end };
};

/** The target for a `+` menu: a boundary position, or the empty paragraph at a field's edge it replaces. */
export const targetOf = (doc: ProseMirrorNode, at: number | Range): WriteTarget => {
  const size = doc.content.size;
  const clamp = (pos: number) => Math.min(Math.max(pos, 0), size);
  return typeof at === 'number'
    ? { from: clamp(at), to: clamp(at) }
    : { from: clamp(at.from), to: clamp(at.to) };
};

/**
 * The text before and after a position (`split`, the cursor for `/`, the target for `+`), as much as the
 * server takes: the end of what comes before and the start of what follows.
 */
export const contextAround = (doc: ProseMirrorNode, split: number, after: number): WriteContext => {
  const size = doc.content.size;
  const before = textOfRange(doc, { from: 0, to: Math.min(split, size) });
  const rest = textOfRange(doc, { from: Math.min(after, size), to: size });
  return {
    before: before.slice(-ASSIST_WRITE_BEFORE_CHARS).trimStart(),
    after: rest.slice(0, ASSIST_WRITE_AFTER_CHARS).trimEnd(),
  };
};

/**
 * The target after a change to the document (the person kept writing), or null when the place it pointed
 * at was deleted (the block before a point removed, the paragraph to replace removed, the document reloaded).
 */
export const mapTarget = (target: WriteTarget, mapping: Mappable): WriteTarget | null => {
  if (target.from === target.to) {
    // A point stays right after the block it follows, even when a block is added at the same place.
    const point = mapping.mapResult(target.from, -1);
    return point.deleted ? null : { from: point.pos, to: point.pos };
  }
  const from = mapping.mapResult(target.from, 1);
  const to = mapping.mapResult(target.to, -1);
  return from.deleted || to.deleted || to.pos <= from.pos ? null : { from: from.pos, to: to.pos };
};

/**
 * The range to insert into, checked against the document as it is now: a point must still be a boundary
 * between top-level blocks; a paragraph to replace that someone typed into meanwhile is kept, and the
 * proposal goes after it. Null when neither holds (start again).
 */
export const insertionRange = (doc: ProseMirrorNode, target: WriteTarget): Range | null => {
  const size = doc.content.size;
  if (target.to > size || target.from < 0) {
    return null;
  }
  const atBoundary = (pos: number) => doc.resolve(pos).depth === 0;
  if (target.from === target.to) {
    return atBoundary(target.from) ? { from: target.from, to: target.from } : null;
  }
  const node = doc.nodeAt(target.from);
  if (
    atBoundary(target.from) &&
    isEmptyParagraph(node) &&
    target.from + (node?.nodeSize ?? 0) === target.to
  ) {
    return { from: target.from, to: target.to };
  }
  return atBoundary(target.to) ? { from: target.to, to: target.to } : null;
};
