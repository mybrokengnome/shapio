import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWebhookEvent } from './webhookEvent';

const SECRET = 'test-secret';
const NOW = new Date('2026-10-03T12:00:00Z');
const BODY = JSON.stringify({
  id: 'evt-1',
  type: 'entry.published',
  createdAt: NOW.toISOString(),
  site: null,
  data: {},
});

const signed = (body: string, { secret = SECRET, at = NOW } = {}) => {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return new Request('http://localhost/api/revalidate', {
    method: 'POST',
    headers: { 'x-shapio-timestamp': timestamp, 'x-shapio-signature': `v1=${signature}` },
    body,
  });
};

describe('readWebhookEvent', () => {
  it('accepts a correctly signed event', async () => {
    const read = await readWebhookEvent(signed(BODY), SECRET, NOW);
    expect(read).toMatchObject({ ok: true, event: { id: 'evt-1', type: 'entry.published' } });
  });

  it('refuses another secret, a stale timestamp and a missing signature', async () => {
    expect(await readWebhookEvent(signed(BODY, { secret: 'other' }), SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      reason: 'signature mismatch',
    });
    const stale = new Date(NOW.getTime() - 10 * 60 * 1000);
    expect(await readWebhookEvent(signed(BODY, { at: stale }), SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
    });
    const unsigned = new Request('http://localhost/api/revalidate', { method: 'POST', body: BODY });
    expect(await readWebhookEvent(unsigned, SECRET, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a body changed after signing', async () => {
    const request = signed(BODY);
    const tampered = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: BODY.replace('evt-1', 'evt-2'),
    });
    expect(await readWebhookEvent(tampered, SECRET, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it('answers 503 without a configured secret and 400 for a signed non-event', async () => {
    expect(await readWebhookEvent(signed(BODY), undefined, NOW)).toMatchObject({ ok: false, status: 503 });
    expect(await readWebhookEvent(signed('[]'), SECRET, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(await readWebhookEvent(signed('not json'), SECRET, NOW)).toMatchObject({ ok: false, status: 400 });
  });
});
