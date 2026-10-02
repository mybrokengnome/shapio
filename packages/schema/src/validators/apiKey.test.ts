import { describe, expect, it } from 'vitest';
import { checkApiKeySyntax, foldApiKey, isApiKeySyntaxValid, MAX_API_KEY_LENGTH } from './apiKey.js';

describe('isApiKeySyntaxValid', () => {
  it.each(['page', 'blogPost', '_internal', 'Hero2', 'a'])('accepts %s', (key) => {
    expect(isApiKeySyntaxValid(key)).toBe(true);
  });

  it.each(['', '2fast', 'blog-post', 'blog post', 'café', 'a.b', 'x;drop'])('rejects %j', (key) => {
    expect(isApiKeySyntaxValid(key)).toBe(false);
  });
});

describe('checkApiKeySyntax', () => {
  it('accepts a valid key', () => {
    expect(checkApiKeySyntax('blogPost')).toBeNull();
  });

  it('rejects invalid characters', () => {
    expect(checkApiKeySyntax('blog-post')?.code).toBe('API_KEY_INVALID');
  });

  it('rejects keys over the length limit', () => {
    expect(checkApiKeySyntax('a'.repeat(MAX_API_KEY_LENGTH + 1))?.code).toBe('API_KEY_TOO_LONG');
    expect(checkApiKeySyntax('a'.repeat(MAX_API_KEY_LENGTH))).toBeNull();
  });

  it('rejects the GraphQL-reserved __ prefix', () => {
    expect(checkApiKeySyntax('__typename')?.code).toBe('API_KEY_RESERVED_PREFIX');
    expect(checkApiKeySyntax('_single')).toBeNull();
  });
});

describe('foldApiKey', () => {
  it('folds case so Title and title collide', () => {
    expect(foldApiKey('Title')).toBe(foldApiKey('title'));
  });
});
