import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhookSignature } from './webhooks.js';

const SECRET = 'whsec_test';
const BODY = '{"type":"change_set.shipped"}';
const NOW = new Date('2026-10-03T12:00:00.000Z');
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1000));
/** The server's scheme, computed independently (apps/api/src/publishing/signature.ts). */
const sign = (secret: string, timestamp: string, body: string) =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')}`;

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature, also among several (secret rotation)', async () => {
    const signature = sign(SECRET, TIMESTAMP, BODY);
    await expect(
      verifyWebhookSignature({ secret: SECRET, signature, timestamp: TIMESTAMP, body: BODY, now: NOW }),
    ).resolves.toEqual({ ok: true });
    await expect(
      verifyWebhookSignature({
        secret: SECRET,
        signature: `${sign('old', TIMESTAMP, BODY)}, ${signature}`,
        timestamp: TIMESTAMP,
        body: BODY,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('refuses a tampered body, a wrong secret, a stale timestamp and missing headers', async () => {
    const signature = sign(SECRET, TIMESTAMP, BODY);
    const check = (input: Partial<Parameters<typeof verifyWebhookSignature>[0]>) =>
      verifyWebhookSignature({
        secret: SECRET,
        signature,
        timestamp: TIMESTAMP,
        body: BODY,
        now: NOW,
        ...input,
      });
    await expect(check({ body: `${BODY} ` })).resolves.toEqual({ ok: false, reason: 'signature mismatch' });
    await expect(check({ secret: 'other' })).resolves.toEqual({ ok: false, reason: 'signature mismatch' });
    await expect(check({ now: new Date(NOW.getTime() + 301_000) })).resolves.toEqual({
      ok: false,
      reason: 'timestamp outside the allowed window',
    });
    await expect(check({ signature: undefined })).resolves.toEqual({
      ok: false,
      reason: 'missing signature or timestamp',
    });
    await expect(check({ timestamp: 'abc' })).resolves.toMatchObject({ ok: false });
  });
});
