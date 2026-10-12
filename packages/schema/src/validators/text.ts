/**
 * Text no database can store as is: PostgreSQL `text` and `jsonb` reject U+0000, and `jsonb` rejects an
 * unpaired UTF-16 surrogate. Shapio refuses both everywhere it takes input, so every database accepts the same
 * values (SQLite would store them).
 */
export const INVALID_TEXT_MESSAGE = 'must not contain NUL characters or unpaired surrogates';

export const isValidText = (text: string): boolean => !text.includes('\u0000') && text.isWellFormed();

/**
 * Parsed JSON and querystrings; not buffers, dates or class instances. Querystring parsers build objects
 * without `Object.prototype`, either with no prototype or with an empty one that has none.
 */
const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null;
};

const escapeSegment = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');

/**
 * The JSON pointer (relative to `value`, `''` for the value itself) of the first string, or object key, that
 * is not valid text; undefined when everything is. Walks arrays and plain objects; other values (numbers,
 * buffers, dates) hold no text.
 */
export const findInvalidText = (value: unknown, path = ''): string | undefined => {
  if (typeof value === 'string') {
    return isValidText(value) ? undefined : path;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findInvalidText(item, `${path}/${index}`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null || !isPlainObject(value)) {
    return undefined;
  }
  for (const [key, item] of Object.entries(value)) {
    const at = `${path}/${escapeSegment(key)}`;
    if (!isValidText(key)) {
      return at;
    }
    const found = findInvalidText(item, at);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};
