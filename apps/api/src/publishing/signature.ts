import { createHmac } from 'node:crypto';
import { safeEqual } from '../helpers/tokens.js';

/**
 * Signatures on outbound webhooks and deploy triggers, and on inbound deploy callbacks:
 * `X-Shapio-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>` with
 * `X-Shapio-Timestamp: <unix seconds>`. The timestamp is signed so a captured request cannot be replayed
 * later; receivers should reject timestamps outside a few minutes.
 */
export const SIGNATURE_HEADER = 'x-shapio-signature';
export const TIMESTAMP_HEADER = 'x-shapio-timestamp';
export const EVENT_HEADER = 'x-shapio-event';
export const DELIVERY_HEADER = 'x-shapio-delivery';
export const SIGNATURE_VERSION = 'v1';
/** Inbound callbacks older or newer than this are rejected. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const computeSignature = (secret: string, timestamp: number, body: string): string =>
  `${SIGNATURE_VERSION}=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;

export const signedHeaders = (secret: string, body: string, now: Date): Record<string, string> => {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: computeSignature(secret, timestamp, body),
  };
};

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/** Verifies a signature header (several comma-separated `v1=` values are accepted, for secret rotation). */
export const verifySignature = (
  secret: string,
  {
    signature,
    timestamp,
    body,
  }: { signature: string | undefined; timestamp: string | undefined; body: string },
  now: Date,
): SignatureCheck => {
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: 'missing signature or timestamp' };
  }
  const seconds = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp outside the allowed window' };
  }
  const expected = computeSignature(secret, seconds, body);
  const matches = signature
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => safeEqual(candidate, expected));
  return matches ? { ok: true } : { ok: false, reason: 'signature mismatch' };
};
