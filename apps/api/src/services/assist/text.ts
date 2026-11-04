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

/**
 * Asks once, and once more for a shorter answer when the first is over `retryAbove` characters (the field's
 * maximum, or a soft target); then cuts to `maxLength` (`fitToLength`).
 */
export const askWithinLength = async (
  ask: (shorter: boolean) => Promise<string>,
  maxLength: number | undefined,
  retryAbove: number | undefined = maxLength,
): Promise<{ text: string; truncated: boolean }> => {
  let text = await ask(false);
  if (retryAbove !== undefined && [...text].length > retryAbove) {
    text = await ask(true);
  }
  return fitToLength(text, maxLength);
};

const MARKDOWN_FENCE = /^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i;

/** Model Markdown, trimmed; a fence around the whole answer (```markdown … ```) is taken off. */
export const unwrapFence = (text: string): string => {
  const trimmed = text.trim();
  return (MARKDOWN_FENCE.exec(trimmed)?.[1] ?? trimmed).trim();
};
