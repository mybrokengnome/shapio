const MAX_LENGTH = 240;

/**
 * A stored field value as one line of text for a before/after row: strings as they are, scalars as text,
 * anything structured (rich text, components, relations) as compact JSON, cut at 240 characters.
 * `undefined`/`null` read as empty (the caller shows its "empty" placeholder).
 */
export const valueText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
};
