import { richTextToPlainText } from './render.js';
import { validateRichText } from './validate.js';

/**
 * A stored rich text value (`{ format, version, doc }`) as one line of plain text: blocks separated by a
 * space, whitespace collapsed. For summaries (list cells, collapsed items, review rows), never for delivery.
 * Anything that is not a valid document (an unconverted value of a field that became rich text) reads as ''.
 */
export const richTextPlainText = (value: unknown): string => {
  const result = validateRichText(value);
  return result.ok ? richTextToPlainText(result.document).replace(/\s+/g, ' ').trim() : '';
};
