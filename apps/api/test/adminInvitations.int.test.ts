import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  cookieHeader,
  createAdmin,
  nextTestIp,
  runEmailJobs,
  sessionCookieOf,
  TEST_PASSWORD,
  type TestAdmin,
  type TestSession,
} from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createMemoryEmailTransport, lastTokenSentTo } from './helpers/memoryEmailTransport.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('invitations and password resets', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestAdmin;
  let ownerSession: TestSession;
  let editorRoleId: string;
  const mail = createMemoryEmailTransport();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      env: { PUBLIC_URL: 'https://cms.example.com', BASE_PATH: '/cms' },
    });
    owner = await createAdmin(testApp.db);
    ownerSession = await loginAt(owner);
    editorRoleId = (
      await testApp.db
        .selectFrom('admin_roles')
        .select('id')
        .where('key', '=', 'editor')
        .executeTakeFirstOrThrow()
    ).id;
  });
  afterAll(() => testApp.app.close());
  beforeEach(() => {
    mail.sent.length = 0;
  });

  const loginAt = async (admin: Pick<TestAdmin, 'email' | 'password'>) => {
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/auth/login',
      remoteAddress: nextTestIp(),
      payload: { email: admin.email, password: admin.password },
    });
    expect(response.statusCode).toBe(200);
    const csrfToken = response.json<{ csrfToken: string }>().csrfToken;
    const cookie = sessionCookieOf(response) ?? '';
    return { cookie, csrfToken, headers: { ...cookieHeader(cookie), 'x-csrf-token': csrfToken } };
  };

  const invite = (email: string, roleIds = [editorRoleId]) =>
    testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/invitations',
      headers: ownerSession.headers,
      payload: { email, roleIds },
    });

  const accept = (token: string, name = 'New Editor') =>
    testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/invitations/accept',
      remoteAddress: nextTestIp(),
      payload: { token, name, password: TEST_PASSWORD },
    });

  it('invites by email with a single-use link built from PUBLIC_URL and BASE_PATH', async () => {
    const created = await invite('New.Editor@Example.com');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'new.editor@example.com', roleIds: [editorRoleId] });
    await runEmailJobs(testApp.app, testApp.db, mail);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.text).toContain('https://cms.example.com/cms/admin/accept-invitation#token=');
    const token = lastTokenSentTo(mail, 'new.editor@example.com');
    // The plain token is nowhere in the database: not in the invitation, not in the job.
    const rows = JSON.stringify(await testApp.db.selectFrom('admin_invitations').selectAll().execute());
    const jobs = JSON.stringify(await testApp.db.selectFrom('jobs').selectAll().execute());
    expect(rows).not.toContain(token);
    expect(jobs).not.toContain(token);

    const inspected = await testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/invitations/inspect',
      payload: { token },
    });
    expect(inspected.json()).toMatchObject({ email: 'new.editor@example.com' });

    const accepted = await accept(token);
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({
      user: { email: 'new.editor@example.com', roleIds: [editorRoleId] },
    });
    const me = await testApp.app.inject({
      method: 'GET',
      url: '/cms/api/admin/auth/me',
      headers: cookieHeader(sessionCookieOf(accepted) ?? ''),
    });
    expect(me.json()).toMatchObject({ roles: [{ key: 'editor' }] });

    const again = await accept(token, 'Someone Else');
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_TOKEN' } });
  });

  it('rejects expired and revoked invitations', async () => {
    await invite('late@example.com');
    await runEmailJobs(testApp.app, testApp.db, mail);
    const expiredToken = lastTokenSentTo(mail, 'late@example.com');
    await testApp.db
      .updateTable('admin_invitations')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('email', '=', 'late@example.com')
      .execute();
    expect((await accept(expiredToken)).statusCode).toBe(400);

    const created = await invite('revoked@example.com');
    await runEmailJobs(testApp.app, testApp.db, mail);
    const revokedToken = lastTokenSentTo(mail, 'revoked@example.com');
    const revoke = await testApp.app.inject({
      method: 'DELETE',
      url: `/cms/api/admin/invitations/${created.json<{ id: string }>().id}`,
      headers: ownerSession.headers,
    });
    expect(revoke.statusCode).toBe(204);
    expect((await accept(revokedToken)).statusCode).toBe(400);
  });

  it('kills the previous link when the email job runs again', async () => {
    const created = await invite('retry@example.com');
    await runEmailJobs(testApp.app, testApp.db, mail);
    const first = lastTokenSentTo(mail, 'retry@example.com');
    // Simulate an at-least-once redelivery of the same job.
    await testApp.db
      .updateTable('jobs')
      .set({ status: 'pending', run_at: new Date() })
      .where('payload', '@>', JSON.stringify({ invitationId: created.json<{ id: string }>().id }))
      .execute();
    await runEmailJobs(testApp.app, testApp.db, mail);
    const second = lastTokenSentTo(mail, 'retry@example.com');
    expect(second).not.toBe(first);
    expect((await accept(first)).statusCode).toBe(400);
    expect((await accept(second)).statusCode).toBe(201);
  });

  const issueLink = (id: string, headers = ownerSession.headers) =>
    testApp.app.inject({ method: 'POST', url: `/cms/api/admin/invitations/${id}/link`, headers });

  const tokenOf = (acceptUrl: string) => decodeURIComponent(acceptUrl.split('#token=')[1] ?? '');

  it('issues a copyable link that accepts the invitation, without email', async () => {
    const created = await invite('copied@example.com');
    const id = created.json<{ id: string }>().id;
    const response = await issueLink(id);
    expect(response.statusCode).toBe(200);
    const { acceptUrl, expiresAt } = response.json<{ acceptUrl: string; expiresAt: string }>();
    expect(acceptUrl).toMatch(/^https:\/\/cms\.example\.com\/cms\/admin\/accept-invitation#token=/);
    expect(expiresAt).toBe(created.json<{ expiresAt: string }>().expiresAt);
    const token = tokenOf(acceptUrl);
    const rows = JSON.stringify(await testApp.db.selectFrom('admin_invitations').selectAll().execute());
    expect(rows).not.toContain(token);
    const audit = await testApp.db
      .selectFrom('audit_events')
      .select(['action', 'target_id'])
      .where('action', '=', 'invitation.link')
      .execute();
    expect(audit).toContainEqual({ action: 'invitation.link', target_id: id });

    // The email job's first attempt leaves a copied link alone: nothing is sent, the link keeps working.
    await runEmailJobs(testApp.app, testApp.db, mail);
    expect(mail.sent.filter((message) => message.to === 'copied@example.com')).toHaveLength(0);
    const accepted = await accept(token, 'Copied Link');
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ user: { email: 'copied@example.com', roleIds: [editorRoleId] } });
    expect((await issueLink(id)).statusCode).toBe(404);
  });

  it('a new link replaces the earlier ones, emailed or copied', async () => {
    const created = await invite('relinked@example.com');
    const id = created.json<{ id: string }>().id;
    await runEmailJobs(testApp.app, testApp.db, mail);
    const emailed = lastTokenSentTo(mail, 'relinked@example.com');
    const first = tokenOf((await issueLink(id)).json<{ acceptUrl: string }>().acceptUrl);
    const second = tokenOf((await issueLink(id)).json<{ acceptUrl: string }>().acceptUrl);
    expect(new Set([emailed, first, second]).size).toBe(3);
    expect((await accept(emailed)).statusCode).toBe(400);
    expect((await accept(first)).statusCode).toBe(400);
    expect((await accept(second)).statusCode).toBe(201);
  });

  it('needs users.manage to issue a link, and only for a pending invitation', async () => {
    const created = await invite('guarded@example.com');
    const id = created.json<{ id: string }>().id;
    const editor = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    const editorSession = await loginAt(editor);
    expect((await issueLink(id, editorSession.headers)).statusCode).toBe(403);
    expect(
      (await testApp.app.inject({ method: 'POST', url: `/cms/api/admin/invitations/${id}/link` })).statusCode,
    ).toBe(401);
    await testApp.app.inject({
      method: 'DELETE',
      url: `/cms/api/admin/invitations/${id}`,
      headers: ownerSession.headers,
    });
    const revoked = await issueLink(id);
    expect(revoked.statusCode).toBe(404);
    expect(revoked.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('tells the admin UI whether real email delivery is configured', async () => {
    const me = await testApp.app.inject({
      method: 'GET',
      url: '/cms/api/admin/auth/me',
      headers: ownerSession.headers,
    });
    expect(me.json()).toMatchObject({ emailDelivery: 'console' });
  });

  it('refuses to invite an existing admin, and lets only owners invite owners', async () => {
    expect((await invite(owner.email)).statusCode).toBe(409);
    const admin = await createAdmin(testApp.db, { roleKeys: ['admin'] });
    const adminSession = await loginAt(admin);
    const ownerRole = await testApp.db
      .selectFrom('admin_roles')
      .select('id')
      .where('key', '=', 'owner')
      .executeTakeFirstOrThrow();
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/invitations',
      headers: adminSession.headers,
      payload: { email: 'wannabe-owner@example.com', roleIds: [ownerRole.id] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'OWNER_REQUIRED' } });
  });

  const requestReset = (email: string) =>
    testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/auth/password-reset',
      remoteAddress: nextTestIp(),
      payload: { email },
    });

  const confirmReset = (token: string, password: string) =>
    testApp.app.inject({
      method: 'POST',
      url: '/cms/api/admin/auth/password-reset/confirm',
      remoteAddress: nextTestIp(),
      payload: { token, password },
    });

  it('resets a password with a single-use link and signs the account out everywhere', async () => {
    const user = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    const session = await loginAt(user);
    const response = await requestReset(user.email);
    expect(response.statusCode).toBe(202);
    await runEmailJobs(testApp.app, testApp.db, mail);
    expect(mail.sent[0]?.text).toContain('https://cms.example.com/cms/admin/reset-password#token=');
    const token = lastTokenSentTo(mail, user.email);

    expect((await confirmReset(token, 'my new long passphrase')).statusCode).toBe(204);
    const me = await testApp.app.inject({
      method: 'GET',
      url: '/cms/api/admin/auth/me',
      headers: cookieHeader(session.cookie),
    });
    expect(me.statusCode).toBe(401);
    await loginAt({ email: user.email, password: 'my new long passphrase' });

    const reused = await confirmReset(token, 'another long passphrase');
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_TOKEN' } });
  });

  it('rejects an expired reset link', async () => {
    const user = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    await requestReset(user.email);
    await runEmailJobs(testApp.app, testApp.db, mail);
    const token = lastTokenSentTo(mail, user.email);
    await testApp.db
      .updateTable('password_resets')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('admin_user_id', '=', user.id)
      .execute();
    expect((await confirmReset(token, 'my new long passphrase')).statusCode).toBe(400);
    await loginAt(user); // the old password still works
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const response = await requestReset('nobody@example.com');
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({});
    await runEmailJobs(testApp.app, testApp.db, mail);
    expect(mail.sent).toHaveLength(0);
  });
});
