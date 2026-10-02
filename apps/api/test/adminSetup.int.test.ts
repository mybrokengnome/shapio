import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../src/helpers/tokens.js';
import { issueSetupToken } from '../src/services/setup.js';
import { cookieHeader, sessionCookieOf, TEST_PASSWORD } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createLogCapture } from './helpers/logCapture.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const SETUP_TOKEN_LINE = /One-time setup token: ([A-Za-z0-9_-]{43})/;

const setupBody = (token: string | undefined, email: string) => ({
  ...(token === undefined ? {} : { token }),
  email,
  name: 'Owner',
  password: TEST_PASSWORD,
});

const postSetupTo = (testApp: TestApp, token: string | undefined, email: string) =>
  testApp.app.inject({ method: 'POST', url: '/api/admin/setup', payload: setupBody(token, email) });

const setupStatus = async (testApp: TestApp) =>
  (await testApp.app.inject({ method: 'GET', url: '/api/admin/setup' })).json<unknown>();

/** Of concurrent setups exactly one wins; the winner is a signed-in owner and setup is audited once. */
const expectExactlyOneOwner = async (testApp: TestApp, responses: LightMyRequestResponse[]) => {
  const codes = responses.map((response) => response.statusCode);
  expect(codes.filter((code) => code === 201)).toHaveLength(1);
  expect(codes.filter((code) => code !== 201).every((code) => code === 409 || code === 403)).toBe(true);
  const admins = await testApp.db.selectFrom('admin_users').select('email').execute();
  expect(admins).toHaveLength(1);

  const winner = responses.find((response) => response.statusCode === 201);
  expect(winner?.json()).toMatchObject({ user: { email: admins[0]?.email, status: 'active' } });
  const me = await testApp.app.inject({
    method: 'GET',
    url: '/api/admin/auth/me',
    headers: cookieHeader(sessionCookieOf(winner!) ?? ''),
  });
  expect(me.statusCode).toBe(200);
  expect(me.json()).toMatchObject({
    roles: [{ key: 'owner' }],
    globalPermissions: expect.arrayContaining(['users.manage']) as unknown,
  });
  const audit = await testApp.db
    .selectFrom('audit_events')
    .selectAll()
    .where('action', '=', 'setup.complete')
    .execute();
  expect(audit).toHaveLength(1);
};

describe('first-run setup (default: no token)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  const logs = createLogCapture();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: logs.logger });
  });
  afterAll(() => testApp.app.close());

  it('logs where to create the owner, issues no token, and says none is required', async () => {
    const line = `No admin account yet. Open ${testApp.config.server.publicUrl}/admin/ to create the owner account.`;
    expect(logs.lines.filter((logged) => logged.includes(line))).toHaveLength(1);
    expect(logs.text()).not.toMatch(/setup token/i);
    expect(await testApp.db.selectFrom('setup_tokens').select('id').execute()).toEqual([]);
    expect(await setupStatus(testApp)).toEqual({ required: true, requiresToken: false });
  });

  it('lets exactly one of many concurrent setups succeed, without a token or ignoring one', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        // Half send a made-up token: it is ignored, not checked.
        postSetupTo(testApp, i % 2 === 0 ? undefined : 'x'.repeat(43), `owner${i}@example.com`),
      ),
    );
    await expectExactlyOneOwner(testApp, responses);
  });

  it('is dead once an owner exists', async () => {
    const response = await postSetupTo(testApp, undefined, 'late@example.com');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'SETUP_COMPLETE' } });
    expect(await setupStatus(testApp)).toEqual({ required: false, requiresToken: false });
  });

  it('logs nothing about setup when booting with an admin present', async () => {
    const capture = createLogCapture();
    const second = await createTestApp(database.current, { logger: capture.logger });
    await second.app.close();
    expect(capture.text()).not.toContain('No admin account');
  });
});

describe('first-run setup with SETUP_REQUIRE_TOKEN=true', () => {
  const database = useTestDatabase();
  const env = { SETUP_REQUIRE_TOKEN: 'true' };
  let testApp: TestApp;
  const logs = createLogCapture();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { logger: logs.logger, env });
  });
  afterAll(() => testApp.app.close());

  const postSetup = (token: string | undefined, email: string) => postSetupTo(testApp, token, email);

  it('logs a one-time token exactly once at boot while no admin exists', async () => {
    const matches = logs.lines.filter((line) => SETUP_TOKEN_LINE.test(line));
    expect(matches).toHaveLength(1);
    const token = SETUP_TOKEN_LINE.exec(matches[0] ?? '')?.[1] ?? '';
    // The token appears in that line only, and only its hash is stored.
    expect(logs.lines.filter((line) => line.includes(token))).toHaveLength(1);
    const stored = await testApp.db.selectFrom('setup_tokens').select('token_hash').execute();
    expect(stored.map((row) => row.token_hash)).toContain(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    expect(await setupStatus(testApp)).toEqual({ required: true, requiresToken: true });
  });

  it('rejects a missing token, a wrong token, and a token superseded by a later boot', async () => {
    const bootToken = SETUP_TOKEN_LINE.exec(logs.text())?.[1] ?? '';
    const missing = await postSetup(undefined, 'none@example.com');
    expect(missing.statusCode).toBe(403);
    expect(missing.json()).toMatchObject({ error: { code: 'INVALID_SETUP_TOKEN' } });
    const wrong = await postSetup('x'.repeat(43), 'wrong@example.com');
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toMatchObject({ error: { code: 'INVALID_SETUP_TOKEN' } });

    await issueSetupToken(testApp.db); // what a restart does
    const superseded = await postSetup(bootToken, 'old@example.com');
    expect(superseded.statusCode).toBe(403);
  });

  it('lets exactly one of many concurrent setups succeed', async () => {
    const token = await issueSetupToken(testApp.db);
    expect(token).toBeDefined();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => postSetup(token ?? '', `owner${i}@example.com`)),
    );
    await expectExactlyOneOwner(testApp, responses);
  });

  it('is dead once an owner exists: the used token, any leftover token, and new boots', async () => {
    const used = await testApp.db
      .selectFrom('setup_tokens')
      .select('used_at')
      .where('used_at', 'is not', null)
      .execute();
    expect(used).toHaveLength(1);
    // A token row that somehow survived (e.g. issued by another instance) still cannot be used.
    const leftover = 'L'.repeat(43);
    await testApp.db
      .insertInto('setup_tokens')
      .values({ token_hash: hashToken(leftover) })
      .execute();
    const response = await postSetup(leftover, 'late@example.com');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'SETUP_COMPLETE' } });

    expect(await issueSetupToken(testApp.db)).toBeUndefined();
    expect(await setupStatus(testApp)).toEqual({ required: false, requiresToken: true });
  });

  it('logs no setup token when booting with an admin present', async () => {
    const capture = createLogCapture();
    const second = await createTestApp(database.current, { logger: capture.logger, env });
    await second.app.close();
    expect(capture.text()).not.toMatch(SETUP_TOKEN_LINE);
  });
});
