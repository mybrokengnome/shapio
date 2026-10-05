import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type ShapioClientOptions } from './client.js';
import { shapioTags } from './nextCache.js';

const ok = () =>
  new Response(JSON.stringify({ data: {}, meta: { locale: 'en', snapshot: 4 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const setup = (options: Partial<ShapioClientOptions> = {}) => {
  const fetch = vi.fn(async () => ok());
  const client = createClient({ baseUrl: 'https://cms.test', token: 't', fetch, ...options });
  /** The `cache` and `next` fetch options of each call (absent keys stay absent). */
  const cacheInit = () =>
    (fetch.mock.calls as unknown as Array<[string, Record<string, unknown>]>).map(([, init]) => {
      const picked: Record<string, unknown> = {};
      for (const key of ['cache', 'next'] as const) {
        if (key in init) {
          picked[key] = init[key];
        }
      }
      return picked;
    });
  return { client, cacheInit };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shapioTags', () => {
  it('names the site, a model by route key and an entry', () => {
    expect(shapioTags.site('marketing')).toBe('shapio:site:marketing');
    expect(shapioTags.site()).toBe('shapio:site');
    expect(shapioTags.model('articles')).toBe('shapio:articles');
    expect(shapioTags.entry('articles', 'e1')).toBe('shapio:articles:e1');
  });
});

describe('Next.js fetch options on delivery reads', () => {
  it('adds nothing outside Next when no option is set, even to pinned reads', async () => {
    const { client, cacheInit } = setup({ site: 'marketing' });
    await client.delivery.list('articles');
    await client.delivery.get('articles', 'e1', { snapshot: 3 });
    await client.delivery.singleton('homepage');
    await client.site.get();
    expect(cacheInit()).toEqual([{}, {}, {}, {}]);
  });

  it('tags every read kind under Next, without a cache mode unless pinned', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { client, cacheInit } = setup({ site: 'marketing' });
    await client.delivery.list('articles', { locale: 'fr' });
    await client.delivery.get('articles', 'e1');
    await client.delivery.singleton('homepage');
    await client.site.get();
    await client.delivery.list('articles', { snapshot: 7 });
    await client.delivery.get('articles', 'e1', { snapshot: 7 });
    expect(cacheInit()).toEqual([
      { next: { tags: ['shapio:site:marketing', 'shapio:articles'] } },
      { next: { tags: ['shapio:site:marketing', 'shapio:articles', 'shapio:articles:e1'] } },
      { next: { tags: ['shapio:site:marketing', 'shapio:homepage'] } },
      { next: { tags: ['shapio:site:marketing'] } },
      { cache: 'force-cache', next: { tags: ['shapio:site:marketing', 'shapio:articles'] } },
      {
        cache: 'force-cache',
        next: { tags: ['shapio:site:marketing', 'shapio:articles', 'shapio:articles:e1'] },
      },
    ]);
  });

  it('uses the bare site tag when the client names no site', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    const { client, cacheInit } = setup();
    await client.site.get();
    await client.delivery.list('articles');
    expect(cacheInit()).toEqual([
      { next: { tags: ['shapio:site'] } },
      { next: { tags: ['shapio:site', 'shapio:articles'] } },
    ]);
  });

  it("passes the client's cache mode and revalidate, and pins snapshot reads to force-cache", async () => {
    const { client, cacheInit } = setup({ next: { cache: 'no-store', revalidate: 60 } });
    await client.delivery.list('articles');
    await client.delivery.list('articles', { snapshot: 2 });
    expect(cacheInit()).toEqual([
      { cache: 'no-store', next: { tags: ['shapio:site', 'shapio:articles'], revalidate: 60 } },
      { cache: 'force-cache', next: { tags: ['shapio:site', 'shapio:articles'] } },
    ]);
  });

  it("lets a read override the client's options, or turn them off", async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { client, cacheInit } = setup({ next: { cache: 'force-cache', revalidate: 300 } });
    await client.delivery.get('articles', 'e1', {}, { next: { revalidate: 10 } });
    await client.delivery.get('articles', 'e1', { snapshot: 2 }, { next: { cache: 'no-store' } });
    await client.delivery.singleton('homepage', {}, { next: false });
    await client.site.get({ next: { cache: 'no-store' } });
    expect(cacheInit()).toEqual([
      {
        cache: 'force-cache',
        next: { tags: ['shapio:site', 'shapio:articles', 'shapio:articles:e1'], revalidate: 10 },
      },
      {
        cache: 'no-store',
        next: { tags: ['shapio:site', 'shapio:articles', 'shapio:articles:e1'], revalidate: 300 },
      },
      {},
      { cache: 'no-store', next: { tags: ['shapio:site'], revalidate: 300 } },
    ]);
  });

  it('sends nothing with `next: false` on the client, unless a read asks', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { client, cacheInit } = setup({ next: false });
    await client.delivery.list('articles', { snapshot: 2 });
    await client.delivery.list('articles', {}, { next: { cache: 'force-cache' } });
    expect(cacheInit()).toEqual([
      {},
      { cache: 'force-cache', next: { tags: ['shapio:site', 'shapio:articles'] } },
    ]);
  });

  it('never touches snapshot, write or raw requests', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const { client, cacheInit } = setup({ next: { cache: 'force-cache' } });
    await client.snapshots.current();
    await client.snapshots.changes({ from: 1 });
    await client.request('/api/content/articles');
    expect(cacheInit()).toEqual([{}, {}, {}]);
  });
});
