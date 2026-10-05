import { describe, expect, it, vi } from 'vitest';
import { createDeliveryClient } from './deliveryClient.js';
import type { RequestFn } from './request.js';

describe('createDeliveryClient', () => {
  it("sends the HTTP client's delivery, site and snapshot paths to any transport, tagged for the site", async () => {
    const calls: Array<[string, unknown]> = [];
    const request = vi.fn(async (path: string, options?: unknown) => {
      calls.push([path, options]);
      return {};
    }) as unknown as RequestFn;
    const client = createDeliveryClient(request, { site: 'blog', next: { revalidate: 60 } });

    await client.delivery.list('articles', { locale: 'fr', snapshot: 3 });
    await client.delivery.get('articles', 'e1');
    await client.site.get();
    await client.snapshots.current();

    expect(calls.map(([path]) => path)).toEqual([
      '/api/content/articles?locale=fr&snapshot=3',
      '/api/content/articles/e1',
      '/api/site',
      '/api/snapshots/current',
    ]);
    expect(calls[0]?.[1]).toEqual({
      cache: 'force-cache',
      next: { tags: ['shapio:site:blog', 'shapio:articles'] },
    });
    expect(calls[1]?.[1]).toEqual({
      next: { tags: ['shapio:site:blog', 'shapio:articles', 'shapio:articles:e1'], revalidate: 60 },
    });
  });
});
