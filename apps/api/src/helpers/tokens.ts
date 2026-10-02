import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** A fresh secret: 32 random bytes, base64url (43 characters). */
export const generateToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * What we store for a token: its SHA-256, hex. Tokens are high-entropy random values, so a fast hash is
 * enough (no salt or stretching needed); a leaked table does not reveal usable tokens.
 */
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** Constant-time comparison of two strings (unequal lengths return false without comparing). */
export const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Constant-time check that `token` hashes to `expectedHash`. */
export const verifyTokenHash = (token: string, expectedHash: string): boolean =>
  safeEqual(hashToken(token), expectedHash);
