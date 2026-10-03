import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { applySite } from './site.js';

const ok = () =>
  new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });

const callsOf = (fetch: ReturnType<typeof vi.fn>) =>
  (fetch.mock.calls as unknown as Array<[string, RequestInit]>).map(([url, init]) => ({
    url,
    headers: init.headers as Record<string, string>,
  }));

describe('the site option', () => {
  it('names the site with ?site= on delivery reads and with Shapio-Site on everything else', async () => {
    const fetch = vi.fn(async () => ok());
    const client = createClient({ baseUrl: 'https://cms.test/cms', token: 't', fetch, site: 'marketing' });

    await client.delivery.list('articles', { locale: 'fr' });
    await client.delivery.get('articles', 'a1');
    await client.snapshots.current();
    await client.snapshots.changes({ from: 1 });
    await client.request('/api/content/articles', { method: 'POST', body: { data: {} } });
    await client.request('/api/graphql', { method: 'POST', body: { query: '{ _snapshot { snapshot } }' } });
    await client.admin.sites.list();

    const calls = callsOf(fetch);
    expect(calls.map((call) => call.url)).toEqual([
      'https://cms.test/cms/api/content/articles?locale=fr&site=marketing',
      'https://cms.test/cms/api/content/articles/a1?site=marketing',
      'https://cms.test/cms/api/snapshots/current?site=marketing',
      'https://cms.test/cms/api/snapshots/changes?from=1&site=marketing',
      'https://cms.test/cms/api/content/articles',
      'https://cms.test/cms/api/graphql',
      'https://cms.test/cms/api/admin/sites',
    ]);
    for (const call of calls.slice(0, 4)) {
      expect(call.headers).not.toHaveProperty('shapio-site');
    }
    for (const call of calls.slice(4)) {
      expect(call.headers).toMatchObject({ 'shapio-site': 'marketing' });
    }
  });

  it('sends nothing without a site, and leaves a path that already names one alone', async () => {
    const fetch = vi.fn(async () => ok());
    await createClient({ baseUrl: 'https://cms.test', fetch }).delivery.list('articles');
    const [call] = callsOf(fetch);
    expect(call?.url).toBe('https://cms.test/api/content/articles');
    expect(call?.headers).not.toHaveProperty('shapio-site');

    expect(applySite('marketing', 'GET', '/api/content/articles?site=docs')).toEqual({
      path: '/api/content/articles?site=docs',
      headers: {},
    });
    expect(applySite('marketing', 'GET', '/api/admin/content/article')).toEqual({
      path: '/api/admin/content/article',
      headers: { 'shapio-site': 'marketing' },
    });
  });
});
