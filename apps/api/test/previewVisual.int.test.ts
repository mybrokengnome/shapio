import { resolve } from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const ADMIN_FIXTURE = resolve(import.meta.dirname, 'fixtures/admin-dist-importmap');
const PUBLIC_URL = 'https://cms.example.com';
const SITE = 'https://site.example.test';

type Opened = { id: string; url: string; token: string; expiresAt: string };
type Target = { connectionId: string; name: string; origin: string | null; framable: boolean };

/** Visual editing's server side: the admin's frame-src, the preview targets and the token refresh. */
describe('preview frames and targets', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let session: TestSession;
  let entry: EntryBody;

  const asAdmin = (options: InjectOptions) =>
    testApp.app.inject({ ...options, headers: { ...session.headers, ...options.headers } });
  const connect = (name: string, previewUrlTemplate: string) =>
    admin.post('/api/admin/deployments/connections', {
      name,
      provider: 'generic_webhook',
      settings: { url: 'https://build.example.test/hook' },
      secrets: {},
      triggerPolicy: [],
      previewUrlTemplate,
    });
  const open = async () =>
    expectStatus(
      await asAdmin({
        method: 'POST',
        url: '/api/admin/preview/open',
        payload: { modelKey: 'article', entryId: entry.id },
      }),
      200,
    ).json<Opened>();
  const readPreview = (token: string) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/preview/content/articles/${entry.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      env: { PUBLIC_URL },
      adminDistPath: ADMIN_FIXTURE,
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    session = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['editor'] }));
    entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Draft' } }),
      201,
    ).json<EntryBody>();
  });
  afterAll(() => testApp.app.close());

  it("refuses a preview URL template on Shapio's own origin when it is saved", async () => {
    const response = await connect('Self', `${PUBLIC_URL}/preview/{path}#token={token}`);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toContain("Shapio's own origin");
  });

  it('frames exactly the playground and the fixed preview origins, never its own origin', async () => {
    expectStatus(await connect('Site', `${SITE}/preview/?id={entryId}#token={token}`), 201);
    expectStatus(await connect('Legacy', 'https://legacy.example.test/{path}?token={token}'), 201);
    // A row written before the save-time check (or by hand) is still never framed.
    await database.current.db
      .updateTable('deployment_connections')
      .set({ preview_url_template: `${PUBLIC_URL}/old/{path}?token={token}` })
      .where('name', '=', 'Legacy')
      .execute();
    expectStatus(await connect('Per locale', 'https://{locale}.example.test/{path}?token={token}'), 201);

    const response = await testApp.app.inject({ method: 'GET', url: '/admin/' });
    expect(response.statusCode).toBe(200);
    const csp = String(response.headers['content-security-policy']);
    const frameSrc = csp.split(';').find((directive) => directive.startsWith('frame-src'));
    expect(frameSrc).toBe(`frame-src ${PUBLIC_URL}/api/graphql/playground ${SITE}`);
    // The admin itself is framed only by itself (the playground), as before.
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('lists the preview targets for any admin, with origins and whether they can be framed', async () => {
    const targets = expectStatus(
      await asAdmin({ method: 'GET', url: '/api/admin/preview/targets' }),
      200,
    ).json<Target[]>();
    expect(targets.map(({ name, origin, framable }) => ({ name, origin, framable }))).toEqual([
      { name: 'Site', origin: SITE, framable: true },
      { name: 'Legacy', origin: PUBLIC_URL, framable: false },
      { name: 'Per locale', origin: null, framable: false },
    ]);
    expect(JSON.stringify(targets)).not.toContain('{token}');
  });

  it('refreshes by opening again and revoking the token it replaces', async () => {
    const first = await open();
    expect(first.url.startsWith(`${SITE}/preview/?id=${entry.id}#token=`)).toBe(true);
    expect(new Date(first.expiresAt).getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);
    const second = await open();
    expect(second.id).not.toBe(first.id);
    expect(
      (await asAdmin({ method: 'DELETE', url: `/api/admin/preview/tokens/${first.id}` })).statusCode,
    ).toBe(204);
    expect((await readPreview(first.token)).statusCode).toBe(401);
    expect((await readPreview(second.token)).statusCode).toBe(200);
  });
});
