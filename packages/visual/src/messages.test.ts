import { describe, expect, it } from 'vitest';
import { normalizeFieldPath, parseAdminMessage, parseSiteMessage } from './messages.js';

const ID = '3f1c2b9a-8d7e-4f60-9a1b-2c3d4e5f6a7b';

describe('normalizeFieldPath', () => {
  it('turns API ID paths into JSON pointers', () => {
    expect(normalizeFieldPath('title')).toBe('/title');
    expect(normalizeFieldPath('/sections/2/heading')).toBe('/sections/2/heading');
  });

  it.each(['', '//', 'a//b', 'a b', 'a/<b>', 'x'.repeat(513), 42, null])('refuses %j', (path) => {
    expect(normalizeFieldPath(path)).toBeUndefined();
  });
});

describe('parseSiteMessage', () => {
  it('accepts ready and focus messages of this protocol version', () => {
    expect(parseSiteMessage({ type: 'shapio:ready', v: 1 })).toEqual({ type: 'shapio:ready', v: 1 });
    expect(
      parseSiteMessage({ type: 'shapio:focus', v: 1, entryId: ID, path: 'title', locale: 'fr' }),
    ).toEqual({
      type: 'shapio:focus',
      v: 1,
      entryId: ID,
      path: '/title',
      locale: 'fr',
    });
  });

  it.each([
    ['not an object', 'shapio:ready'],
    ['another version', { type: 'shapio:ready', v: 2 }],
    ['an unknown type', { type: 'shapio:other', v: 1 }],
    ['an entry ID that is not a UUID', { type: 'shapio:focus', v: 1, entryId: 'x', path: 'title' }],
    ['a malformed path', { type: 'shapio:focus', v: 1, entryId: ID, path: '../admin' }],
    ['a malformed locale', { type: 'shapio:focus', v: 1, entryId: ID, path: 'title', locale: '<fr>' }],
  ])('ignores %s', (_case, data) => {
    expect(parseSiteMessage(data)).toBeUndefined();
  });
});

describe('parseAdminMessage', () => {
  it('accepts refresh only', () => {
    expect(parseAdminMessage({ type: 'shapio:refresh', v: 1 })).toEqual({ type: 'shapio:refresh', v: 1 });
    expect(parseAdminMessage({ type: 'shapio:focus', v: 1 })).toBeUndefined();
    expect(parseAdminMessage({ type: 'shapio:refresh' })).toBeUndefined();
  });
});
