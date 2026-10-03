import { describe, expect, it, vi } from 'vitest';
import { createRateLimitedFetch, retryAfterMs } from './rateLimitRetry.js';

describe('createRateLimitedFetch', () => {
  it('retries 429 answers after Retry-After and returns the first other answer', async () => {
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '0.001' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await createRateLimitedFetch(base)('http://x/api', { method: 'POST', body: '{}' });
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(base.mock.calls[1]).toEqual(['http://x/api', { method: 'POST', body: '{}' }]);
  });

  it('backs off exponentially without Retry-After', () => {
    expect(retryAfterMs(new Response(null, { status: 429 }), 3)).toBe(4000);
  });
});
