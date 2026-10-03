import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  SIGNATURE_HEADER,
  signedHeaders,
  TIMESTAMP_HEADER,
  verifySignature,
} from './signature.js';

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"type":"entry.published"}';
  const now = new Date('2026-10-02T12:00:00Z');

  it('signs "<timestamp>.<body>" with HMAC-SHA256 (documented format)', () => {
    const headers = signedHeaders(secret, body, now);
    const timestamp = Math.floor(now.getTime() / 1000);
    const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(headers).toEqual({
      'x-shapio-timestamp': String(timestamp),
      'x-shapio-signature': `v1=${expected}`,
    });
  });

  it('verifies, and rejects tampering, other secrets and stale timestamps', () => {
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = computeSignature(secret, Number(timestamp), body);
    expect(verifySignature(secret, { signature, timestamp, body }, now)).toEqual({ ok: true });
    expect(verifySignature(secret, { signature, timestamp, body: `${body} ` }, now).ok).toBe(false);
    expect(verifySignature('other', { signature, timestamp, body }, now).ok).toBe(false);
    expect(
      verifySignature(secret, { signature, timestamp, body }, new Date(now.getTime() + 301_000)).ok,
    ).toBe(false);
    expect(verifySignature(secret, { signature: undefined, timestamp, body }, now).ok).toBe(false);
    expect(verifySignature(secret, { signature: `v1=bad, ${signature}`, timestamp, body }, now).ok).toBe(
      true,
    );
  });

  it("is what @shapio/client's verifyWebhookSignature accepts (one scheme on both ends)", async () => {
    const headers = signedHeaders(secret, body, now);
    await expect(
      verifyWebhookSignature({
        secret,
        signature: headers[SIGNATURE_HEADER],
        timestamp: headers[TIMESTAMP_HEADER],
        body,
        now,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
