import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OAUTH_STATE_COOKIE_NAME } from '../src/constants/appAuth.js';
import { nextTestIp } from './helpers/adminIdentity.js';
import {
  APP_PASSWORD,
  bearer,
  loginAppUser,
  newAppPkce,
  signUp,
  type AppSessionBody,
} from './helpers/appUsers.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import {
  FAKE_CLIENT,
  startFakeOAuthProviders,
  type FakeOAuthProviders,
  type GitHubEmail,
  type GoogleUserInfo,
} from './helpers/fakeOAuthProviders.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const APP_ORIGIN = 'https://app.example.com';
const RETURN_TO = `${APP_ORIGIN}/signed-in?from=shapio`;

/** Google and GitHub sign-in against a local fake of their token and profile endpoints (build plan §4.I2). */
describe('app-user OAuth sign-in', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let providers: FakeOAuthProviders;

  beforeAll(async () => {
    providers = await startFakeOAuthProviders();
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      oauthEndpoints: providers.endpoints,
      env: {
        CORS_ORIGINS: APP_ORIGIN,
        APP_AUTH_GOOGLE_CLIENT_ID: FAKE_CLIENT.id,
        APP_AUTH_GOOGLE_CLIENT_SECRET: FAKE_CLIENT.secret,
        APP_AUTH_GITHUB_CLIENT_ID: FAKE_CLIENT.id,
        APP_AUTH_GITHUB_CLIENT_SECRET: FAKE_CLIENT.secret,
      },
    });
  });
  afterAll(async () => {
    await testApp.app.close();
    await providers.close();
  });

  /** The app's PKCE pair for the sign-ins in this suite (each test's exchange presents its verifier). */
  const pkce = newAppPkce();

  const start = (provider: string, redirectTo = RETURN_TO, codeChallenge = pkce.codeChallenge) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/${provider}/start?redirectTo=${encodeURIComponent(redirectTo)}&codeChallenge=${codeChallenge}`,
      remoteAddress: nextTestIp(),
    });

  const stateCookieOf = (response: LightMyRequestResponse) =>
    response.cookies.find((cookie) => cookie.name === OAUTH_STATE_COOKIE_NAME);

  type Approval = Parameters<FakeOAuthProviders['approve']>[1];

  /** Start → approve at the (fake) provider → callback. Returns where Shapio sent the browser. */
  const signInWith = async (provider: 'google' | 'github', approval: Approval) => {
    const started = expectStatus(await start(provider), 302);
    const authorizationUrl = new URL(started.headers.location as string);
    const cookie = stateCookieOf(started);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/app-auth/oauth/' });
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      `${testApp.app.urls.absoluteUrl(`/api/app-auth/oauth/${provider}/callback`)}`,
    );
    const code = providers.approve(authorizationUrl.toString(), approval);
    const callback = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/${provider}/callback?code=${code}&state=${authorizationUrl.searchParams.get('state')}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=${cookie?.value ?? ''}` },
    });
    expect(callback.statusCode).toBe(302);
    return new URL(callback.headers.location as string);
  };

  const exchange = (code: string, codeVerifier = pkce.codeVerifier) =>
    testApp.app.inject({
      method: 'POST',
      url: '/api/app-auth/oauth/exchange',
      remoteAddress: nextTestIp(),
      payload: { code, codeVerifier },
    });

  const sessionFrom = async (returned: URL) => {
    expect(returned.origin + returned.pathname).toBe(`${APP_ORIGIN}/signed-in`);
    expect(returned.searchParams.get('from')).toBe('shapio');
    expect(returned.searchParams.get('error')).toBeNull();
    return expectStatus(await exchange(returned.searchParams.get('code') ?? ''), 200).json<AppSessionBody>();
  };

  const google = (overrides: Partial<GoogleUserInfo> = {}): Approval => ({
    google: {
      sub: '108729817384627384912',
      name: 'Katherine Johnson',
      given_name: 'Katherine',
      family_name: 'Johnson',
      picture: 'https://lh3.googleusercontent.com/a/photo',
      email: 'katherine@example.com',
      email_verified: true,
      ...overrides,
    },
  });

  const github = (emails: GitHubEmail[], id = 583231): Approval => ({
    github: { user: { login: 'octocat', id, name: 'The Octocat', email: null }, emails },
  });

  it('lists the configured providers', async () => {
    const response = await testApp.app.inject({ method: 'GET', url: '/api/app-auth/providers' });
    expect(response.json()).toEqual({ providers: ['google', 'github'] });
  });

  it('creates a confirmed account from a verified Google profile, then signs into it again', async () => {
    const first = await sessionFrom(await signInWith('google', google()));
    expect(first.user).toMatchObject({
      email: 'katherine@example.com',
      name: 'Katherine Johnson',
      confirmed: true,
    });
    const me = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: '/api/app-auth/me',
        headers: bearer(first.accessToken),
      }),
      200,
    ).json<unknown>();
    expect(me).toMatchObject({ providers: ['google'], hasPassword: false });
    const again = await sessionFrom(await signInWith('google', google({ email: 'katherine.j@example.com' })));
    expect(again.user.id).toBe(first.user.id);
  });

  it('the one-time code works once', async () => {
    const returned = await signInWith('google', google({ sub: 'one-time', email: 'once@example.com' }));
    const code = returned.searchParams.get('code') ?? '';
    expectStatus(await exchange(code), 200);
    expect((await exchange(code)).json()).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_CODE' } });
  });

  it('exchanges the code only with the verifier of the challenge sent at the start, and only once', async () => {
    const returned = await signInWith('google', google({ sub: 'pkce-sub', email: 'pkce@example.com' }));
    const code = returned.searchParams.get('code') ?? '';
    // An intercepted code is useless without the app's verifier; the failed attempt spends it.
    const stolen = await exchange(code, newAppPkce().codeVerifier);
    expect(stolen.statusCode).toBe(400);
    expect(stolen.json()).toMatchObject({ error: { code: 'INVALID_CODE_VERIFIER' } });
    expect((await exchange(code)).json()).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_CODE' } });
    // The verifier is required, and the start refuses a missing or malformed challenge.
    const next = await signInWith('google', google({ sub: 'pkce-sub', email: 'pkce@example.com' }));
    const missing = await testApp.app.inject({
      method: 'POST',
      url: '/api/app-auth/oauth/exchange',
      remoteAddress: nextTestIp(),
      payload: { code: next.searchParams.get('code') },
    });
    expect(missing.statusCode).toBe(400);
    expectStatus(await exchange(next.searchParams.get('code') ?? ''), 200);
    const noChallenge = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/start?redirectTo=${encodeURIComponent(RETURN_TO)}`,
      remoteAddress: nextTestIp(),
    });
    expect(noChallenge.statusCode).toBe(400);
    expect((await start('google', RETURN_TO, 'too-short')).statusCode).toBe(400);
    const plain = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/start?redirectTo=${encodeURIComponent(RETURN_TO)}&codeChallenge=${pkce.codeChallenge}&codeChallengeMethod=plain`,
      remoteAddress: nextTestIp(),
    });
    expect(plain.statusCode).toBe(400);
  });

  it('never links or creates an account from an unverified email', async () => {
    const existing = await signUp(testApp.app, { email: 'grace@example.com' });
    const returned = await signInWith(
      'google',
      google({ sub: 'attacker-sub', email: 'grace@example.com', email_verified: false }),
    );
    expect(returned.searchParams.get('error')).toBe('EMAIL_NOT_VERIFIED');
    expect(returned.searchParams.get('code')).toBeNull();
    const links = await database.current.db
      .selectFrom('app_oauth_accounts')
      .select('id')
      .where('app_user_id', '=', existing.user.id)
      .execute();
    expect(links).toEqual([]);
    expectStatus(await loginAppUser(testApp.app, 'grace@example.com'), 200);

    // GitHub: only an unverified primary address.
    const githubReturned = await signInWith(
      'github',
      github([{ email: 'grace@example.com', primary: true, verified: false, visibility: 'private' }], 1001),
    );
    expect(githubReturned.searchParams.get('error')).toBe('EMAIL_NOT_VERIFIED');
  });

  it('links a verified address to an unconfirmed password account and drops the unproven password', async () => {
    const squatter = await signUp(testApp.app, { email: 'margaret@example.com' });
    const session = await sessionFrom(
      await signInWith(
        'github',
        github(
          [
            { email: 'margaret@users.noreply.github.com', primary: false, verified: true, visibility: null },
            { email: 'margaret@example.com', primary: true, verified: true, visibility: 'public' },
          ],
          2002,
        ),
      ),
    );
    expect(session.user).toMatchObject({ id: squatter.user.id, confirmed: true });
    expect((await loginAppUser(testApp.app, 'margaret@example.com', APP_PASSWORD)).statusCode).toBe(401);
    expect(
      (
        await testApp.app.inject({
          method: 'POST',
          url: '/api/app-auth/refresh',
          payload: { refreshToken: squatter.refreshToken },
        })
      ).statusCode,
    ).toBe(401);
    const audited = await database.current.db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'app_user.oauth_link')
      .where('target_id', '=', squatter.user.id)
      .executeTakeFirstOrThrow();
    expect(audited.metadata).toMatchObject({ provider: 'github', wasConfirmed: false });
  });

  it('reports provider failures and blocked accounts to the app', async () => {
    // A code the provider does not know: GitHub answers 200 with { error }.
    const started = expectStatus(await start('github'), 302);
    const state = new URL(started.headers.location as string).searchParams.get('state');
    const rejected = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/github/callback?code=unknown&state=${state}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=${stateCookieOf(started)?.value ?? ''}` },
    });
    expect(new URL(rejected.headers.location as string).searchParams.get('error')).toBe(
      'PROVIDER_REJECTED_CODE',
    );

    const blocked = await sessionFrom(
      await signInWith('google', google({ sub: 'blocked-sub', email: 'b@example.com' })),
    );
    const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${blocked.user.id}`,
        payload: { blocked: true },
      }),
      200,
    );
    const again = await signInWith('google', google({ sub: 'blocked-sub', email: 'b@example.com' }));
    expect(again.searchParams.get('error')).toBe('ACCOUNT_BLOCKED');
  });

  it('refuses callbacks without the browser-bound state and redirects off the allowed origins', async () => {
    const started = expectStatus(await start('google'), 302);
    const state = new URL(started.headers.location as string).searchParams.get('state');
    const withoutCookie = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/callback?code=x&state=${state}`,
    });
    expect(withoutCookie.statusCode).toBe(400);
    const wrongState = await testApp.app.inject({
      method: 'GET',
      url: '/api/app-auth/oauth/google/callback?code=x&state=forged',
      headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=${stateCookieOf(started)?.value ?? ''}` },
    });
    expect(wrongState.statusCode).toBe(400);
    expect((await start('google', 'https://evil.example.net/steal')).statusCode).toBe(400);
    expect((await start('google', 'javascript:alert(1)')).statusCode).toBe(400);
    expect((await start('gitlab')).statusCode).toBe(404);
  });

  it('sets the state cookie httpOnly, SameSite=Lax, scoped to the OAuth path, for ten minutes', async () => {
    const cookie = stateCookieOf(expectStatus(await start('github'), 302));
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/api/app-auth/oauth/',
      // OAUTH_STATE_TTL_MS: ten minutes, as Max-Age.
      maxAge: 600,
    });
    expect(cookie?.secure).toBeFalsy();
  });

  it('marks the state cookie Secure when PUBLIC_URL is https', async () => {
    const secure = await createTestApp(database.current, {
      schemaListen: false,
      oauthEndpoints: providers.endpoints,
      env: {
        PUBLIC_URL: 'https://cms.example.com',
        CORS_ORIGINS: APP_ORIGIN,
        APP_AUTH_GOOGLE_CLIENT_ID: FAKE_CLIENT.id,
        APP_AUTH_GOOGLE_CLIENT_SECRET: FAKE_CLIENT.secret,
      },
    });
    const started = await secure.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/start?redirectTo=${encodeURIComponent(RETURN_TO)}&codeChallenge=${newAppPkce().codeChallenge}`,
      remoteAddress: nextTestIp(),
    });
    await secure.app.close();
    expect(started.statusCode).toBe(302);
    expect(stateCookieOf(started)).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/api/app-auth/oauth/',
      secure: true,
    });
  });
});

describe('app-user OAuth return URLs (APP_AUTH_RETURN_URLS)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let providers: FakeOAuthProviders;

  beforeAll(async () => {
    providers = await startFakeOAuthProviders();
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      oauthEndpoints: providers.endpoints,
      env: {
        CORS_ORIGINS: APP_ORIGIN,
        APP_AUTH_RETURN_URLS: 'myapp://auth,https://www.example.com',
        APP_AUTH_GOOGLE_CLIENT_ID: FAKE_CLIENT.id,
        APP_AUTH_GOOGLE_CLIENT_SECRET: FAKE_CLIENT.secret,
      },
    });
  });
  afterAll(async () => {
    await testApp.app.close();
    await providers.close();
  });

  const pkce = newAppPkce();

  const start = (redirectTo: string) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/start?redirectTo=${encodeURIComponent(redirectTo)}&codeChallenge=${pkce.codeChallenge}&codeChallengeMethod=S256`,
      remoteAddress: nextTestIp(),
    });

  it('replaces CORS_ORIGINS: listed origins and custom-scheme prefixes only', async () => {
    expect((await start(`${APP_ORIGIN}/back`)).statusCode).toBe(400);
    expect((await start('https://www.example.com/back')).statusCode).toBe(302);
    expect((await start('myapp://authx/back')).statusCode).toBe(400);
    expect((await start('otherapp://auth')).statusCode).toBe(400);
  });

  it('returns a native app to its custom scheme with the one-time code', async () => {
    const started = expectStatus(await start('myapp://auth/callback'), 302);
    const authorizationUrl = new URL(started.headers.location as string);
    const cookie = started.cookies.find((item) => item.name === OAUTH_STATE_COOKIE_NAME);
    const code = providers.approve(authorizationUrl.toString(), {
      google: { sub: 'native-sub', name: 'Native', email: 'native@example.com', email_verified: true },
    });
    const callback = await testApp.app.inject({
      method: 'GET',
      url: `/api/app-auth/oauth/google/callback?code=${code}&state=${authorizationUrl.searchParams.get('state')}`,
      headers: { cookie: `${OAUTH_STATE_COOKIE_NAME}=${cookie?.value ?? ''}` },
    });
    const returned = new URL(callback.headers.location as string);
    expect(returned.protocol + returned.host + returned.pathname).toBe('myapp:auth/callback');
    const exchanged = await testApp.app.inject({
      method: 'POST',
      url: '/api/app-auth/oauth/exchange',
      payload: { code: returned.searchParams.get('code'), codeVerifier: pkce.codeVerifier },
    });
    expect(expectStatus(exchanged, 200).json<AppSessionBody>().user.email).toBe('native@example.com');
  });
});
