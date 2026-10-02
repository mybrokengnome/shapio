import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROLE_IDS } from '../src/permissions/appRoles.js';
import { createAppRole, signUp } from './helpers/appUsers.js';
import { createDefinition, expectStatus, fieldIdOf, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type AppUserPage = {
  items: Array<{ id: string; email: string; roleIds: string[]; blocked: boolean }>;
  nextCursor: string | null;
};
type AppRole = {
  id: string;
  key: string;
  isSystem: boolean;
  version: number;
  userCount: number;
  permissions: Array<Record<string, unknown>>;
};

/** Users → App users and Settings → Roles → App roles, through the admin API (package I). */
describe('admin management of app users and app roles', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let editor: SchemaClient;
  let doc: ModelBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    doc = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'doc',
      label: 'Doc',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const patch = (client: SchemaClient, url: string, payload: unknown) =>
    client.request({ method: 'PATCH', url, payload: payload as Record<string, unknown> });

  it('lists, searches and pages app users; managing them needs users.manage', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      await signUp(testApp.app, { email: `${name}@list.example.com` });
    }
    const first = expectStatus(
      await admin.get('/api/admin/app-users?limit=2&search=LIST.example'),
      200,
    ).json<AppUserPage>();
    expect(first.items.map((user) => user.email)).toEqual([
      'gamma@list.example.com',
      'beta@list.example.com',
    ]);
    const second = expectStatus(
      await admin.get(`/api/admin/app-users?limit=2&search=list.example&cursor=${first.nextCursor ?? ''}`),
      200,
    ).json<AppUserPage>();
    expect(second).toEqual({
      items: [expect.objectContaining({ email: 'alpha@list.example.com' })],
      nextCursor: null,
    });
    expect((await admin.get('/api/admin/app-users?cursor=garbage')).statusCode).toBe(400);
    expect((await editor.get('/api/admin/app-users')).statusCode).toBe(403);
  });

  it('assigns custom roles only, and audits the change', async () => {
    const { user } = await signUp(testApp.app);
    const roleId = await createAppRole(database.current.db, [{ action: 'read', modelId: doc.definition.id }]);
    const url = `/api/admin/app-users/${user.id}`;
    expect((await patch(admin, url, { roleIds: [APP_ROLE_IDS.authenticated] })).statusCode).toBe(400);
    expect((await patch(admin, url, { roleIds: ['00000000-0000-4000-8000-00000000dead'] })).statusCode).toBe(
      400,
    );
    expect(expectStatus(await patch(admin, url, { roleIds: [roleId] }), 200).json()).toMatchObject({
      roleIds: [roleId],
    });
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'app_user.roles_change')
      .where('target_id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(audit.metadata).toEqual({ before: [], after: [roleId] });
    expect((await patch(editor, url, { blocked: true })).statusCode).toBe(403);
  });

  it('resends confirmation only when configured, and deletes accounts', async () => {
    const { user } = await signUp(testApp.app);
    const resend = await admin.post(`/api/admin/app-users/${user.id}/resend-confirmation`, {});
    expect(resend.json()).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    expectStatus(await admin.delete(`/api/admin/app-users/${user.id}`), 204);
    expect((await admin.get(`/api/admin/app-users/${user.id}`)).statusCode).toBe(404);
    expect((await admin.delete(`/api/admin/app-users/${user.id}`)).statusCode).toBe(404);
  });

  it('manages app roles: built-ins keep their identity, grants are validated, holders protect deletion', async () => {
    const roles = expectStatus(await editor.get('/api/admin/app-roles'), 200).json<AppRole[]>();
    const authenticated = roles.find((role) => role.key === 'authenticated');
    expect(
      roles
        .filter((role) => role.isSystem)
        .map((role) => role.key)
        .sort(),
    ).toEqual(['authenticated', 'public']);
    // Deny by default (brief §8): neither built-in role grants anything until an admin enables it.
    expect(authenticated?.permissions).toEqual([]);
    expect(roles.find((role) => role.key === 'public')?.permissions).toEqual([]);

    const publicRole = roles.find((role) => role.key === 'public');
    const publicUrl = `/api/admin/app-roles/${publicRole?.id ?? ''}`;
    expect(
      (await patch(admin, publicUrl, { expectedVersion: publicRole?.version, name: 'Everyone' })).statusCode,
    ).toBe(409);
    const grants = [
      { action: 'read', modelId: doc.definition.id, condition: null, fieldIds: [fieldIdOf(doc, 'title')] },
    ];
    const updated = expectStatus(
      await patch(admin, publicUrl, { expectedVersion: publicRole?.version, permissions: grants }),
      200,
    ).json<AppRole>();
    expect(updated.permissions).toEqual(grants);
    expect(
      (await patch(admin, publicUrl, { expectedVersion: publicRole?.version, permissions: [] })).json(),
    ).toMatchObject({
      error: { code: 'VERSION_CONFLICT' },
    });
    expect(
      (await patch(editor, publicUrl, { expectedVersion: updated.version, permissions: [] })).statusCode,
    ).toBe(403);
    expect((await admin.delete(publicUrl)).json()).toMatchObject({ error: { code: 'SYSTEM_ROLE' } });

    const invalid = [
      [{ action: 'schemaManage', modelId: null, condition: null, fieldIds: null }],
      [{ action: 'users.manage', modelId: null, condition: null, fieldIds: null }],
      [{ action: 'delete', modelId: null, condition: null, fieldIds: ['x'] }],
      [{ action: 'read', modelId: 'no-such-model', condition: null, fieldIds: null }],
    ];
    for (const permissions of invalid) {
      const response = await admin.post('/api/admin/app-roles', { key: 'bad', name: 'Bad', permissions });
      expect(response.statusCode, JSON.stringify(permissions)).toBe(400);
    }

    const created = expectStatus(
      await admin.post('/api/admin/app-roles', {
        key: 'members',
        name: 'Members',
        permissions: [
          { action: 'create', modelId: doc.definition.id, condition: null, fieldIds: null },
          { action: 'update', modelId: doc.definition.id, condition: 'ownedByPrincipal', fieldIds: null },
        ],
      }),
      201,
    ).json<AppRole>();
    expect(
      (await admin.post('/api/admin/app-roles', { key: 'members', name: 'Again', permissions: [] }))
        .statusCode,
    ).toBe(409);
    const { user } = await signUp(testApp.app);
    expectStatus(await patch(admin, `/api/admin/app-users/${user.id}`, { roleIds: [created.id] }), 200);
    expect((await admin.get(`/api/admin/app-roles/${created.id}`)).json()).toMatchObject({ userCount: 1 });
    expect((await admin.delete(`/api/admin/app-roles/${created.id}`)).json()).toMatchObject({
      error: { code: 'ROLE_IN_USE' },
    });
    expectStatus(await patch(admin, `/api/admin/app-users/${user.id}`, { roleIds: [] }), 200);
    expectStatus(await admin.delete(`/api/admin/app-roles/${created.id}`), 204);
    const actions = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('action', 'like', 'app_role.%')
      .execute();
    expect(actions.map((row) => row.action).sort()).toEqual([
      'app_role.create',
      'app_role.delete',
      'app_role.update',
    ]);
  });
});
