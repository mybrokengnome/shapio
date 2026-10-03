import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { ShapioApiError } from './errors.js';
import { mimeTypeOf, uploadFile } from './node.js';

/** The URL a fetch was called with, whatever form it took. */
const urlOf = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const GRANT = {
  grantId: 'g1',
  assetId: 'a1',
  expiresAt: '2026-10-03T00:15:00.000Z',
  maxSizeBytes: 1000,
  upload: {
    method: 'POST',
    url: 'https://public.example.com/api/media/uploads/g1',
    fields: { signature: 's' },
    fileField: 'file',
  },
};

describe('uploadFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-client-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('asks for a grant, posts the bytes through the base URL and confirms', async () => {
    const path = join(dir, 'hero.png');
    await writeFile(path, Buffer.from([1, 2, 3]));
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = urlOf(input);
      if (url.endsWith('/api/admin/media/uploads')) {
        return json(GRANT, 201);
      }
      if (url.endsWith('/confirm')) {
        return json({ id: 'a1' }, 201);
      }
      return new Response(null, { status: 204 });
    });
    const client = createClient({ baseUrl: 'http://127.0.0.1:9999/cms', token: 't', fetch });
    await expect(uploadFile(client, { baseUrl: 'http://127.0.0.1:9999/cms', path, fetch })).resolves.toEqual({
      id: 'a1',
    });
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({
      filename: 'hero.png',
      mimeType: 'image/png',
      sizeBytes: 3,
    });
    expect(calls[1]?.[0]).toBe('http://127.0.0.1:9999/cms/api/media/uploads/g1');
    const form = calls[1]?.[1].body as FormData;
    expect([...form.keys()]).toEqual(['signature', 'file']);
    expect(calls[2]?.[0]).toBe('http://127.0.0.1:9999/cms/api/admin/media/uploads/g1/confirm');
  });

  it('surfaces a refused upload as ShapioApiError and needs a type it can name', async () => {
    const path = join(dir, 'notes.bin');
    await writeFile(path, 'x');
    const fetch = vi.fn(async (input: string | URL | Request) =>
      urlOf(input).endsWith('/uploads')
        ? json(GRANT, 201)
        : json({ error: { code: 'MEDIA_TYPE_NOT_ALLOWED' } }, 415),
    );
    const client = createClient({ baseUrl: 'http://cms.test', fetch });
    await expect(uploadFile(client, { baseUrl: 'http://cms.test', path, fetch })).rejects.toThrow(
      /Unknown file type/,
    );
    await expect(
      uploadFile(client, { baseUrl: 'http://cms.test', path, mimeType: 'application/octet-stream', fetch }),
    ).rejects.toBeInstanceOf(ShapioApiError);
    expect(mimeTypeOf('a/B.JPG')).toBe('image/jpeg');
  });
});
