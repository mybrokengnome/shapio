import { setTimeout as delay } from 'node:timers/promises';

/**
 * Waiting out the instance's rate limit (HTTP 429) for remote commands that send many requests (export,
 * import, importers). Honors `Retry-After`, else backs off exponentially.
 */
export const MAX_RATE_LIMIT_RETRIES = 8;

export const retryAfterMs = (response: Response, attempt: number) => {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 500 * 2 ** attempt;
};

/**
 * A fetch that retries 429 answers, for `createClient({ fetch })`. Only for re-sendable bodies (JSON strings,
 * FormData, Blobs), which is what the client sends; streamed bodies need a body factory (see `send`).
 */
export const createRateLimitedFetch =
  (base: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch =>
  async (input, init) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await base(input, init);
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
        return response;
      }
      await response.body?.cancel();
      await delay(retryAfterMs(response, attempt));
    }
  };
