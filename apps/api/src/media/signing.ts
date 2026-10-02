import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC signatures for media capabilities, keyed by the instance signing secret (`app.signingSecret`).
 * Each purpose has its own prefix so a signature for one can never be replayed as another.
 */
type SignedPurpose = 'media-get' | 'media-upload';

const sign = (secret: string, purpose: SignedPurpose, subject: string, expiresAt: number): string =>
  createHmac('sha256', secret).update(`${purpose}\n${subject}\n${expiresAt}`).digest('base64url');

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export type SignatureCheck = 'valid' | 'invalid' | 'expired';

const verify = (
  secret: string,
  purpose: SignedPurpose,
  subject: string,
  expiresAt: number,
  signature: string,
  now: number,
): SignatureCheck => {
  if (!Number.isSafeInteger(expiresAt) || !safeEqual(sign(secret, purpose, subject, expiresAt), signature)) {
    return 'invalid';
  }
  return expiresAt * 1000 <= now ? 'expired' : 'valid';
};

/** `expiresAt` is in Unix seconds. */
export const signMediaGet = (secret: string, key: string, expiresAt: number): string =>
  sign(secret, 'media-get', key, expiresAt);

export const verifyMediaGet = (
  secret: string,
  key: string,
  expiresAt: number,
  signature: string,
  now = Date.now(),
): SignatureCheck => verify(secret, 'media-get', key, expiresAt, signature, now);

/** The capability to upload bytes for one grant (local driver), sent as a form field like an S3 policy. */
export const signUploadGrant = (secret: string, grantId: string, expiresAt: number): string =>
  sign(secret, 'media-upload', grantId, expiresAt);

export const verifyUploadGrant = (
  secret: string,
  grantId: string,
  expiresAt: number,
  signature: string,
  now = Date.now(),
): SignatureCheck => verify(secret, 'media-upload', grantId, expiresAt, signature, now);
