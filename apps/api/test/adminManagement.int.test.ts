import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { createPermissionCache } from '../src/permissions/cache.js';
import { createPermissionEvaluator } from '../src/permissions/evaluator.js';
import { createStaticFieldVisibility, NO_FIELD_VISIBILITY } from '../src/permissions/policy.js';
import type { Principal } from '../src/permissions/types.js';
import { MissingAuditDeclarationError } from '../src/plugins/auditDeclaration.js';
import { createAdmin, login, type TestAdmin, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type RoleBody = { id: string; key: string; version: number; isSystem: boolean };

describe('roles, admin users, API tokens and the audit log', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestAdmin;
  let ownerSession: TestSession;
  const roleIdByKey = new Map<string, string>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      fieldVisibility: createStaticFieldVisibility({
        'model-page': [
          { id: 'f-title', public: true },
          { id: 'f-secret', public: false },
        ],
      }),
    });
    owner = await createAdmin(testApp.db);
    ownerSession = await login(testApp.app, owner);
    for (const role of await testApp.db.selectFrom('admin_roles').select(['id', 'key']).execute()) {
      roleIdByKey.set(role.key, role.id);
    }
  });
  afterAll(() => testApp.app.close());

  const permissionsVersion = async () =>
    (await testApp.db.selectFrom('system_versions').select('permissions_version').executeTakeFirstOrThrow())
      .permissions_version;

  const api = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    session: TestSession,
    payload?: object,
  ) => testApp.app.inject({ method, url, headers: session.headers, ...(payload ? { payload } : {}) });

  it('seeds the built-in roles, which cannot be edited or deleted', async () => {
    const roles = (await api('GET', '/api/admin/roles', ownerSession)).json<RoleBody[]>();
    expect(
      roles
        .filter((r) => r.isSystem)
        .map((r) => r.key)
        .sort(),
    ).toEqual(['admin', 'editor', 'owner', 'read-only']);
    const ownerRole = roles.find((r) => r.key === 'owner');
    const edit = await api('PATCH', `/api/admin/roles/${ownerRole?.id}`, ownerSession, {
      expectedVersion: 1,
      name: 'x',
    });
    expect(edit.statusCode).toBe(409);
    expect((await api('DELETE', `/api/admin/roles/${ownerRole?.id}`, ownerSession)).statusCode).toBe(409);
  });

  it('creates custom roles whose grants reach the evaluator at once (cache invalidated by version)', async () => {
    const before = await permissionsVersion();
    const created = await api('POST', '/api/admin/roles', ownerSession, {
      key: 'page-writer',
      name: 'Page writer',
      permissions: [
        { action: 'read', modelId: 'model-page', condition: null, fieldIds: null },
        { action: 'update', modelId: 'model-page', condition: 'ownedByPrincipal', fieldIds: ['f-title'] },
      ],
    });
    expect(created.statusCode).toBe(201);
    const role = created.json<RoleBody>();
    expect(await permissionsVersion()).toBe(before + 1);
    roleIdByKey.set(role.key, role.id);

    const principal: Principal = testApp.principalFactory.admin({
      adminUserId: owner.id,
      roleIds: [role.id],
    });
    expect(
      await testApp.app.permissions.evaluate(principal, { action: 'update', modelId: 'model-page' }),
    ).toEqual({
      allowed: true,
      rowFilter: { kind: 'ownedByPrincipal' },
      readMask: { mode: 'all' },
      writeMask: { mode: 'only', fieldIds: ['f-title'] },
    });
    expect(
      (await testApp.app.permissions.evaluate(principal, { action: 'delete', modelId: 'model-page' }))
        .allowed,
    ).toBe(false);

    const stale = await api('PATCH', `/api/admin/roles/${role.id}`, ownerSession, {
      expectedVersion: 99,
      name: 'Stale',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });

    const updated = await api('PATCH', `/api/admin/roles/${role.id}`, ownerSession, {
      expectedVersion: role.version,
      permissions: [{ action: 'read', modelId: 'model-page', condition: null, fieldIds: null }],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ version: role.version + 1 });
    expect(
      (await testApp.app.permissions.evaluate(principal, { action: 'update', modelId: 'model-page' }))
        .allowed,
    ).toBe(false);
  });

  it('invalidates the cache of a second instance through the durable permissions version', async () => {
    // An evaluator with its own cache stands in for another server process on the same database.
    const other = createPermissionEvaluator({
      grants: createPermissionCache(testApp.db),
      fields: NO_FIELD_VISIBILITY,
    });
    const created = await api('POST', '/api/admin/roles', ownerSession, {
      key: 'schema-creator',
      name: 'Schema creator',
      permissions: [],
    });
    const role = created.json<RoleBody>();
    const principal: Principal = testApp.principalFactory.admin({
      adminUserId: owner.id,
      roleIds: [role.id],
    });
    expect(await other.canPerform(principal, 'schema.create')).toBe(false);
    await api('PATCH', `/api/admin/roles/${role.id}`, ownerSession, {
      expectedVersion: role.version,
      permissions: [{ action: 'schema.create', modelId: null, condition: null, fieldIds: null }],
    });
    expect(await other.canPerform(principal, 'schema.create')).toBe(true);
    await api('DELETE', `/api/admin/roles/${role.id}`, ownerSession);
    expect(await other.canPerform(principal, 'schema.create')).toBe(false);
  });

  it('fails startup when an admin route declares no audit policy', async () => {
    const startup = createTestApp(database.current, {
      register: (app) => {
        app.post('/api/admin/unaudited', async () => ({}));
      },
    });
    await expect(startup).rejects.toBeInstanceOf(MissingAuditDeclarationError);
  });

  it('rejects grants on models the schema does not know', async () => {
    // Without a schema registry wired in, no model exists.
    const bare = await createTestApp(database.current);
    const session = await login(bare.app, owner);
    const response = await bare.app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: session.headers,
      payload: {
        key: 'ghost-reader',
        name: 'Ghost reader',
        permissions: [
          { action: 'read', modelId: 'model-ghost', condition: null, fieldIds: null },
          { action: 'read', modelId: null, condition: null, fieldIds: null },
        ],
      },
    });
    await bare.app.close();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'UNKNOWN_MODEL', details: { modelIds: ['model-ghost'] } },
    });
    const allModels = await api('POST', '/api/admin/roles', ownerSession, {
      key: 'all-reader',
      name: 'All reader',
      permissions: [{ action: 'read', modelId: null, condition: null, fieldIds: null }],
    });
    expect(allModels.statusCode).toBe(201);
  });

  it('validates grants on the server', async () => {
    const cases = [
      {
        key: 'bad-global',
        permissions: [{ action: 'schema.create', modelId: 'm', condition: null, fieldIds: null }],
      },
      {
        key: 'bad-delivery',
        kind: 'delivery',
        permissions: [{ action: 'update', modelId: null, condition: null, fieldIds: null }],
      },
      {
        key: 'bad-dup',
        permissions: [
          { action: 'read', modelId: null, condition: null, fieldIds: null },
          { action: 'read', modelId: null, condition: null, fieldIds: ['a'] },
        ],
      },
    ];
    for (const body of cases) {
      const response = await api('POST', '/api/admin/roles', ownerSession, { name: 'Bad', ...body });
      expect(response.statusCode).toBe(400);
    }
    const unknownAction = await api('POST', '/api/admin/roles', ownerSession, {
      key: 'bad-action',
      name: 'Bad',
      permissions: [{ action: 'launchMissiles', modelId: null, condition: null, fieldIds: null }],
    });
    expect(unknownAction.statusCode).toBe(400);
  });

  it('enforces users.manage, owner protection and the last owner', async () => {
    const editor = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    const editorSession = await login(testApp.app, editor);
    expect((await api('GET', '/api/admin/users', editorSession)).statusCode).toBe(403);
    expect((await testApp.app.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(401);

    const admin = await createAdmin(testApp.db, { roleKeys: ['admin'] });
    const adminSession = await login(testApp.app, admin);
    expect((await api('GET', '/api/admin/users', adminSession)).statusCode).toBe(200);
    const promote = await api('PATCH', `/api/admin/users/${editor.id}`, adminSession, {
      roleIds: [roleIdByKey.get('owner')],
    });
    expect(promote.statusCode).toBe(403);
    expect(
      (await api('PATCH', `/api/admin/users/${owner.id}`, adminSession, { name: 'Hijacked' })).statusCode,
    ).toBe(403);

    const demoteLast = await api('PATCH', `/api/admin/users/${owner.id}`, ownerSession, {
      roleIds: [roleIdByKey.get('admin')],
    });
    expect(demoteLast.statusCode).toBe(409);
    expect(demoteLast.json()).toMatchObject({ error: { code: 'LAST_OWNER' } });
    expect((await api('DELETE', `/api/admin/users/${owner.id}`, ownerSession)).statusCode).toBe(409);

    // With a second owner the first may step down.
    const promoteEditor = await api('PATCH', `/api/admin/users/${editor.id}`, ownerSession, {
      roleIds: [roleIdByKey.get('owner')],
    });
    expect(promoteEditor.statusCode).toBe(200);
    const deleteEditor = await api('DELETE', `/api/admin/users/${editor.id}`, ownerSession);
    expect(deleteEditor.statusCode).toBe(204);
  });

  it('refuses to delete a role still held by someone', async () => {
    const holder = await createAdmin(testApp.db, { roleKeys: ['page-writer'] });
    const response = await api('DELETE', `/api/admin/roles/${roleIdByKey.get('page-writer')}`, ownerSession);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'ROLE_IN_USE' } });
    await api('DELETE', `/api/admin/users/${holder.id}`, ownerSession);
    expect(
      (await api('DELETE', `/api/admin/roles/${roleIdByKey.get('page-writer')}`, ownerSession)).statusCode,
    ).toBe(204);
  });

  it('creates API tokens shown once, hashed at rest, usable as bearer, revocable and expiring', async () => {
    const created = await api('POST', '/api/admin/tokens', ownerSession, {
      name: 'CI schema sync',
      roleId: roleIdByKey.get('admin'),
    });
    expect(created.statusCode).toBe(201);
    const { token, apiToken } = created.json<{
      token: string;
      apiToken: { id: string; tokenPrefix: string; scope: string };
    }>();
    expect(token).toMatch(/^shp_[A-Za-z0-9_-]{43}$/);
    expect(apiToken).toMatchObject({ tokenPrefix: token.slice(0, 10), scope: 'admin' });
    const listed = await api('GET', '/api/admin/tokens', ownerSession);
    expect(listed.body).not.toContain(token);
    const stored = JSON.stringify(await testApp.db.selectFrom('api_tokens').selectAll().execute());
    expect(stored).not.toContain(token);

    const bearer = { authorization: `Bearer ${token}` };
    const roles = await testApp.app.inject({ method: 'GET', url: '/api/admin/roles', headers: bearer });
    expect(roles.statusCode).toBe(200);
    // Bearer requests carry no ambient credentials, so no CSRF header is needed.
    const viaToken = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/tokens',
      headers: bearer,
      payload: { name: 'made by a token', roleId: roleIdByKey.get('read-only') },
    });
    expect(viaToken.statusCode).toBe(201);
    // Tokens have no session: /me and session routes stay closed.
    expect(
      (await testApp.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: bearer })).statusCode,
    ).toBe(401);
    const used = await testApp.db
      .selectFrom('api_tokens')
      .select('last_used_at')
      .where('id', '=', apiToken.id)
      .executeTakeFirstOrThrow();
    expect(used.last_used_at).not.toBeNull();

    expect((await api('DELETE', `/api/admin/tokens/${apiToken.id}`, ownerSession)).statusCode).toBe(204);
    const revoked = await testApp.app.inject({ method: 'GET', url: '/api/admin/roles', headers: bearer });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toMatchObject({ error: { code: 'INVALID_TOKEN' } });

    const expiring = await api('POST', '/api/admin/tokens', ownerSession, {
      name: 'short-lived',
      roleId: roleIdByKey.get('read-only'),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const short = expiring.json<{ token: string; apiToken: { id: string } }>();
    await testApp.db
      .updateTable('api_tokens')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', short.apiToken.id)
      .execute();
    const expired = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { authorization: `Bearer ${short.token}` },
    });
    expect(expired.statusCode).toBe(401);

    const ownerToken = await api('POST', '/api/admin/tokens', ownerSession, {
      name: 'x',
      roleId: roleIdByKey.get('owner'),
    });
    expect(ownerToken.statusCode).toBe(400);
  });

  it('gives delivery tokens read-only, public-field access and no admin API', async () => {
    const role = await api('POST', '/api/admin/roles', ownerSession, {
      key: 'website',
      name: 'Website',
      kind: 'delivery',
      permissions: [{ action: 'read', modelId: null, condition: null, fieldIds: null }],
    });
    expect(role.statusCode).toBe(201);
    const created = await api('POST', '/api/admin/tokens', ownerSession, {
      name: 'site',
      roleId: role.json<RoleBody>().id,
    });
    const { token, apiToken } = created.json<{ token: string; apiToken: { id: string; scope: string } }>();
    expect(apiToken.scope).toBe('delivery');
    const admin = await testApp.app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(admin.statusCode).toBe(403);
    const principal: Principal = {
      kind: 'token',
      tokenId: apiToken.id,
      scope: 'delivery',
      roleId: role.json<RoleBody>().id,
      siteId: PRIMARY_SITE_ID,
    };
    expect(
      await testApp.app.permissions.evaluate(principal, { action: 'read', modelId: 'model-page' }),
    ).toMatchObject({
      allowed: true,
      readMask: { mode: 'only', fieldIds: ['f-title'] },
    });
  });

  it('lists the audit log newest first, filtered, with a cursor that neither skips nor repeats', async () => {
    const forbidden = await testApp.app.inject({ method: 'GET', url: '/api/admin/audit' });
    expect(forbidden.statusCode).toBe(401);
    const all: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { id: string; action: string }[]; nextCursor: string | null } = (
        await api('GET', `/api/admin/audit?limit=3${cursor ? `&cursor=${cursor}` : ''}`, ownerSession)
      ).json();
      all.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    const total = await testApp.db.selectFrom('audit_events').select('id').execute();
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(total.length);

    const roleEvents = await api('GET', '/api/admin/audit?actionPrefix=role', ownerSession);
    const actions = roleEvents.json<{ items: { action: string }[] }>().items.map((item) => item.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.startsWith('role.'))).toBe(true);
    expect((await api('GET', '/api/admin/audit?cursor=garbage', ownerSession)).statusCode).toBe(400);
  });

  it('names admin and token actors in audit events, and leaves others unnamed', async () => {
    type AuditItem = {
      actorType: string;
      actorId: string | null;
      actorName: string | null;
      actorEmail: string | null;
    };
    const items = async (query: string) =>
      (await api('GET', `/api/admin/audit?limit=200&${query}`, ownerSession)).json<{ items: AuditItem[] }>()
        .items;

    const byOwner = await items(`actorType=admin&actorId=${owner.id}`);
    expect(byOwner.length).toBeGreaterThan(0);
    expect(byOwner.every((i) => i.actorName === 'Test Admin' && i.actorEmail === owner.email)).toBe(true);

    // The token named "CI schema sync" created another token earlier in this file.
    const byToken = await items('actorType=token');
    expect(byToken.length).toBeGreaterThan(0);
    expect(byToken.every((i) => i.actorName === 'CI schema sync' && i.actorEmail === null)).toBe(true);

    await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: { email: 'nobody@example.com', password: 'not a password' },
    });
    const anonymous = await items('actorType=anonymous');
    expect(anonymous.length).toBeGreaterThan(0);
    expect(anonymous.every((i) => i.actorName === null && i.actorEmail === null)).toBe(true);

    // A deleted admin's events stay, without a name.
    const temp = await createAdmin(testApp.db, { roleKeys: ['editor'] });
    await login(testApp.app, temp);
    await api('DELETE', `/api/admin/users/${temp.id}`, ownerSession);
    const orphaned = await items(`actorType=admin&actorId=${temp.id}`);
    expect(orphaned.length).toBeGreaterThan(0);
    expect(orphaned.every((i) => i.actorName === null && i.actorEmail === null)).toBe(true);
  });
});
