/** Model text as a field value: surrounding quotes and whitespace removed, whitespace runs collapsed. */
export const cleanModelText = (text: string, { singleLine = false } = {}): string => {
  let cleaned = text
    .trim()
    .replace(/^(["'“‘«])([\s\S]*)(["'”’»])$/u, '$2')
    .trim();
  if (singleLine) {
    cleaned = cleaned.replace(/\s+/g, ' ');
  }
  return cleaned;
};

/**
 * Text cut to `max` characters at a word boundary (an ellipsis marks the cut), or as it was when it fits.
 * Characters are counted as code points, like the content validator does.
 */
export const fitToLength = (text: string, max: number | undefined): { text: string; truncated: boolean } => {
  const chars = [...text];
  if (max === undefined || chars.length <= max) {
    return { text, truncated: false };
  }
  const head = chars.slice(0, Math.max(0, max - 1)).join('');
  const boundary = head.search(/\s\S*$/);
  const cut = (boundary > max / 2 ? head.slice(0, boundary) : head).replace(/[\s,;:.–—-]+$/u, '');
  return { text: `${cut}…`, truncated: true };
};
