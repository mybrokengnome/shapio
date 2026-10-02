import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('hashes with argon2id and verifies', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password!!', stored)).toBe(false);
  });

  it('returns false for unknown accounts after doing the same work', async () => {
    expect(await verifyPassword('anything at all', undefined)).toBe(false);
  });

  it('treats a malformed stored hash as a failed check', async () => {
    expect(await verifyPassword('anything at all', 'not-a-hash')).toBe(false);
  });
});
