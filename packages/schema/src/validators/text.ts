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
 * is not valid text; undefined when everything is. Walks arrays and plain objects in document order, without
 * recursion (no depth of a body can exhaust the stack); other values (numbers, buffers, dates) hold no text.
 */
type TextTask = { value: unknown; path: string; invalidKey?: boolean };

export const findInvalidText = (value: unknown, path = ''): string | undefined => {
  const stack: TextTask[] = [{ value, path }];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const current = next.value;
    if (next.invalidKey === true || (typeof current === 'string' && !isValidText(current))) {
      return next.path;
    }
    const children: TextTask[] = [];
    if (Array.isArray(current)) {
      current.forEach((item: unknown, index) =>
        children.push({ value: item, path: `${next.path}/${index}` }),
      );
    } else if (typeof current === 'object' && current !== null && isPlainObject(current)) {
      for (const [key, item] of Object.entries(current)) {
        const at = `${next.path}/${escapeSegment(key)}`;
        if (!isValidText(key)) {
          // Answered once everything before it was walked, as a recursive walk would.
          children.push({ value: undefined, path: at, invalidKey: true });
          break;
        }
        children.push({ value: item, path: at });
      }
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index] as TextTask);
    }
  }
  return undefined;
};
