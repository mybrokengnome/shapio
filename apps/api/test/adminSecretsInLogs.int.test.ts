import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { issueSetupToken } from '../src/services/setup.js';
import {
  cookieHeader,
  createAdmin,
  login,
  nextTestIp,
  runEmailJobs,
  sessionCookieOf,
  TEST_PASSWORD,
} from './helpers/adminIdentity.js';
import { APP_PASSWORD, bearer, loginAppUser, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp } from './helpers/createTestApp.js';
import { createLogCapture } from './helpers/logCapture.js';
import { pathOf, uploadAsset } from './helpers/media.js';
import { createMemoryEmailTransport, lastTokenSentTo } from './helpers/memoryEmailTransport.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  drainJobs,
  startReceiver,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('secrets never reach the logs', () => {
  const database = useTestDatabase();

  it('keeps passwords, tokens, cookies and CSRF values out of every log line', async () => {
    const logs = createLogCapture();
    // With SETUP_REQUIRE_TOKEN, so the setup token is among the secrets checked.
    const { app, db } = await createTestApp(database.current, {
      logger: logs.logger,
      env: { SETUP_REQUIRE_TOKEN: 'true' },
    });
    const mail = createMemoryEmailTransport();
    const secrets: string[] = [TEST_PASSWORD];
    const remember = (value: string | undefined) => {
      expect(value).toBeTruthy();
      secrets.push(value ?? '');
      return value ?? '';
    };

    // The boot line is the one place the setup token may appear; issue a second one to use here.
    const bootToken = /One-time setup token: ([A-Za-z0-9_-]{43})/.exec(logs.text())?.[1];
    expect(bootToken).toBeDefined();
    const setupToken = remember(await issueSetupToken(db));
    const setup = await app.inject({
      method: 'POST',
      url: '/api/admin/setup',
      payload: { token: setupToken, email: 'owner@example.com', name: 'Owner', password: TEST_PASSWORD },
    });
    expect(setup.statusCode).toBe(201);
    const cookie = remember(sessionCookieOf(setup));
    const headers = {
      ...cookieHeader(cookie),
      'x-csrf-token': remember(setup.json<{ csrfToken: string }>().csrfToken),
    };

    // Failed and successful logins, a CSRF failure, a validation failure.
    await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: 'owner@example.com', password: 'wrong-but-secret-123' },
    });
    secrets.push('wrong-but-secret-123');
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      remoteAddress: nextTestIp(),
      payload: { email: 'owner@example.com', password: TEST_PASSWORD },
    });
    remember(sessionCookieOf(login));
    remember(login.json<{ csrfToken: string }>().csrfToken);
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/auth/me',
      headers: { ...cookieHeader(cookie), 'x-csrf-token': 'forged-csrf-value' },
      payload: { name: 'x' },
    });
    secrets.push('forged-csrf-value');
    await app.inject({
      method: 'POST',
      url: '/api/admin/auth/me/password',
      headers,
      payload: { currentPassword: 'cur-secret-pass-1', newPassword: 'tiny' },
    });
    secrets.push('cur-secret-pass-1');

    // API token creation and use, including a bad token.
    const roleId = (
      await db.selectFrom('admin_roles').select('id').where('key', '=', 'admin').executeTakeFirstOrThrow()
    ).id;
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/tokens',
      headers,
      payload: { name: 'ci', roleId },
    });
    const apiToken = remember(created.json<{ token: string }>().token);
    await app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { authorization: `Bearer ${apiToken}` },
    });
    await app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { authorization: 'Bearer shp_not-a-real-token-value' },
    });
    secrets.push('shp_not-a-real-token-value');

    // Invitation and password reset tokens, delivered through the worker.
    const editorRoleId = (
      await db.selectFrom('admin_roles').select('id').where('key', '=', 'editor').executeTakeFirstOrThrow()
    ).id;
    await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers,
      payload: { email: 'new@example.com', roleIds: [editorRoleId] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/auth/password-reset',
      payload: { email: 'owner@example.com' },
    });
    await runEmailJobs(app, db, mail);
    const inviteToken = remember(lastTokenSentTo(mail, 'new@example.com'));
    const resetToken = remember(lastTokenSentTo(mail, 'owner@example.com'));
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations/accept',
      payload: { token: inviteToken, name: 'New', password: 'invitee-secret-pass' },
    });
    expect(accepted.statusCode).toBe(201);
    secrets.push('invitee-secret-pass');
    remember(sessionCookieOf(accepted));
    await app.inject({
      method: 'POST',
      url: '/api/admin/auth/password-reset/confirm',
      payload: { token: resetToken, password: 'reset-secret-pass' },
    });
    secrets.push('reset-secret-pass');
    await app.inject({ method: 'POST', url: '/api/admin/auth/logout', headers });

    await app.close();
    const text = logs.text();
    expect(logs.lines.length).toBeGreaterThan(20);
    for (const secret of secrets) {
      expect(text, `log output contains ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
    expect(logs.lines.filter((line) => line.includes(bootToken ?? 'missing'))).toHaveLength(1);
  });

  it('keeps app-user, publishing, preview and media secrets out of logs, job payloads and outbox events', async () => {
    const logs = createLogCapture();
    const testApp = await createPublishingTestApp(database.current, { logger: logs.logger });
    const { app, db } = testApp;
    const receiver = await startReceiver();
    const worker = createPublishingWorker({ db, app, dns: testApp.dns, log: logs.logger });
    const secrets: string[] = [APP_PASSWORD];
    const remember = (value: string | undefined) => {
      expect(value).toBeTruthy();
      secrets.push(value ?? '');
      return value ?? '';
    };
    try {
      const adminToken = remember(await createRoleToken(db));
      const admin = schemaClient(app, adminToken);
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      });

      // App users: register, sign in, refresh, then reuse the rotated refresh token.
      const session = await signUp(app, { email: 'reader@example.com' });
      remember(session.accessToken);
      remember(session.refreshToken);
      const signedIn = expectStatus(
        await loginAppUser(app, 'reader@example.com'),
        200,
      ).json<AppSessionBody>();
      remember(signedIn.accessToken);
      const refresh = (refreshToken: string) =>
        app.inject({ method: 'POST', url: '/api/app-auth/refresh', payload: { refreshToken } });
      remember((await refresh(signedIn.refreshToken)).json<AppSessionBody>().refreshToken);
      await app.inject({
        method: 'GET',
        url: '/api/app-auth/me',
        headers: bearer(signedIn.accessToken),
      });
      // An OAuth callback carries a code and state in its query string.
      await app.inject({
        method: 'GET',
        url: '/api/app-auth/oauth/github/callback?code=oauth-code-secret-1&state=oauth-state-secret-1',
      });
      secrets.push('oauth-code-secret-1', 'oauth-state-secret-1');

      // A webhook and a deploy connection with their secrets, exercised by a publish.
      const webhook = expectStatus(
        await admin.post('/api/admin/webhooks', {
          name: 'Site',
          url: `${receiver.url}/hooks`,
          events: ['entry.published'],
          allowPrivateNetwork: true,
        }),
        201,
      ).json<{ secret: string }>();
      remember(webhook.secret);
      const connection = expectStatus(
        await admin.post('/api/admin/deployments/connections', {
          name: 'Example site',
          provider: 'generic_webhook',
          settings: { url: `${receiver.url}/build` },
          secrets: {},
          triggerPolicy: ['publish'],
          debounceSeconds: 0,
          allowPrivateNetwork: true,
        }),
        201,
      ).json<{ generatedSecrets: Record<string, string> }>();
      remember(connection.generatedSecrets.signingSecret);
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Hello' } }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
      await drainJobs(worker, db, {
        types: [PUBLISHING_JOBS.webhookDeliver, PUBLISHING_JOBS.deploymentTrigger],
      });
      expect(receiver.requests.length).toBeGreaterThanOrEqual(2);

      // A preview token, used.
      const editor = await login(app, await createAdmin(db, { roleKeys: ['admin'] }));
      remember(editor.cookie);
      remember(editor.csrfToken);
      const preview = expectStatus(
        await app.inject({
          method: 'POST',
          url: '/api/admin/preview/tokens',
          headers: editor.headers,
          payload: { modelKey: 'article', entryId: entry.id },
        }),
        201,
      ).json<{ token: string }>();
      remember(preview.token);
      await app.inject({
        method: 'GET',
        url: `/api/preview/content/articles/${entry.id}`,
        headers: bearer(preview.token),
      });

      // A private asset fetched through its signed URL.
      const asset = await uploadAsset(app, bearer(adminToken), {
        file: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
        filename: 'contract.pdf',
        mimeType: 'application/pdf',
        visibility: 'private',
      });
      const signature = remember(new URL(asset.url).searchParams.get('signature') ?? undefined);
      expect((await app.inject({ method: 'GET', url: pathOf(asset.url) })).statusCode).toBe(200);
      expect(signature.length).toBeGreaterThan(20);
    } finally {
      await worker.stop(500);
      await receiver.close();
      await app.close();
    }

    const text = logs.text();
    expect(logs.lines.length).toBeGreaterThan(20);
    // The signed media request was logged, with its signature redacted.
    expect(text).toMatch(/signature=%5Bredacted%5D/);
    const stored = await sql<{ payload: string }>`
      select payload::text as payload from jobs
      union all select coalesce(result::text, '') from jobs
      union all select coalesce(last_error, '') from jobs
      union all select payload::text from outbox_events
    `.execute(db);
    const storedText = stored.rows.map((row) => row.payload).join('\n');
    expect(stored.rows.length).toBeGreaterThan(3);
    for (const secret of secrets) {
      expect(text, `log output contains ${secret.slice(0, 6)}…`).not.toContain(secret);
      expect(storedText, `jobs or outbox contain ${secret.slice(0, 6)}…`).not.toContain(secret);
    }
  });
});
