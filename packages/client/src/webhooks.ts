/**
 * Verifying Shapio's signed webhooks and deploy triggers on the receiving side (a site's revalidate route,
 * a build hook). The scheme is the server's (`apps/api/src/publishing/signature.ts`):
 * `X-Shapio-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>` with
 * `X-Shapio-Timestamp: <unix seconds>`; several comma-separated `v1=` values are accepted (secret rotation).
 * Uses Web Crypto, so it runs in Node, edge runtimes and browsers alike.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'x-shapio-signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'x-shapio-timestamp';
export const WEBHOOK_EVENT_HEADER = 'x-shapio-event';
/** Requests signed further from now than this are rejected (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

const SIGNATURE_VERSION = 'v1';

export type WebhookSignatureInput = {
  /** The webhook's or connection's signing secret. */
  secret: string;
  /** The `X-Shapio-Signature` header. */
  signature: string | null | undefined;
  /** The `X-Shapio-Timestamp` header. */
  timestamp: string | null | undefined;
  /** The raw request body, exactly as received (not re-serialised JSON). */
  body: string;
  /** Defaults to the current time. */
  now?: Date;
  /** Defaults to WEBHOOK_TOLERANCE_SECONDS. */
  toleranceSeconds?: number;
};

export type WebhookSignatureCheck = { ok: true } | { ok: false; reason: string };

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Compares two strings without returning early on the first difference. */
const constantTimeEqual = (a: string, b: string) => {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
};

const expectedSignature = async (secret: string, timestamp: number, body: string) => {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
  return `${SIGNATURE_VERSION}=${toHex(mac)}`;
};

/** Checks a Shapio signature; `{ ok: false, reason }` says why it was refused (never throws for bad input). */
export const verifyWebhookSignature = async ({
  secret,
  signature,
  timestamp,
  body,
  now = new Date(),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
}: WebhookSignatureInput): Promise<WebhookSignatureCheck> => {
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: 'missing signature or timestamp' };
  }
  const seconds = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - seconds) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp outside the allowed window' };
  }
  const expected = await expectedSignature(secret, seconds, body);
  const matches = signature
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => constantTimeEqual(candidate, expected));
  return matches ? { ok: true } : { ok: false, reason: 'signature mismatch' };
};
