import type { IssueCode } from './issues.js';

/**
 * API keys (models, components, fields) must be valid GraphQL names from day one (CONTRIBUTING.md rule 4),
 * so GraphQL can expose them without renames.
 */
export const API_KEY_PATTERN = /^[_A-Za-z][_0-9A-Za-z]*$/;
export const MAX_API_KEY_LENGTH = 64;

export const isApiKeySyntaxValid = (key: string): boolean => API_KEY_PATTERN.test(key);

/**
 * Syntax checks shared by every kind of API key (`noun` names it in messages, e.g. "plural API ID").
 * Returns the first problem, or null.
 */
export const checkApiKeySyntax = (
  key: string,
  noun = 'API ID',
): { code: IssueCode; message: string } | null => {
  if (!isApiKeySyntaxValid(key)) {
    return {
      code: 'API_KEY_INVALID',
      message: `"${key}" is not a valid ${noun}: use letters, digits and _, not starting with a digit`,
    };
  }
  if (key.length > MAX_API_KEY_LENGTH) {
    return { code: 'API_KEY_TOO_LONG', message: `${noun}s are at most ${MAX_API_KEY_LENGTH} characters` };
  }
  // GraphQL reserves the `__` prefix for introspection.
  if (key.startsWith('__')) {
    return {
      code: 'API_KEY_RESERVED_PREFIX',
      message: `${noun}s must not start with "__" (reserved by GraphQL)`,
    };
  }
  return null;
};

/** Case-folded form used for every collision check: `Title` and `title` collide. */
export const foldApiKey = (key: string): string => key.toLowerCase();
