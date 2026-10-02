import { describe, expect, it } from 'vitest';
import { signMediaGet, signUploadGrant, verifyMediaGet, verifyUploadGrant } from './signing.js';

const SECRET = 'x'.repeat(40);
const KEY = 'private/3f2b8c1e-6a4d-4b7e-9c1a-2d3e4f5a6b7c/token/file.pdf';
const now = Date.UTC(2026, 9, 2);
const future = now / 1000 + 60;

describe('media URL signing', () => {
  it('accepts a valid, unexpired signature', () => {
    expect(verifyMediaGet(SECRET, KEY, future, signMediaGet(SECRET, KEY, future), now)).toBe('valid');
  });

  it('reports expiry only for an authentic signature', () => {
    const past = now / 1000 - 1;
    expect(verifyMediaGet(SECRET, KEY, past, signMediaGet(SECRET, KEY, past), now)).toBe('expired');
  });

  it.each([
    ['another key', `${KEY}x`, future],
    ['a later expiry', KEY, future + 1],
  ])('rejects a signature reused for %s', (_label, key, expires) => {
    expect(verifyMediaGet(SECRET, key, expires, signMediaGet(SECRET, KEY, future), now)).toBe('invalid');
  });

  it('rejects other secrets, garbage and non-integer expiries', () => {
    const signature = signMediaGet(SECRET, KEY, future);
    expect(verifyMediaGet('y'.repeat(40), KEY, future, signature, now)).toBe('invalid');
    expect(verifyMediaGet(SECRET, KEY, future, 'abc', now)).toBe('invalid');
    expect(verifyMediaGet(SECRET, KEY, Number.NaN, signature, now)).toBe('invalid');
  });

  it('keeps upload and download signatures apart', () => {
    const uploadSignature = signUploadGrant(SECRET, KEY, future);
    expect(verifyUploadGrant(SECRET, KEY, future, uploadSignature, now)).toBe('valid');
    expect(verifyMediaGet(SECRET, KEY, future, uploadSignature, now)).toBe('invalid');
  });
});
