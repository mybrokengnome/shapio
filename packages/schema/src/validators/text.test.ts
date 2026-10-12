import { describe, expect, it } from 'vitest';
import { findInvalidText, isValidText } from './text.js';

describe('findInvalidText', () => {
  it('accepts ordinary text, emoji, and values without text', () => {
    expect(isValidText('café 🎉')).toBe(true);
    expect(findInvalidText({ a: ['x', 1, null, true, { b: 'ok 🎉' }] })).toBeUndefined();
    expect(findInvalidText(Buffer.from([0, 0xd8]))).toBeUndefined();
  });

  it('points at a NUL character or an unpaired surrogate, in values and keys', () => {
    expect(findInvalidText('a\u0000b')).toBe('');
    expect(findInvalidText({ title: 'lone \ud800 surrogate' })).toBe('/title');
    expect(findInvalidText({ list: ['ok', 'end \udc00'] })).toBe('/list/1');
    expect(findInvalidText({ meta: { 'k\u0000': 'v' } })).toBe('/meta/k\u0000');
    expect(findInvalidText({ 'a/b': ['\u0000'] }, '/body')).toBe('/body/a~1b/0');
    // Parsed querystrings have no prototype, or an empty one without a prototype.
    expect(findInvalidText(Object.assign(Object.create(null) as object, { q: '\u0000' }))).toBe('/q');
    const empty = Object.create(Object.create(null) as object) as object;
    expect(findInvalidText(Object.assign(empty, { q: '\u0000' }))).toBe('/q');
  });
});
