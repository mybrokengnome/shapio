import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';

const setup = () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [], meta: { locale: 'en', snapshot: 4 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const client = createClient({ baseUrl: 'https://cms.test', token: 'tok', fetch });
  const url = (index = 0) => decodeURIComponent((fetch.mock.calls[index] as unknown as [string])[0]);
  return { client, url };
};

describe('delivery api', () => {
  it('lists a collection with filters, sort, locale and a pinned snapshot', async () => {
    const { client, url } = setup();
    await client.delivery.list('articles', {
      filters: { title: { $eq: 'A' } },
      sort: [{ field: 'title', direction: 'asc' }],
      locale: 'fr',
      fields: ['title'],
      snapshot: 12,
    });
    expect(url()).toBe(
      'https://cms.test/api/content/articles?filters[title][$eq]=A&sort=title:asc&locale=fr&fields=title&snapshot=12',
    );
  });

  it('reads one entry and a singleton, with only the snapshot when nothing else is set', async () => {
    const { client, url } = setup();
    await client.delivery.get('articles', 'e1', { snapshot: 3 });
    await client.delivery.singleton('homepage');
    expect(url(0)).toBe('https://cms.test/api/content/articles/e1?snapshot=3');
    expect(url(1)).toBe('https://cms.test/api/content/homepage');
  });

  it('asks for a rich-text shape, alone or after the snapshot', async () => {
    const { client, url } = setup();
    await client.delivery.get('articles', 'e1', { richText: 'html' });
    await client.delivery.list('articles', { locale: 'fr', snapshot: 4, richText: 'both' });
    expect(url(0)).toBe('https://cms.test/api/content/articles/e1?richText=html');
    expect(url(1)).toBe('https://cms.test/api/content/articles?locale=fr&snapshot=4&richText=both');
  });

  it('asks for resolved SEO fields', async () => {
    const { client, url } = setup();
    await client.delivery.get('articles', 'e1', { seo: 'resolved' });
    await client.delivery.list('articles', { richText: 'html', seo: 'resolved' });
    expect(url(0)).toBe('https://cms.test/api/content/articles/e1?seo=resolved');
    expect(url(1)).toBe('https://cms.test/api/content/articles?richText=html&seo=resolved');
  });
});

describe('drafts mode', () => {
  const draftsSetup = () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [], meta: { locale: 'en', snapshot: 4 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = createClient({ baseUrl: 'https://cms.test', token: 'tok', fetch, drafts: true });
    const url = (index = 0) => decodeURIComponent((fetch.mock.calls[index] as unknown as [string])[0]);
    return { client, fetch, url };
  };

  it('asks every content read for drafts; the site read and snapshots are unaffected', async () => {
    const { client, url } = draftsSetup();
    await client.delivery.list('articles', { locale: 'fr', populate: ['author'] });
    await client.delivery.get('articles', 'e1');
    await client.delivery.singleton('home', { richText: 'html' });
    await client.site.get();
    await client.snapshots.current();
    expect(url(0)).toBe(
      'https://cms.test/api/content/articles?locale=fr&populate=author&publicationState=draft',
    );
    expect(url(1)).toBe('https://cms.test/api/content/articles/e1?publicationState=draft');
    expect(url(2)).toBe('https://cms.test/api/content/home?richText=html&publicationState=draft');
    expect(url(3)).toBe('https://cms.test/api/site');
    expect(url(4)).toBe('https://cms.test/api/snapshots/current');
  });

  it('refuses a pinned snapshot before sending anything', async () => {
    const { client, fetch } = draftsSetup();
    await expect(client.delivery.list('articles', { snapshot: 3 })).rejects.toThrow(/snapshot/);
    await expect(client.delivery.get('articles', 'e1', { snapshot: 3 })).rejects.toThrow(/drafts: true/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
