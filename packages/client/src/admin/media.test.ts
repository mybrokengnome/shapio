import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { ShapioApiError } from '../errors.js';
import { buildUploadForm } from './media.js';
import type { UploadGrant } from './mediaTypes.js';

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
    return { url, method: init.method, body: parsed };
  };
  return { client, call };
};

const GRANT: UploadGrant = {
  grantId: 'g1',
  assetId: 'a1',
  expiresAt: '2026-10-02T00:15:00.000Z',
  maxSizeBytes: 1000,
  upload: {
    method: 'POST',
    url: 'https://bucket.test/media',
    fields: { key: 'public/a1/t/x.png', 'Content-Type': 'image/png', Policy: 'p' },
    fileField: 'file',
  },
};

describe('media api: folders', () => {
  it('lists, creates, updates and removes folders', async () => {
    const { client, call } = setup(200, { items: [{ id: 'f1' }] });
    await expect(client.admin.media.folders.list()).resolves.toEqual([{ id: 'f1' }]);
    await client.admin.media.folders.create({ name: 'Brand', parentId: null });
    await client.admin.media.folders.update('f/1', { expectedVersion: 2, name: 'Logos' });
    await client.admin.media.folders.remove('f1');
    expect(call(0)).toMatchObject({ url: 'https://cms.test/cms/api/admin/media/folders', method: 'GET' });
    expect(call(1)).toEqual({
      url: 'https://cms.test/cms/api/admin/media/folders',
      method: 'POST',
      body: { name: 'Brand', parentId: null },
    });
    expect(call(2)).toEqual({
      url: 'https://cms.test/cms/api/admin/media/folders/f%2F1',
      method: 'PATCH',
      body: { expectedVersion: 2, name: 'Logos' },
    });
    expect(call(3)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/media/folders/f1',
      method: 'DELETE',
    });
  });
});

describe('media api: assets', () => {
  it('lists with filters in the query string, skipping unset ones', async () => {
    const { client, call } = setup(200, { items: [], nextCursor: null });
    await client.admin.media.assets.list({
      folder: 'root',
      mimeType: 'image/*',
      search: undefined,
      limit: 20,
    });
    await client.admin.media.assets.list();
    expect(call(0).url).toBe(
      'https://cms.test/cms/api/admin/media/assets?folder=root&mimeType=image%2F*&limit=20',
    );
    expect(call(1).url).toBe('https://cms.test/cms/api/admin/media/assets');
  });

  it('updates metadata, moves, reads usage and asks for a replacement grant', async () => {
    const { client, call } = setup();
    await client.admin.media.assets.update('a1', {
      expectedVersion: 3,
      alt: 'A cat',
      focalPoint: { x: 0.5, y: 0.25 },
    });
    await client.admin.media.assets.move({ assetIds: ['a1', 'a2'], folderId: 'f1' });
    await client.admin.media.assets.usage('a1');
    await client.admin.media.assets.replace('a1', { filename: 'b.png', mimeType: 'image/png', sizeBytes: 5 });
    expect(call(0)).toEqual({
      url: 'https://cms.test/cms/api/admin/media/assets/a1',
      method: 'PATCH',
      body: { expectedVersion: 3, alt: 'A cat', focalPoint: { x: 0.5, y: 0.25 } },
    });
    expect(call(1)).toEqual({
      url: 'https://cms.test/cms/api/admin/media/assets/move',
      method: 'POST',
      body: { assetIds: ['a1', 'a2'], folderId: 'f1' },
    });
    expect(call(2)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/media/assets/a1/usage',
      method: 'GET',
    });
    expect(call(3)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/media/assets/a1/replace',
      method: 'POST',
    });
  });

  it('deletes, with force only when asked', async () => {
    const { client, call } = setup();
    await client.admin.media.assets.remove('a1');
    await client.admin.media.assets.remove('a1', { force: true });
    expect(call(0)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/media/assets/a1',
      method: 'DELETE',
    });
    expect(call(1).url).toBe('https://cms.test/cms/api/admin/media/assets/a1?force=true');
  });

  it('surfaces the in-use block as a 409 with the usage count', async () => {
    const { client } = setup(409, {
      error: { code: 'MEDIA_IN_USE', message: 'in use', details: { usageCount: 2 } },
    });
    const failure = client.admin.media.assets.remove('a1');
    await expect(failure).rejects.toBeInstanceOf(ShapioApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_IN_USE',
      details: { usageCount: 2 },
    });
  });
});

describe('media api: uploads', () => {
  it('asks for a grant and confirms it', async () => {
    const { client, call } = setup(201, GRANT);
    await client.admin.media.uploads.create({
      filename: 'x.png',
      mimeType: 'image/png',
      sizeBytes: 5,
      visibility: 'private',
    });
    await client.admin.media.uploads.confirm('g/1');
    expect(call(0)).toEqual({
      url: 'https://cms.test/cms/api/admin/media/uploads',
      method: 'POST',
      body: { filename: 'x.png', mimeType: 'image/png', sizeBytes: 5, visibility: 'private' },
    });
    expect(call(1)).toMatchObject({
      url: 'https://cms.test/cms/api/admin/media/uploads/g%2F1/confirm',
      method: 'POST',
    });
  });

  it('builds the upload form with the grant fields first and the file last', () => {
    const form = buildUploadForm(GRANT, new Blob(['png']), 'x.png');
    const entries = [...form.entries()];
    expect(entries.map(([name]) => name)).toEqual(['key', 'Content-Type', 'Policy', 'file']);
    expect(entries.at(-1)?.[1]).toBeInstanceOf(Blob);
    expect((entries.at(-1)?.[1] as File).name).toBe('x.png');
  });
});
