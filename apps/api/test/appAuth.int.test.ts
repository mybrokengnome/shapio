import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextTestIp } from './helpers/adminIdentity.js';
import {
  APP_PASSWORD,
  bearer,
  loginAppUser,
  registerAppUser,
  runAppEmailJobs,
  signUp,
  type AppSessionBody,
} from './helpers/appUsers.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createMemoryEmailTransport, lastTokenSentTo } from './helpers/memoryEmailTransport.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** App-user accounts and tokens through /api/app-auth (package I, ADR 0005). */
describe('app-user authentication', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  const me = (accessToken: string) =>
    testApp.app.inject({ method: 'GET', url: '/api/app-auth/me', headers: bearer(accessToken) });
  const refresh = (refreshToken: string) =>
    testApp.app.inject({
      method: 'POST',
      url: '/api/app-auth/refresh',
      remoteAddress: nextTestIp(),
      payload: { refreshToken },
    });
  const patchAppUser = (id: string, payload: Record<string, unknown>) =>
    admin.request({ method: 'PATCH', url: `/api/admin/app-users/${id}`, payload });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('registers, signs in and edits the profile', async () => {
    const session = await signUp(testApp.app, { email: 'Ada@Example.com' });
    expect(session.user).toMatchObject({ email: 'ada@example.com', confirmed: false });
    expect(expectStatus(await me(session.accessToken), 200).json()).toMatchObject({
      email: 'ada@example.com',
    });
    const renamed = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/app-auth/me',
      headers: bearer(session.accessToken),
      payload: { name: 'Ada Lovelace' },
    });
    expect(expectStatus(renamed, 200).json()).toMatchObject({ name: 'Ada Lovelace' });
    // Case-insensitive uniqueness.
    const duplicate = await registerAppUser(testApp.app, { email: 'ADA@example.com' });
    expect(duplicate.statusCode).toBe(409);
    expect(expectStatus(await loginAppUser(testApp.app, 'ADA@EXAMPLE.COM'), 200).json()).toHaveProperty(
      'accessToken',
    );
    const audited = await database.current.db
      .selectFrom('audit_events')
      .select(['action', 'actor_type', 'actor_id'])
      .where('action', '=', 'app_user.register')
      .where('target_id', '=', session.user.id)
      .execute();
    expect(audited).toEqual([
      { action: 'app_user.register', actor_type: 'app_user', actor_id: session.user.id },
    ]);
  });

  it('rejects bad credentials, invalid tokens, and rate-limits one address', async () => {
    const { user } = await signUp(testApp.app);
    expect((await loginAppUser(testApp.app, user.email, 'wrong password')).statusCode).toBe(401);
    expect((await loginAppUser(testApp.app, 'nobody@example.com')).statusCode).toBe(401);
    expect((await me('not-a-token')).statusCode).toBe(401);
    expect((await me('a.b.c')).statusCode).toBe(401);
    // Failed sign-ins count per (address, client IP).
    const attackerIp = nextTestIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const attempted = await testApp.app.inject({
        method: 'POST',
        url: '/api/app-auth/login',
        remoteAddress: attackerIp,
        payload: { email: user.email, password: 'wrong password' },
      });
      statuses.push(attempted.statusCode);
    }
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(statuses.at(-1)).toBe(429);
    // The owner, from another address, can still sign in.
    expectStatus(await loginAppUser(testApp.app, user.email), 200);
  });

  it('rotates refresh tokens and revokes the family when an old one is reused (audited)', async () => {
    const first = await signUp(testApp.app);
    const second = expectStatus(await refresh(first.refreshToken), 200).json<AppSessionBody>();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const third = expectStatus(await refresh(second.refreshToken), 200).json<AppSessionBody>();

    // A stolen copy of the first token is presented again: the whole family dies.
    const reused = await refresh(first.refreshToken);
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ error: { code: 'REFRESH_TOKEN_REUSED' } });
    expect((await refresh(third.refreshToken)).statusCode).toBe(401);

    const events = await database.current.db
      .selectFrom('audit_events')
      .select(['action', 'outcome', 'target_id', 'metadata'])
      .where('action', '=', 'app_auth.refresh_reuse')
      .where('target_id', '=', first.user.id)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: 'failure', metadata: { revokedTokens: 3 } });
    // Another sign-in of the same account is unaffected.
    const other = expectStatus(await loginAppUser(testApp.app, first.user.email), 200).json<AppSessionBody>();
    expectStatus(await refresh(other.refreshToken), 200);
  });

  it('credential routes ignore a stale access token in the Authorization header', async () => {
    const session = await signUp(testApp.app);
    const stale = { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl' };
    const refreshed = await testApp.app.inject({
      method: 'POST',
      url: '/api/app-auth/refresh',
      remoteAddress: nextTestIp(),
      headers: stale,
      payload: { refreshToken: session.refreshToken },
    });
    expectStatus(refreshed, 200);
    // Routes that act as the user still reject it.
    expect(
      (await testApp.app.inject({ method: 'GET', url: '/api/app-auth/me', headers: stale })).statusCode,
    ).toBe(401);
    expect(
      (await testApp.app.inject({ method: 'GET', url: '/api/content/anything', headers: stale })).statusCode,
    ).toBe(401);
  });

  it('a token rotated moments ago may be retried once and gets the same replacement', async () => {
    const first = await signUp(testApp.app);
    const second = expectStatus(await refresh(first.refreshToken), 200).json<AppSessionBody>();
    // The response was lost; the client retries with the token it still holds.
    const retried = expectStatus(await refresh(first.refreshToken), 200).json<AppSessionBody>();
    expect(retried.refreshToken).toBe(second.refreshToken);
    // Only once: a second retry is reuse, and the family is revoked.
    expect((await refresh(first.refreshToken)).json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REUSED' },
    });
    expect((await refresh(second.refreshToken)).statusCode).toBe(401);
  });

  it('reuse after the grace, or after the replacement was used, revokes the family', async () => {
    const late = await signUp(testApp.app);
    const lateNext = expectStatus(await refresh(late.refreshToken), 200).json<AppSessionBody>();
    await database.current.db
      .updateTable('app_refresh_tokens')
      .set({ used_at: new Date(Date.now() - 11_000) })
      .where('used_at', 'is not', null)
      .where('app_user_id', '=', late.user.id)
      .execute();
    expect((await refresh(late.refreshToken)).json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REUSED' },
    });
    expect((await refresh(lateNext.refreshToken)).statusCode).toBe(401);

    const moved = await signUp(testApp.app);
    const movedNext = expectStatus(await refresh(moved.refreshToken), 200).json<AppSessionBody>();
    expectStatus(await refresh(movedNext.refreshToken), 200);
    // Within the grace, but its replacement has already been rotated: that is reuse.
    expect((await refresh(moved.refreshToken)).json()).toMatchObject({
      error: { code: 'REFRESH_TOKEN_REUSED' },
    });
  });

  it('logout revokes the sign-in and rejects the access tokens already issued', async () => {
    const session = await signUp(testApp.app);
    const otherSignIn = expectStatus(
      await loginAppUser(testApp.app, session.user.email),
      200,
    ).json<AppSessionBody>();
    const otherUser = await signUp(testApp.app);
    const logout = () =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/app-auth/logout',
        payload: { refreshToken: session.refreshToken },
      });
    expectStatus(await me(session.accessToken), 200);
    expectStatus(await logout(), 204);
    expect((await me(session.accessToken)).statusCode).toBe(401);
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    // Every access token of the account goes; its other sign-in refreshes into a working one.
    expect((await me(otherSignIn.accessToken)).statusCode).toBe(401);
    const renewed = expectStatus(await refresh(otherSignIn.refreshToken), 200).json<AppSessionBody>();
    expectStatus(await me(renewed.accessToken), 200);
    // A second logout with the same (already revoked) token changes nothing.
    expectStatus(await logout(), 204);
    expectStatus(await me(renewed.accessToken), 200);
    // Other accounts are unaffected.
    expectStatus(await me(otherUser.accessToken), 200);
  });

  it('changing the password needs the current one and signs out other sessions', async () => {
    const session = await signUp(testApp.app);
    const change = (payload: Record<string, unknown>) =>
      testApp.app.inject({
        method: 'POST',
        url: '/api/app-auth/me/password',
        headers: bearer(session.accessToken),
        payload,
      });
    expect((await change({ currentPassword: 'wrong', newPassword: 'a brand new one' })).statusCode).toBe(403);
    const fresh = expectStatus(
      await change({ currentPassword: APP_PASSWORD, newPassword: 'a brand new one' }),
      200,
    ).json<AppSessionBody>();
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    expect((await me(session.accessToken)).statusCode).toBe(401);
    expectStatus(await me(fresh.accessToken), 200);
    expectStatus(await refresh(fresh.refreshToken), 200);
    expect((await loginAppUser(testApp.app, session.user.email)).statusCode).toBe(401);
    expectStatus(await loginAppUser(testApp.app, session.user.email, 'a brand new one'), 200);
  });

  it("rejects a blocked user's access and refresh tokens immediately", async () => {
    const session = await signUp(testApp.app);
    const otherUser = await signUp(testApp.app);
    expectStatus(await me(session.accessToken), 200);
    expectStatus(await patchAppUser(session.user.id, { blocked: true }), 200);
    expect((await me(session.accessToken)).statusCode).toBe(401);
    expectStatus(await me(otherUser.accessToken), 200);
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    expect((await loginAppUser(testApp.app, session.user.email)).json()).toMatchObject({
      error: { code: 'ACCOUNT_BLOCKED' },
    });
    expectStatus(await patchAppUser(session.user.id, { blocked: false }), 200);
    expectStatus(await loginAppUser(testApp.app, session.user.email), 200);
    const actions = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', session.user.id)
      .where('action', 'in', ['app_user.block', 'app_user.unblock'])
      .orderBy('occurred_at')
      .execute();
    expect(actions.map((row) => row.action)).toEqual(['app_user.block', 'app_user.unblock']);
  });

  it('deletes an account: tokens stop working and the address is free again', async () => {
    const session = await signUp(testApp.app);
    const remove = (password?: string) =>
      testApp.app.inject({
        method: 'DELETE',
        url: '/api/app-auth/me',
        headers: bearer(session.accessToken),
        payload: password === undefined ? {} : { password },
      });
    expect((await remove()).statusCode).toBe(403);
    expectStatus(await remove(APP_PASSWORD), 204);
    expect((await me(session.accessToken)).statusCode).toBe(401);
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    const row = await database.current.db
      .selectFrom('app_users')
      .select(['email', 'name', 'password_hash', 'deleted_at'])
      .where('id', '=', session.user.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ name: '', password_hash: null });
    expect(row.email).not.toBe(session.user.email);
    expect(row.deleted_at).not.toBeNull();
    expectStatus(await registerAppUser(testApp.app, { email: session.user.email }), 201);
  });

  it('an explicit app-user bearer token wins over an admin API token format check', async () => {
    const session = await signUp(testApp.app);
    const response = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/app-users',
      headers: bearer(session.accessToken),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('app-user email confirmation and password reset', () => {
  const database = useTestDatabase();
  const transport = createMemoryEmailTransport();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: {
        APP_AUTH_REQUIRE_EMAIL_CONFIRMATION: 'true',
        APP_AUTH_CONFIRM_EMAIL_URL: 'https://site.example.com/confirm',
        APP_AUTH_RESET_PASSWORD_URL: 'https://site.example.com/reset',
      },
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const post = (url: string, payload: Record<string, unknown>) =>
    testApp.app.inject({ method: 'POST', url, remoteAddress: nextTestIp(), payload });
  const deliverEmails = () =>
    runAppEmailJobs(testApp.app, database.current.db, transport, testApp.config.appAuth);

  it('requires a confirmed address before signing in; the link works once', async () => {
    const email = 'grace@example.com';
    const registered = expectStatus(await registerAppUser(testApp.app, { email }), 202).json<unknown>();
    expect(registered).toEqual({ confirmationRequired: true });
    expect((await loginAppUser(testApp.app, email)).json()).toMatchObject({
      error: { code: 'EMAIL_NOT_CONFIRMED' },
    });
    await deliverEmails();
    const message = transport.sent.at(-1);
    expect(message?.subject).toBe('Confirm your email address for site.example.com');
    expect(message?.text).toContain('https://site.example.com/confirm#token=');
    const token = lastTokenSentTo(transport, email);
    expectStatus(await post('/api/app-auth/confirm-email', { token }), 204);
    expect((await post('/api/app-auth/confirm-email', { token })).statusCode).toBe(400);
    const session = expectStatus(await loginAppUser(testApp.app, email), 200).json<AppSessionBody>();
    expect(session.user.confirmed).toBe(true);
    // The plain token never sits in the jobs table.
    const jobs = await database.current.db.selectFrom('jobs').select('payload').execute();
    expect(JSON.stringify(jobs)).not.toContain(token);
  });

  it('answers a sign-up for a taken address like a new one and tells the owner by email', async () => {
    const email = 'hedy@example.com';
    const first = await registerAppUser(testApp.app, { email });
    await deliverEmails();
    expectStatus(
      await post('/api/app-auth/confirm-email', { token: lastTokenSentTo(transport, email) }),
      204,
    );
    const sentBefore = transport.sent.length;
    const again = await registerAppUser(testApp.app, {
      email: 'Hedy@Example.com',
      password: 'another pw 123',
    });
    expect(again.statusCode).toBe(first.statusCode);
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual(first.json());
    await deliverEmails();
    const notices = transport.sent.slice(sentBefore);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: email, subject: 'Sign-up attempt for site.example.com' });
    expect(notices[0]?.text).not.toContain('#token=');
    // Nothing was created or changed: one account, the original password still works.
    const accounts = await database.current.db
      .selectFrom('app_users')
      .select('id')
      .where('email', '=', email)
      .execute();
    expect(accounts).toHaveLength(1);
    expectStatus(await loginAppUser(testApp.app, email), 200);
    expect((await loginAppUser(testApp.app, email, 'another pw 123')).statusCode).toBe(401);
  });

  it('resets a password with a single-use link and revokes every sign-in', async () => {
    const email = 'linus@example.com';
    expectStatus(await registerAppUser(testApp.app, { email }), 202);
    await deliverEmails();
    expectStatus(
      await post('/api/app-auth/confirm-email', { token: lastTokenSentTo(transport, email) }),
      204,
    );
    const session = expectStatus(await loginAppUser(testApp.app, email), 200).json<AppSessionBody>();

    expectStatus(await post('/api/app-auth/password-reset', { email }), 202);
    expectStatus(await post('/api/app-auth/password-reset', { email: 'unknown@example.com' }), 202);
    await deliverEmails();
    const token = lastTokenSentTo(transport, email);
    expect(transport.sent.at(-1)?.text).toContain('https://site.example.com/reset#token=');
    expectStatus(
      await post('/api/app-auth/password-reset/confirm', { token, password: 'new secret pw' }),
      204,
    );
    expect(
      (await post('/api/app-auth/password-reset/confirm', { token, password: 'other pw 123' })).statusCode,
    ).toBe(400);
    expect((await loginAppUser(testApp.app, email)).statusCode).toBe(401);
    expectStatus(await loginAppUser(testApp.app, email, 'new secret pw'), 200);
    expect((await post('/api/app-auth/refresh', { refreshToken: session.refreshToken })).statusCode).toBe(
      401,
    );
    const meResponse = await testApp.app.inject({
      method: 'GET',
      url: '/api/app-auth/me',
      headers: bearer(session.accessToken),
    });
    expect(meResponse.statusCode).toBe(401);
    const actions = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('action', 'like', 'app_user.%')
      .execute();
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'app_user.confirm_email',
        'app_user.password_reset_request',
        'app_user.password_reset',
      ]),
    );
  });
});
