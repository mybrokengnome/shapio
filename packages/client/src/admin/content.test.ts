import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { ShapioApiError } from '../errors.js';
import { toContentQueryString } from './contentQuery.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const setup = (status = 200, body: unknown = {}) => {
  const fetch = vi.fn(async () => jsonResponse(status, body));
  const client = createClient({ baseUrl: 'https://cms.test/cms', fetch });
  const call = (index = 0) => {
    const [url, init] = fetch.mock.calls[index] as unknown as [string, RequestInit];
    const parsed: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    return { url: decodeURIComponent(url), method: init.method, body: parsed };
  };
  return { client, call };
};

const BASE = 'https://cms.test/cms/api/admin/content';

describe('toContentQueryString', () => {
  it('serialises filters, sort, paging, search, locale, fields and populate in bracket syntax', () => {
    const query = toContentQueryString({
      filters: {
        title: { $containsi: 'Hello' },
        id: { $in: ['a', 'b'] },
        $or: [{ rating: { $gte: 3 } }, { featured: { $eq: true } }],
      },
      sort: [
        { field: 'title', direction: 'asc' },
        { field: 'updatedAt', direction: 'desc' },
      ],
      page: 2,
      pageSize: 50,
      q: 'summer sale',
      locale: 'fr',
      fields: ['title', 'slug'],
      populate: ['author'],
    });
    expect(decodeURIComponent(query)).toBe(
      '?filters[title][$containsi]=Hello&filters[id][$in]=a&filters[id][$in]=b' +
        '&filters[$or][0][rating][$gte]=3&filters[$or][1][featured][$eq]=true' +
        '&sort=title:asc&sort=updatedAt:desc&page=2&pageSize=50&q=summer+sale&locale=fr' +
        '&fields=title&fields=slug&populate=author',
    );
  });

  it('serialises the admin list filters status and author', () => {
    expect(toContentQueryString({ status: 'modified', author: 'u1' })).toBe('?status=modified&author=u1');
  });

  it('is empty for an empty query', () => {
    expect(toContentQueryString({})).toBe('');
  });
});

describe('content api', () => {
  it('lists, reads, creates, saves and deletes entries', async () => {
    const { client, call } = setup(200, { id: 'e1' });
    await client.admin.content.list('page', { q: 'home', page: 1 });
    await client.admin.content.get('page', 'e1', { locale: 'fr' });
    await client.admin.content.create('page', { locale: 'en', data: { title: 'Home' } });
    await client.admin.content.update('page', 'e1', {
      locale: 'en',
      expectedVersion: 3,
      data: { title: 'Home' },
      autosave: true,
    });
    await client.admin.content.remove('page', 'e1');
    await client.admin.content.duplicate('page', 'e1');
    expect(call(0)).toMatchObject({ url: `${BASE}/page?page=1&q=home`, method: 'GET' });
    expect(call(1)).toMatchObject({ url: `${BASE}/page/e1?locale=fr`, method: 'GET' });
    expect(call(2)).toEqual({
      url: `${BASE}/page`,
      method: 'POST',
      body: { locale: 'en', data: { title: 'Home' } },
    });
    expect(call(3)).toEqual({
      url: `${BASE}/page/e1`,
      method: 'PUT',
      body: { locale: 'en', expectedVersion: 3, data: { title: 'Home' }, autosave: true },
    });
    expect(call(4)).toMatchObject({ url: `${BASE}/page/e1`, method: 'DELETE' });
    expect(call(5)).toMatchObject({ url: `${BASE}/page/e1/duplicate`, method: 'POST' });
  });

  it('publishes and unpublishes locales, and reads and restores revisions', async () => {
    const { client, call } = setup(200, { items: [{ id: 'r1' }] });
    await client.admin.content.publish('page', 'e1', { locales: ['en', 'fr'] });
    await client.admin.content.unpublish('page', 'e1', { locales: ['fr'] });
    await expect(client.admin.content.revisions('page', 'e1', { locale: 'en' })).resolves.toEqual([
      { id: 'r1' },
    ]);
    await client.admin.content.revision('page', 'e1', 'r1');
    await client.admin.content.restore('page', 'e1', 'r1', 4);
    expect(call(0)).toEqual({
      url: `${BASE}/page/e1/publish`,
      method: 'POST',
      body: { locales: ['en', 'fr'] },
    });
    expect(call(1)).toEqual({ url: `${BASE}/page/e1/unpublish`, method: 'POST', body: { locales: ['fr'] } });
    expect(call(2)).toMatchObject({ url: `${BASE}/page/e1/revisions?locale=en`, method: 'GET' });
    expect(call(3)).toMatchObject({ url: `${BASE}/page/e1/revisions/r1`, method: 'GET' });
    expect(call(4)).toEqual({
      url: `${BASE}/page/e1/revisions/r1/restore`,
      method: 'POST',
      body: { expectedVersion: 4 },
    });
  });

  it('reads the custom editor manifest', async () => {
    const { client, call } = setup(200, { items: [] });
    await expect(client.admin.extensions.editors()).resolves.toEqual({ items: [] });
    expect(call(0)).toMatchObject({ url: 'https://cms.test/cms/api/admin/extensions/editors' });
  });

  it('surfaces stale versions as ShapioApiError with the server code', async () => {
    const { client } = setup(409, {
      error: { code: 'CONTENT_VERSION_CONFLICT', message: 'changed', details: { currentVersion: 5 } },
    });
    const failure = client.admin.content.update('page', 'e1', { expectedVersion: 4, data: {} });
    await expect(failure).rejects.toBeInstanceOf(ShapioApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: 'CONTENT_VERSION_CONFLICT',
      details: { currentVersion: 5 },
    });
  });
});
