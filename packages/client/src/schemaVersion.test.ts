import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { createDeliveryClient } from './deliveryClient.js';
import type { RequestFn } from './request.js';
import {
  applySchemaVersion,
  SCHEMA_VERSION_HEADER,
  SCHEMA_VERSION_QUERY_PARAMETER,
} from './schemaVersion.js';

const TOKEN = '9f1c2a7e-0d3b-4c55-9a51-6b3f0e2d7c11:42';
const ENCODED = encodeURIComponent(TOKEN);

const ok = () =>
  new Response(JSON.stringify({ data: {}, meta: { locale: 'en', snapshot: 4 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const callsOf = (fetch: ReturnType<typeof vi.fn>) =>
  (fetch.mock.calls as unknown as Array<[string, RequestInit & { next?: unknown }]>).map(([url, init]) => ({
    url,
    headers: init.headers as Record<string, string>,
    next: init.next,
  }));

describe('the schemaVersion option', () => {
  it('names the version with ?schemaVersion= on delivery reads and with the header on everything else', async () => {
    const fetch = vi.fn(async () => ok());
    const client = createClient({ baseUrl: 'https://cms.test/cms', token: 't', fetch, schemaVersion: TOKEN });

    await client.delivery.list('articles', { locale: 'fr' });
    await client.delivery.get('articles', 'a1', { snapshot: 3 });
    await client.delivery.singleton('homepage');
    await client.snapshots.current();
    await client.snapshots.changes({ from: 1 });
    await client.workspace.get();
    await client.request('/api/content/articles', { method: 'POST', body: { data: {} } });
    await client.request('/api/graphql', { method: 'POST', body: { query: '{ _snapshot { snapshot } }' } });
    await client.request('/api/docs/typescript');
    await client.admin.sites.list();

    const calls = callsOf(fetch);
    expect(calls.map((call) => call.url)).toEqual([
      `https://cms.test/cms/api/content/articles?locale=fr&schemaVersion=${ENCODED}`,
      `https://cms.test/cms/api/content/articles/a1?snapshot=3&schemaVersion=${ENCODED}`,
      `https://cms.test/cms/api/content/homepage?schemaVersion=${ENCODED}`,
      `https://cms.test/cms/api/snapshots/current?schemaVersion=${ENCODED}`,
      `https://cms.test/cms/api/snapshots/changes?from=1&schemaVersion=${ENCODED}`,
      `https://cms.test/cms/api/site?schemaVersion=${ENCODED}`,
      'https://cms.test/cms/api/content/articles',
      'https://cms.test/cms/api/graphql',
      'https://cms.test/cms/api/docs/typescript',
      'https://cms.test/cms/api/admin/sites',
    ]);
    for (const call of calls.slice(0, 6)) {
      expect(call.headers).not.toHaveProperty(SCHEMA_VERSION_HEADER);
    }
    for (const call of calls.slice(6)) {
      expect(call.headers[SCHEMA_VERSION_HEADER]).toBe(TOKEN);
    }
  });

  it('puts the version after the workspace on delivery reads', async () => {
    const fetch = vi.fn(async () => ok());
    const client = createClient({
      baseUrl: 'https://cms.test',
      fetch,
      workspace: 'blog',
      schemaVersion: TOKEN,
    });
    await client.delivery.list('articles');
    await client.request('/api/content/articles', { method: 'POST', body: {} });
    const [read, write] = callsOf(fetch);
    expect(read?.url).toBe(`https://cms.test/api/content/articles?site=blog&schemaVersion=${ENCODED}`);
    expect(write?.headers).toMatchObject({ 'shapio-site': 'blog', [SCHEMA_VERSION_HEADER]: TOKEN });
  });

  it('leaves a path that already names a schema version as it is, with no header', async () => {
    const fetch = vi.fn(async () => ok());
    const client = createClient({ baseUrl: 'https://cms.test', fetch, schemaVersion: TOKEN });
    await client.request('/api/content/articles?schemaVersion=other%3A1');
    await client.request('/api/docs/typescript?schemaVersion=other%3A1');
    const calls = callsOf(fetch);
    expect(calls.map((call) => call.url)).toEqual([
      'https://cms.test/api/content/articles?schemaVersion=other%3A1',
      'https://cms.test/api/docs/typescript?schemaVersion=other%3A1',
    ]);
    for (const call of calls) {
      expect(call.headers).not.toHaveProperty(SCHEMA_VERSION_HEADER);
    }
  });

  it('sends nothing when no version is named', async () => {
    const fetch = vi.fn(async () => ok());
    const client = createClient({ baseUrl: 'https://cms.test', fetch });
    await client.delivery.list('articles');
    await client.request('/api/graphql', { method: 'POST', body: {} });
    const calls = callsOf(fetch);
    expect(calls[0]?.url).toBe('https://cms.test/api/content/articles');
    for (const call of calls) {
      expect(call.headers).not.toHaveProperty(SCHEMA_VERSION_HEADER);
    }
  });

  it('keeps reads through different versions in different cache entries, with the same tags', async () => {
    const fetch = vi.fn(async () => ok());
    const options = { baseUrl: 'https://cms.test', fetch, next: { revalidate: 60 } } as const;
    const old = createClient({ ...options, schemaVersion: TOKEN });
    const today = createClient(options);
    await old.delivery.get('articles', 'e1');
    await today.delivery.get('articles', 'e1');
    const [oldCall, todayCall] = callsOf(fetch);
    expect(oldCall?.url).not.toBe(todayCall?.url);
    expect(oldCall?.next).toEqual(todayCall?.next);
    expect(oldCall?.next).toEqual({
      tags: ['shapio:site', 'shapio:articles', 'shapio:articles:e1'],
      revalidate: 60,
    });
  });
});

describe('applySchemaVersion', () => {
  it('uses the query parameter only for delivery GETs', () => {
    expect(applySchemaVersion(TOKEN, 'GET', '/api/workspace')).toEqual({
      path: `/api/workspace?${SCHEMA_VERSION_QUERY_PARAMETER}=${ENCODED}`,
      headers: {},
    });
    expect(applySchemaVersion(TOKEN, 'PATCH', '/api/content/articles/e1')).toEqual({
      path: '/api/content/articles/e1',
      headers: { [SCHEMA_VERSION_HEADER]: TOKEN },
    });
    expect(applySchemaVersion(undefined, 'GET', '/api/content/articles')).toEqual({
      path: '/api/content/articles',
      headers: {},
    });
  });
});

describe('createDeliveryClient schemaVersion', () => {
  it('hands the transport every read path with the version, keeping a path that names one', async () => {
    const paths: string[] = [];
    const request = vi.fn(async (path: string) => {
      paths.push(path);
      return {};
    }) as unknown as RequestFn;
    const client = createDeliveryClient(request, { site: 'blog', schemaVersion: TOKEN });

    await client.delivery.list('articles', { locale: 'fr' });
    await client.delivery.get('articles', 'e1');
    await client.workspace.get();
    await client.snapshots.current();
    await client.snapshots.changes({ from: 2 });

    expect(paths).toEqual([
      `/api/content/articles?locale=fr&schemaVersion=${ENCODED}`,
      `/api/content/articles/e1?schemaVersion=${ENCODED}`,
      `/api/site?schemaVersion=${ENCODED}`,
      `/api/snapshots/current?schemaVersion=${ENCODED}`,
      `/api/snapshots/changes?from=2&schemaVersion=${ENCODED}`,
    ]);
  });
});
