import { describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';
import { codeChallengeOf, createPkcePair } from './pkce.js';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('app-user client', () => {
  it('posts credentials and builds the OAuth start link under the base path', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { accessToken: 'a', refreshToken: 'r' }));
    const client = createClient({ baseUrl: 'https://cms.test/cms/', fetch });
    await client.appAuth.login({ email: 'a@example.com', password: 'pw' });
    expect(fetch).toHaveBeenCalledWith(
      'https://cms.test/cms/api/app-auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'a@example.com', password: 'pw' }),
      }),
    );
    expect(client.appAuth.oauthStartUrl('github', 'https://app.test/back?x=1', 'chal_lenge-1')).toBe(
      'https://cms.test/cms/api/app-auth/oauth/github/start?redirectTo=https%3A%2F%2Fapp.test%2Fback%3Fx%3D1&codeChallenge=chal_lenge-1',
    );
  });

  it('creates PKCE pairs with the RFC 7636 S256 challenge and sends the verifier with the code', async () => {
    // RFC 7636 appendix B.
    expect(await codeChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const pair = await createPkcePair();
    expect(pair.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.codeChallenge).toBe(await codeChallengeOf(pair.codeVerifier));
    expect((await createPkcePair()).codeVerifier).not.toBe(pair.codeVerifier);

    const fetch = vi.fn(async () => jsonResponse(200, { accessToken: 'a', refreshToken: 'r' }));
    const client = createClient({ baseUrl: 'https://cms.test', fetch });
    await client.appAuth.exchangeCode('one-time-code', pair.codeVerifier);
    expect(fetch).toHaveBeenCalledWith(
      'https://cms.test/api/app-auth/oauth/exchange',
      expect.objectContaining({
        body: JSON.stringify({ code: 'one-time-code', codeVerifier: pair.codeVerifier }),
      }),
    );
  });

  it('lists app users with a query string', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { items: [], nextCursor: null }));
    const client = createClient({ baseUrl: 'https://cms.test', token: 'shp_x', fetch });
    await client.admin.appUsers.list({ search: 'ada', limit: 20 });
    expect(fetch).toHaveBeenCalledWith(
      'https://cms.test/api/admin/app-users?search=ada&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
