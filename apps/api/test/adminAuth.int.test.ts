import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '../src/constants/auth.js';
import {
  cookieHeader,
  createAdmin,
  login,
  sessionCookieOf,
  TEST_PASSWORD,
  type TestAdmin,
} from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('admin sessions, CSRF and rate limits', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestAdmin;
  let editor: TestAdmin;

  beforeAll(async () => {
    testApp = await createTestApp(database.current);
    owner = await createAdmin(testApp.db, { roleKeys: ['owner'] });
    editor = await createAdmin(testApp.db, { roleKeys: ['editor'] });
  });
  afterAll(() => testApp.app.close());

  const me = (cookie: string) =>
    testApp.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: cookieHeader(cookie) });

  it('signs in with an httpOnly SameSite=Lax session cookie and returns a CSRF token', async () => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: owner.email.toUpperCase(), password: TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.secure).toBeFalsy();
    expect(response.json()).toMatchObject({
      user: { email: owner.email },
      csrfToken: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.json())).not.toContain('password');
    const stored = await testApp.db.selectFrom('admin_sessions').select('token_hash').execute();
    expect(JSON.stringify(stored)).not.toContain(cookie?.value ?? 'missing');
  });

  it('marks the cookie Secure when PUBLIC_URL is https', async () => {
    const secure = await createTestApp(database.current, { env: { PUBLIC_URL: 'https://cms.example.com' } });
    const response = await secure.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: owner.email, password: TEST_PASSWORD },
    });
    await secure.app.close();
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.secure).toBe(true);
  });

  it('gives unknown emails, wrong passwords and disabled accounts the same answer', async () => {
    const attempts = [
      { email: 'nobody@example.com', password: TEST_PASSWORD },
      { email: owner.email, password: 'wrong password!' },
    ];
    for (const payload of attempts) {
      const response = await testApp.app.inject({ method: 'POST', url: '/api/admin/auth/login', payload });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      });
    }
    const failures = await testApp.db
      .selectFrom('audit_events')
      .select('outcome')
      .where('action', '=', 'auth.login')
      .where('outcome', '=', 'failure')
      .execute();
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });

  it('requires a session for /me', async () => {
    expect((await testApp.app.inject({ method: 'GET', url: '/api/admin/auth/me' })).statusCode).toBe(401);
    expect((await me('not-a-real-session')).statusCode).toBe(401);
  });

  it('rotates the session on login', async () => {
    const first = await login(testApp.app, owner);
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: cookieHeader(first.cookie),
      payload: { email: owner.email, password: TEST_PASSWORD },
    });
    const second = sessionCookieOf(response);
    expect(second).toBeDefined();
    expect(second).not.toBe(first.cookie);
    expect((await me(first.cookie)).statusCode).toBe(401);
    expect((await me(second ?? '')).statusCode).toBe(200);
  });

  it('fails the next request of a revoked session', async () => {
    const victim = await login(testApp.app, owner);
    const other = await login(testApp.app, owner);
    const sessions = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/auth/sessions',
      headers: cookieHeader(other.cookie),
    });
    const listed = sessions.json<{ id: string; current: boolean }[]>();
    expect(listed.filter((s) => s.current)).toHaveLength(1);
    const victimId = (
      await testApp.db
        .selectFrom('admin_sessions')
        .select('id')
        .where('revoked_at', 'is', null)
        .orderBy('created_at', 'desc')
        .offset(1)
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    expect((await me(victim.cookie)).statusCode).toBe(200);
    const revoke = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/admin/auth/sessions/${victimId}`,
      headers: other.headers,
    });
    expect(revoke.statusCode).toBe(204);
    expect((await me(victim.cookie)).statusCode).toBe(401);
    expect((await me(other.cookie)).statusCode).toBe(200);

    const logout = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: other.headers,
    });
    expect(logout.statusCode).toBe(204);
    expect((await me(other.cookie)).statusCode).toBe(401);
  });

  it('expires sessions after idle time and at their absolute expiry', async () => {
    const idle = await login(testApp.app, owner);
    const absolute = await login(testApp.app, editor);
    await testApp.db
      .updateTable('admin_sessions')
      .set({ last_seen_at: new Date(Date.now() - 13 * 60 * 60 * 1000) })
      .where('admin_user_id', '=', owner.id)
      .execute();
    await testApp.db
      .updateTable('admin_sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('admin_user_id', '=', editor.id)
      .execute();
    expect((await me(idle.cookie)).statusCode).toBe(401);
    expect((await me(absolute.cookie)).statusCode).toBe(401);
  });

  it('rejects cookie-authenticated mutations without a valid CSRF header', async () => {
    const session = await login(testApp.app, owner);
    const missing = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: cookieHeader(session.cookie),
      payload: { name: 'New name' },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const wrong = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: { ...cookieHeader(session.cookie), 'x-csrf-token': 'forged' },
      payload: { name: 'New name' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    // A token from another session does not work either: the secret is bound to the session.
    const otherSession = await login(testApp.app, owner);
    const crossed = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: { ...cookieHeader(session.cookie), 'x-csrf-token': otherSession.csrfToken },
      payload: { name: 'New name' },
    });
    expect(crossed.statusCode).toBe(403);
    expect(crossed.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const ok = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: session.headers,
      payload: { name: 'New name' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'New name' });

    const fresh = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/auth/csrf',
      headers: cookieHeader(session.cookie),
    });
    const again = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: {
        ...cookieHeader(session.cookie),
        'x-csrf-token': fresh.json<{ csrfToken: string }>().csrfToken,
      },
      payload: { name: 'Again' },
    });
    expect(again.statusCode).toBe(200);
  });

  it('refuses a logout without the CSRF header and keeps the session; with the header it signs out', async () => {
    const session = await login(testApp.app, owner);
    const forged = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: cookieHeader(session.cookie),
    });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    expect((await me(session.cookie)).statusCode).toBe(200);

    const real = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: session.headers,
    });
    expect(real.statusCode).toBe(204);
    expect((await me(session.cookie)).statusCode).toBe(401);
  });

  it('rotates a session on its next request after a privilege change', async () => {
    const target = await createAdmin(testApp.db, { roleKeys: ['read-only'] });
    const targetSession = await login(testApp.app, target);
    const ownerSession = await login(testApp.app, owner);
    const editorRole = await testApp.db
      .selectFrom('admin_roles')
      .select('id')
      .where('key', '=', 'editor')
      .executeTakeFirstOrThrow();
    const change = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: ownerSession.headers,
      payload: { roleIds: [editorRole.id] },
    });
    expect(change.statusCode).toBe(200);

    const next = await me(targetSession.cookie);
    expect(next.statusCode).toBe(200);
    const rotated = sessionCookieOf(next);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(targetSession.cookie);
    expect(next.json()).toMatchObject({ roles: [{ key: 'editor' }] });
    expect((await me(rotated ?? '')).statusCode).toBe(200);
    // The CSRF secret carries over, so the SPA's token keeps working after the transparent rotation.
    const mutation = await testApp.app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: { ...cookieHeader(rotated ?? ''), 'x-csrf-token': targetSession.csrfToken },
      payload: { name: 'Rotated' },
    });
    expect(mutation.statusCode).toBe(200);
  });

  it('signs a disabled admin out at once', async () => {
    const target = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    const targetSession = await login(testApp.app, target);
    const ownerSession = await login(testApp.app, owner);
    const disable = await testApp.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.id}`,
      headers: ownerSession.headers,
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode).toBe(200);
    expect((await me(targetSession.cookie)).statusCode).toBe(401);
    const relogin = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: target.email, password: TEST_PASSWORD },
    });
    expect(relogin.statusCode).toBe(401);
  });

  it('changes the password: other sessions die, the current one is replaced', async () => {
    const user = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    const current = await login(testApp.app, user);
    const elsewhere = await login(testApp.app, user);
    const wrong = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/me/password',
      headers: current.headers,
      payload: { currentPassword: 'not my password', newPassword: 'a brand new passphrase' },
    });
    expect(wrong.statusCode).toBe(400);
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/me/password',
      headers: current.headers,
      payload: { currentPassword: user.password, newPassword: 'a brand new passphrase' },
    });
    expect(response.statusCode).toBe(200);
    const replaced = sessionCookieOf(response);
    expect(replaced).toBeDefined();
    expect((await me(elsewhere.cookie)).statusCode).toBe(401);
    expect((await me(current.cookie)).statusCode).toBe(401);
    expect((await me(replaced ?? '')).statusCode).toBe(200);
    await login(testApp.app, { email: user.email, password: 'a brand new passphrase' });
  });

  it('rejects passwords that are too short', async () => {
    const session = await login(testApp.app, owner);
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/me/password',
      headers: session.headers,
      payload: { currentPassword: owner.password, newPassword: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('login rate limits', () => {
  const database = useTestDatabase();

  it('limits failed attempts per account and client, so another IP cannot lock the owner out', async () => {
    const { app, db } = await createTestApp(database.current);
    const target = await createAdmin(db);
    const attempt = (ip: string, password = 'wrong password!') =>
      app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        remoteAddress: ip,
        payload: { email: target.email, password },
      });
    // An attacker guessing from one IP is stopped after 5 failures, even with the right password.
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      codes.push((await attempt('10.0.0.66')).statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
    const attackerRight = await attempt('10.0.0.66', TEST_PASSWORD);
    expect(attackerRight.statusCode).toBe(429);
    expect(attackerRight.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    // Failures spread over many IPs never lock the account itself: the owner still signs in from theirs.
    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(`10.0.1.${i + 1}`)).statusCode).toBe(401);
    }
    expect((await attempt('10.0.0.99', TEST_PASSWORD)).statusCode).toBe(200);
    await app.close();
  });

  it('limits attempts per IP, across email addresses', async () => {
    const { app } = await createTestApp(database.current);
    const codes: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        remoteAddress: '192.0.2.7',
        payload: { email: `user${i}@example.com`, password: 'wrong password!' },
      });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 20).every((code) => code === 401)).toBe(true);
    expect(codes[20]).toBe(429);
    await app.close();
  });
});
