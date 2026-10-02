import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, safeEqual, verifyTokenHash } from './tokens.js';

describe('tokens', () => {
  it('generates 32-byte base64url tokens that differ every time', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });

  it('hashes with SHA-256 and verifies in constant time', () => {
    const token = generateToken();
    const stored = hashToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTokenHash(token, stored)).toBe(true);
    expect(verifyTokenHash(`${token}x`, stored)).toBe(false);
  });

  it('compares strings of different lengths without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
});
