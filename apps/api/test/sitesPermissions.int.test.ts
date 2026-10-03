import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { APP_ROLE_IDS } from '../src/permissions/appRoles.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { createAdmin, login, nextTestIp, type TestSession } from './helpers/adminIdentity.js';
import {
  APP_PASSWORD,
  bearer,
  registerAppUser,
  setPublicGrants,
  type AppSessionBody,
} from './helpers/appUsers.js';
import { createDefinition, createRole, expectStatus, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Assignment = { roleId: string; siteId: string | null };
type AdminUserBody = { id: string; assignments: Assignment[]; roleIds: string[] };
type MeBody = {
  site: { key: string };
  sites: Array<{ key: string }>;
  networkPermissions: string[];
  sitePermissions: string[];
  modelPermissions: Record<string, string[]>;
  user: AdminUserBody;
};
type BindingsBody = { siteId: string; public: string[]; authenticated: string[] };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

/**
 * Sites as a permission boundary (plan agentic-ecosystem §H, G3): role assignments per site, network vs site
 * actions, `me` per site, app users per site and the per-site `public`/`authenticated` bindings.
 */
describe('sites and permissions (plan §H, G3)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestSession;
  let network: SchemaClient;
  let marketingId: string;
  let article: ModelBody;
  const roleIds: Record<string, string> = {};

  const as = (session: TestSession, siteKey?: string) => {
    const headers = { ...session.headers, ...(siteKey ? { [SITE_HEADER]: siteKey } : {}) };
    return {
      get: (url: string) => testApp.app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'POST', url, payload: payload as object, headers }),
      patch: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'PATCH', url, payload: payload as object, headers }),
      put: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'PUT', url, payload: payload as object, headers }),
    };
  };

  /** A new admin (no roles), then the owner gives them exactly these assignments through the API. */
  const adminWith = async (assignments: Assignment[]) => {
    const admin = await createAdmin(database.current.db, { roleKeys: [] });
    expectStatus(await as(owner).patch(`/api/admin/users/${admin.id}`, { assignments }), 200);
    return login(testApp.app, admin);
  };

  const appAuth = (url: string, payload: unknown, siteKey?: string) =>
    testApp.app.inject({
      method: 'POST',
      url: `/api/app-auth/${url}`,
      remoteAddress: nextTestIp(),
      payload: payload as object,
      headers: siteKey ? { [SITE_HEADER]: siteKey } : {},
    });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    owner = await login(testApp.app, await createAdmin(database.current.db));
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const site = expectStatus(
      await as(owner).post('/api/admin/sites', { key: 'marketing', name: 'Marketing' }),
      201,
    );
    marketingId = site.json<{ id: string }>().id;
    for (const role of await adminRolesRepository.findByKeys(
      ['owner', 'admin', 'editor'],
      database.current.db,
    )) {
      roleIds[role.key] = role.id;
    }
    article = await createDefinition(network, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('role assignments', () => {
    it('stores assignments per site and reports them with the deprecated roleIds', async () => {
      const admin = await createAdmin(database.current.db, { roleKeys: [] });
      const assignments = [
        { roleId: roleIds.editor ?? '', siteId: marketingId },
        { roleId: roleIds.admin ?? '', siteId: PRIMARY_SITE_ID },
      ];
      const updated = expectStatus(
        await as(owner).patch(`/api/admin/users/${admin.id}`, { assignments }),
        200,
      ).json<AdminUserBody>();
      expect(updated.assignments).toEqual(expect.arrayContaining(assignments));
      expect(updated.assignments).toHaveLength(2);
      expect(updated.roleIds.sort()).toEqual([roleIds.admin, roleIds.editor].sort());

      // The deprecated form replaces every assignment with those roles on every site.
      const legacy = expectStatus(
        await as(owner).patch(`/api/admin/users/${admin.id}`, { roleIds: [roleIds.editor] }),
        200,
      ).json<AdminUserBody>();
      expect(legacy.assignments).toEqual([{ roleId: roleIds.editor, siteId: null }]);
    });

    it('refuses duplicates, unknown sites, the owner role on one site and both forms at once', async () => {
      const admin = await createAdmin(database.current.db, { roleKeys: [] });
      const patch = (body: unknown) => as(owner).patch(`/api/admin/users/${admin.id}`, body);
      const editorOnMarketing = { roleId: roleIds.editor, siteId: marketingId };
      expect(codeOf(await patch({ assignments: [editorOnMarketing, editorOnMarketing] }))).toBe(
        'DUPLICATE_ASSIGNMENT',
      );
      expect(
        codeOf(
          await patch({
            assignments: [{ roleId: roleIds.editor, siteId: '00000000-0000-4000-b000-0000000000ff' }],
          }),
        ),
      ).toBe('INVALID_SITES');
      expect(codeOf(await patch({ assignments: [{ roleId: roleIds.owner, siteId: marketingId }] }))).toBe(
        'OWNER_ALL_SITES',
      );
      expect(codeOf(await patch({ assignments: [editorOnMarketing], roleIds: [roleIds.editor] }))).toBe(
        'INVALID_ASSIGNMENTS',
      );
    });

    it('invites with assignments; the invitee gets exactly them on accepting', async () => {
      const assignments = [{ roleId: roleIds.editor, siteId: marketingId }];
      const invitation = expectStatus(
        await as(owner).post('/api/admin/invitations', { email: 'site-editor@example.com', assignments }),
        201,
      ).json<{ id: string; assignments: Assignment[]; roleIds: string[] }>();
      expect(invitation.assignments).toEqual(assignments);
      expect(invitation.roleIds).toEqual([roleIds.editor]);
      const { acceptUrl } = expectStatus(
        await as(owner).post(`/api/admin/invitations/${invitation.id}/link`, {}),
        200,
      ).json<{ acceptUrl: string }>();
      const token = decodeURIComponent(new URL(acceptUrl).hash.replace(/^#token=/, ''));
      const accepted = expectStatus(
        await testApp.app.inject({
          method: 'POST',
          url: '/api/admin/invitations/accept',
          remoteAddress: nextTestIp(),
          payload: { token, name: 'Site Editor', password: 'a long enough password 1' },
        }),
        201,
      ).json<{ user: AdminUserBody }>();
      expect(accepted.user.assignments).toEqual(assignments);
    });
  });

  describe('admin routes per site', () => {
    it('an editor of one site works there and is refused on another (403 SITE_FORBIDDEN)', async () => {
      const editor = await adminWith([{ roleId: roleIds.editor ?? '', siteId: marketingId }]);
      expectStatus(await as(editor, 'marketing').get('/api/admin/content/article'), 200);
      const elsewhere = await as(editor, 'default').get('/api/admin/content/article');
      expect(elsewhere.statusCode).toBe(403);
      expect(codeOf(elsewhere)).toBe('SITE_FORBIDDEN');
      // Admin routes default to the primary site: no header is the primary site too.
      expect(codeOf(await as(editor).get('/api/admin/content/article'))).toBe('SITE_FORBIDDEN');
    });

    it('a site editor mints a delivery token for its site only; it cannot read another site', async () => {
      // The built-in editor has no tokens.manage: a custom editor role that also manages tokens.
      const grant = (action: string) => ({ action, modelId: null, condition: null, fieldIds: null });
      const siteEditorRole = expectStatus(
        await as(owner).post('/api/admin/roles', {
          key: 'site-editor-tokens',
          name: 'Site editor with tokens',
          kind: 'admin',
          permissions: ['read', 'create', 'update', 'delete', 'publish', 'tokens.manage'].map(grant),
        }),
        201,
      ).json<{ id: string }>().id;
      const editor = await adminWith([{ roleId: siteEditorRole, siteId: marketingId }]);
      const deliveryRole = await createRole(database.current.db, 'delivery', [
        { action: 'read', modelId: article.definition.id },
      ]);
      const token = expectStatus(
        await as(editor, 'marketing').post('/api/admin/tokens', {
          name: 'marketing site',
          roleId: deliveryRole,
        }),
        201,
      ).json<{ token: string }>().token;
      const headers = { authorization: `Bearer ${token}` };

      expectStatus(
        await testApp.app.inject({ method: 'GET', url: '/api/content/articles?site=marketing', headers }),
        200,
      );
      const rest = await testApp.app.inject({
        method: 'GET',
        url: '/api/content/articles?site=default',
        headers,
      });
      expect(rest.statusCode).toBe(403);
      expect(codeOf(rest)).toBe('SITE_MISMATCH');
      const query = await graphql(testApp.app, '{ __typename }', {
        url: '/api/graphql?site=default',
        headers,
      });
      expect(query.statusCode).toBe(403);
      expect(query.body.errors?.[0]?.extensions?.code).toBe('SITE_MISMATCH');

      // The editor's admin session is refused on the other site as well.
      const adminList = await as(editor, 'default').get('/api/admin/content/article');
      expect(adminList.statusCode).toBe(403);
      expect(codeOf(adminList)).toBe('SITE_FORBIDDEN');
    });

    it('me answers on every site, with that site’s permissions and the sites the admin works on', async () => {
      const editor = await adminWith([{ roleId: roleIds.editor ?? '', siteId: marketingId }]);
      const onSite = expectStatus(
        await as(editor, 'marketing').get('/api/admin/auth/me'),
        200,
      ).json<MeBody>();
      expect(onSite.site.key).toBe('marketing');
      expect(onSite.sites.map((site) => site.key)).toEqual(['marketing']);
      expect(onSite.networkPermissions).toEqual([]);
      expect(onSite.sitePermissions).toEqual(expect.arrayContaining(['media.read', 'changes.manage']));
      expect(onSite.modelPermissions[article.definition.id]).toEqual(
        expect.arrayContaining(['read', 'create', 'update', 'delete', 'publish']),
      );
      expect(onSite.user.assignments).toEqual([{ roleId: roleIds.editor, siteId: marketingId }]);

      const elsewhere = expectStatus(
        await as(editor, 'default').get('/api/admin/auth/me'),
        200,
      ).json<MeBody>();
      expect(elsewhere.site.key).toBe('default');
      expect(elsewhere.sitePermissions).toEqual([]);
      expect(elsewhere.modelPermissions).toEqual({});
    });

    it('network actions need a role on every site: an admin of one site cannot reach them', async () => {
      const siteAdmin = await adminWith([{ roleId: roleIds.admin ?? '', siteId: marketingId }]);
      const onSite = as(siteAdmin, 'marketing');
      expect((await onSite.get('/api/admin/users')).statusCode).toBe(403);
      const newModel = {
        definition: { kind: 'collection', apiKey: 'nope', label: 'Nope', fields: [] },
      };
      expect((await onSite.post('/api/admin/models', newModel)).statusCode).toBe(403);
      expect(
        (await onSite.put(`/api/admin/sites/${marketingId}/app-roles`, { public: [], authenticated: [] }))
          .statusCode,
      ).toBe(403);
      // Their schema rights on the shared schema (schemaManage) need a network role too.
      const me = (await onSite.get('/api/admin/auth/me')).json<MeBody>();
      expect(me.modelPermissions[article.definition.id]).not.toContain('schemaManage');

      const networkAdmin = await adminWith([{ roleId: roleIds.admin ?? '', siteId: null }]);
      expectStatus(await as(networkAdmin, 'marketing').get('/api/admin/users'), 200);
    });

    it('lists and revokes only the site’s tokens; network tokens only for those who manage users', async () => {
      const siteAdmin = await adminWith([{ roleId: roleIds.admin ?? '', siteId: marketingId }]);
      const primaryToken = expectStatus(
        await as(owner, 'default').post('/api/admin/tokens', {
          name: 'primary',
          roleId: roleIds.editor,
          network: false,
        }),
        201,
      ).json<{ apiToken: { id: string } }>().apiToken;
      const networkToken = expectStatus(
        await as(owner, 'default').post('/api/admin/tokens', {
          name: 'network',
          roleId: roleIds.editor,
          network: true,
        }),
        201,
      ).json<{ apiToken: { id: string } }>().apiToken;
      const siteToken = expectStatus(
        await as(siteAdmin, 'marketing').post('/api/admin/tokens', {
          name: 'marketing',
          roleId: roleIds.editor,
        }),
        201,
      ).json<{ apiToken: { id: string } }>().apiToken;

      const listed = expectStatus(await as(siteAdmin, 'marketing').get('/api/admin/tokens'), 200)
        .json<Array<{ id: string }>>()
        .map((token) => token.id);
      expect(listed).toContain(siteToken.id);
      expect(listed).not.toContain(primaryToken.id);
      expect(listed).not.toContain(networkToken.id);
      const remove = (session: TestSession, siteKey: string, id: string) =>
        testApp.app.inject({
          method: 'DELETE',
          url: `/api/admin/tokens/${id}`,
          headers: { ...session.headers, [SITE_HEADER]: siteKey },
        });
      expect((await remove(siteAdmin, 'marketing', primaryToken.id)).statusCode).toBe(404);
      expect((await remove(siteAdmin, 'marketing', networkToken.id)).statusCode).toBe(404);
      expect((await remove(siteAdmin, 'marketing', siteToken.id)).statusCode).toBe(204);

      const ownerListed = expectStatus(await as(owner, 'marketing').get('/api/admin/tokens'), 200)
        .json<Array<{ id: string }>>()
        .map((token) => token.id);
      expect(ownerListed).toContain(networkToken.id);
      expect(ownerListed).not.toContain(primaryToken.id);
      expect((await remove(owner, 'marketing', networkToken.id)).statusCode).toBe(204);
    });
  });

  describe('app users per site', () => {
    const email = 'reader@example.com';
    let primary: AppSessionBody;
    let onMarketing: AppSessionBody;

    beforeAll(async () => {
      primary = expectStatus(await registerAppUser(testApp.app, { email }), 201).json<{
        session: AppSessionBody;
      }>().session;
      onMarketing = expectStatus(
        await appAuth('register', { email, password: APP_PASSWORD, name: 'M' }, 'marketing'),
        201,
      ).json<{ session: AppSessionBody }>().session;
    });

    it('keeps one account per site for the same address; signing in is per site', async () => {
      expect(onMarketing.user.id).not.toBe(primary.user.id);
      const signedIn = expectStatus(
        await appAuth('login', { email, password: APP_PASSWORD }, 'marketing'),
        200,
      );
      expect(signedIn.json<AppSessionBody>().user.id).toBe(onMarketing.user.id);
      const otherAddress = 'only-marketing@example.com';
      expectStatus(
        await appAuth('register', { email: otherAddress, password: APP_PASSWORD }, 'marketing'),
        201,
      );
      expect((await appAuth('login', { email: otherAddress, password: APP_PASSWORD })).statusCode).toBe(401);
    });

    it('refuses an access token or refresh token on another site (403 SITE_MISMATCH)', async () => {
      const me = (siteKey: string) =>
        testApp.app.inject({
          method: 'GET',
          url: '/api/app-auth/me',
          headers: { ...bearer(onMarketing.accessToken), [SITE_HEADER]: siteKey },
        });
      expect(expectStatus(await me('marketing'), 200).json<{ id: string }>().id).toBe(onMarketing.user.id);
      const elsewhere = await me('default');
      expect(elsewhere.statusCode).toBe(403);
      expect(codeOf(elsewhere)).toBe('SITE_MISMATCH');

      const wrongSite = await appAuth('refresh', { refreshToken: onMarketing.refreshToken });
      expect(codeOf(wrongSite)).toBe('SITE_MISMATCH');
      // Refused without rotating: the token still works on its own site.
      expectStatus(await appAuth('refresh', { refreshToken: onMarketing.refreshToken }, 'marketing'), 200);
    });

    it('scopes Users → App users to the request’s site', async () => {
      const listed = expectStatus(await as(owner, 'marketing').get('/api/admin/app-users'), 200)
        .json<{ items: Array<{ id: string }> }>()
        .items.map((user) => user.id);
      expect(listed).toContain(onMarketing.user.id);
      expect(listed).not.toContain(primary.user.id);
      expect((await as(owner, 'marketing').get(`/api/admin/app-users/${primary.user.id}`)).statusCode).toBe(
        404,
      );
      expect(
        (await as(owner, 'marketing').patch(`/api/admin/app-users/${primary.user.id}`, { blocked: true }))
          .statusCode,
      ).toBe(404);
    });
  });

  describe('site app roles (public / authenticated bindings)', () => {
    it('binds the built-in roles on the primary site and nothing on a new site', async () => {
      expect(
        expectStatus(await as(owner).get(`/api/admin/sites/${PRIMARY_SITE_ID}/app-roles`), 200).json(),
      ).toEqual({
        siteId: PRIMARY_SITE_ID,
        public: [APP_ROLE_IDS.public],
        authenticated: [APP_ROLE_IDS.authenticated],
      });
      expect(
        expectStatus(await as(owner).get(`/api/admin/sites/${marketingId}/app-roles`), 200).json(),
      ).toEqual({
        siteId: marketingId,
        public: [],
        authenticated: [],
      });
    });

    it('denies anonymous reads on a site that binds nothing, until `public` is bound there', async () => {
      await setPublicGrants(database.current.db, [{ action: 'read', modelId: null }]);
      const read = (siteKey: string) =>
        testApp.app.inject({
          method: 'GET',
          url: '/api/content/articles',
          headers: { [SITE_HEADER]: siteKey },
        });
      expectStatus(await read('default'), 200);
      // Anonymous and denied: 401, as on any site that grants anonymous callers nothing.
      expect((await read('marketing')).statusCode).toBe(401);

      const bound = expectStatus(
        await as(owner).put(`/api/admin/sites/${marketingId}/app-roles`, {
          public: [APP_ROLE_IDS.public],
          authenticated: [],
        }),
        200,
      ).json<BindingsBody>();
      expect(bound.public).toEqual([APP_ROLE_IDS.public]);
      expectStatus(await read('marketing'), 200);

      expectStatus(
        await as(owner).put(`/api/admin/sites/${marketingId}/app-roles`, { public: [], authenticated: [] }),
        200,
      );
      expect((await read('marketing')).statusCode).toBe(401);
    });

    it('refuses unknown roles and unknown sites', async () => {
      const unknown = '00000000-0000-4000-a000-0000000000ff';
      expect(
        codeOf(
          await as(owner).put(`/api/admin/sites/${marketingId}/app-roles`, {
            public: [unknown],
            authenticated: [],
          }),
        ),
      ).toBe('INVALID_ROLES');
      expect(
        (await as(owner).put(`/api/admin/sites/${unknown}/app-roles`, { public: [], authenticated: [] }))
          .statusCode,
      ).toBe(404);
    });
  });
});
