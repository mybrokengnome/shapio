import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client.js';
import { ShapioApiError } from './errors.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createClient', () => {
  it('requests the readiness endpoint with a bearer token', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { status: 'ready', checks: { database: 'ok', migrations: 'ok' } }),
    );
    const client = createClient({ baseUrl: 'https://cms.test/', token: 'secret', fetch });

    const ready = await client.system.ready();

    expect(ready.status).toBe('ready');
    expect(fetch).toHaveBeenCalledWith(
      'https://cms.test/api/ready',
      expect.objectContaining({ method: 'GET' }),
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
  });

  it('throws ShapioApiError carrying the server error code', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(503, { error: { code: 'NOT_READY', message: 'Service is not ready' } }),
    );
    const client = createClient({ baseUrl: 'https://cms.test', fetch });

    const failure = client.system.ready();

    await expect(failure).rejects.toBeInstanceOf(ShapioApiError);
    await expect(failure).rejects.toMatchObject({
      status: 503,
      code: 'NOT_READY',
      message: 'Service is not ready',
    });
  });

  it('falls back to HTTP_<status> when the body is not a Shapio error', async () => {
    const fetch = vi.fn(async () => new Response('Bad gateway', { status: 502 }));
    const client = createClient({ baseUrl: 'https://cms.test', fetch });

    await expect(client.system.health()).rejects.toMatchObject({ status: 502, code: 'HTTP_502' });
  });
});

describe('admin api', () => {
  it('sends per-request headers and credentials, and serialises queries', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { items: [], nextCursor: null }));
    const client = createClient({
      baseUrl: 'https://cms.test/cms/',
      fetch,
      credentials: 'same-origin',
      headers: () => ({ 'x-csrf-token': 'abc' }),
    });

    await client.admin.audit.list({ cursor: 'abc', limit: 25, action: undefined, actorType: 'admin' });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cms.test/cms/api/admin/audit?cursor=abc&limit=25&actorType=admin');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'x-csrf-token': 'abc' });
  });

  it('encodes ids in paths and returns undefined for empty bodies', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createClient({ baseUrl: 'https://cms.test', fetch });

    await expect(client.admin.sessions.revoke('a/b')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      'https://cms.test/api/admin/auth/sessions/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
