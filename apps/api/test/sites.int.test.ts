import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { getRequestSite, MissingSiteDeclarationError } from '../src/plugins/siteResolution.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type SiteBody = { id: string; key: string; name: string; isPrimary: boolean; version: number };
type MeBody = {
  site: { key: string };
  sites: Array<{ key: string }>;
  networkPermissions: string[];
  sitePermissions: string[];
  globalPermissions: string[];
  modelPermissions: Record<string, string[]>;
};

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

/** A route that answers with the site the request resolved to (sites plan §H resolution order). */
const PROBE = '/api/test/site-probe';
const registerProbe = (app: FastifyInstance) => {
  app.get(PROBE, { config: { site: 'site' } }, async (request) => ({
    key: getRequestSite(request).key,
    principal: request.principal.kind,
  }));
};

describe('sites (plan §H, G1 foundation)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestSession;
  let other: SiteBody;

  const as = (session: TestSession, headers: Record<string, string> = {}) => ({
    get: (url: string) =>
      testApp.app.inject({ method: 'GET', url, headers: { ...session.headers, ...headers } }),
    post: (url: string, payload: unknown) =>
      testApp.app.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { ...session.headers, ...headers },
      }),
    patch: (url: string, payload: unknown) =>
      testApp.app.inject({
        method: 'PATCH',
        url,
        payload: payload as object,
        headers: { ...session.headers, ...headers },
      }),
    delete: (url: string) =>
      testApp.app.inject({ method: 'DELETE', url, headers: { ...session.headers, ...headers } }),
  });

  /** An admin whose only role is `roleKey`, assigned on `siteId` alone (not on every site). */
  const siteOnlyAdmin = async (roleKey: string, siteId: string) => {
    const admin = await createAdmin(database.current.db, { roleKeys: [] });
    const [role] = await adminRolesRepository.findByKeys([roleKey], database.current.db);
    await database.current.db
      .insertInto('admin_user_roles')
      .values({ admin_user_id: admin.id, role_id: role?.id ?? '', site_id: siteId })
      .execute();
    return login(testApp.app, admin);
  };

  const createToken = async (session: TestSession, body: Record<string, unknown>, headers = {}) =>
    as(session, headers).post('/api/admin/tokens', body);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { register: registerProbe });
    owner = await login(testApp.app, await createAdmin(database.current.db));
    const created = await as(owner).post('/api/admin/sites', { key: 'marketing', name: 'Marketing' });
    expect(created.statusCode).toBe(201);
    other = created.json<SiteBody>();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('CRUD', () => {
    it('lists the primary site first, then the others; gets one by ID', async () => {
      const list = await as(owner).get('/api/admin/sites');
      expect(list.statusCode).toBe(200);
      expect(list.json<SiteBody[]>().map((site) => [site.key, site.isPrimary])).toEqual([
        ['default', true],
        ['marketing', false],
      ]);
      const one = await as(owner).get(`/api/admin/sites/${other.id}`);
      expect(one.json<SiteBody>()).toMatchObject({ key: 'marketing', name: 'Marketing', version: 1 });
    });

    it('starts a new site with its own publication sequence at 0 and no app roles bound', async () => {
      const state = await database.current.db
        .selectFrom('publication_state')
        .select('last_seq')
        .where('site_id', '=', other.id)
        .executeTakeFirst();
      expect(state?.last_seq).toBe('0');
      const bindings = await database.current.db
        .selectFrom('site_app_roles')
        .selectAll()
        .where('site_id', '=', other.id)
        .execute();
      expect(bindings).toEqual([]);
      const primaryBindings = await database.current.db
        .selectFrom('site_app_roles')
        .select('audience')
        .where('site_id', '=', PRIMARY_SITE_ID)
        .orderBy('audience')
        .execute();
      expect(primaryBindings.map((row) => row.audience)).toEqual(['authenticated', 'public']);
    });

    it('refuses a taken key and an invalid key', async () => {
      const taken = await as(owner).post('/api/admin/sites', { key: 'marketing', name: 'Again' });
      expect(taken.statusCode).toBe(409);
      expect(codeOf(taken)).toBe('SITE_KEY_TAKEN');
      expect((await as(owner).post('/api/admin/sites', { key: 'Not Valid', name: 'x' })).statusCode).toBe(
        400,
      );
    });

    it('renames with the version guard; the key is fixed', async () => {
      const renamed = await as(owner).patch(`/api/admin/sites/${other.id}`, {
        expectedVersion: 1,
        name: 'Mktg',
      });
      expect(renamed.json<SiteBody>()).toMatchObject({ name: 'Mktg', version: 2, key: 'marketing' });
      const stale = await as(owner).patch(`/api/admin/sites/${other.id}`, {
        expectedVersion: 1,
        name: 'Stale',
      });
      expect(stale.statusCode).toBe(409);
      expect(codeOf(stale)).toBe('VERSION_CONFLICT');
      const withKey = await as(owner).patch(`/api/admin/sites/${other.id}`, {
        expectedVersion: 2,
        name: 'x',
        key: 'renamed',
      });
      expect(withKey.statusCode).toBe(400);
    });

    it('deletes only empty sites and never the primary one', async () => {
      const primary = await as(owner).delete(`/api/admin/sites/${PRIMARY_SITE_ID}`);
      expect(primary.statusCode).toBe(409);
      expect(codeOf(primary)).toBe('SITE_IS_PRIMARY');

      const doomed = (
        await as(owner).post('/api/admin/sites', { key: 'doomed', name: 'Doomed' })
      ).json<SiteBody>();
      await database.current.db
        .insertInto('media_folders')
        .values({ site_id: doomed.id, name: 'Keep me' })
        .execute();
      const notEmpty = await as(owner).delete(`/api/admin/sites/${doomed.id}`);
      expect(notEmpty.statusCode).toBe(409);
      expect(notEmpty.json()).toMatchObject({
        error: { code: 'SITE_NOT_EMPTY', details: { mediaFolders: 1, entries: 0 } },
      });
      await database.current.db.deleteFrom('media_folders').where('site_id', '=', doomed.id).execute();
      // Configuration goes with the site: a token and its publication state.
      expect(
        (
          await createToken(
            owner,
            { name: 'doomed', roleId: await deliveryRoleId() },
            { [SITE_HEADER]: 'doomed' },
          )
        ).statusCode,
      ).toBe(201);
      expect((await as(owner).delete(`/api/admin/sites/${doomed.id}`)).statusCode).toBe(204);
      expect((await as(owner).get(`/api/admin/sites/${doomed.id}`)).statusCode).toBe(404);
      const leftovers = await database.current.db
        .selectFrom('api_tokens')
        .select('id')
        .where('site_id', '=', doomed.id)
        .execute();
      expect(leftovers).toEqual([]);
      const audit = await database.current.db
        .selectFrom('audit_events')
        .select('action')
        .where('target_id', '=', doomed.id)
        .orderBy('occurred_at')
        .execute();
      expect(audit.map((row) => row.action)).toEqual(['site.create', 'site.delete']);
    });

    it('needs sites.manage to change sites; any admin lists only the sites they work on', async () => {
      const editor = await siteOnlyAdmin('editor', other.id);
      expect((await as(editor).post('/api/admin/sites', { key: 'nope', name: 'Nope' })).statusCode).toBe(403);
      const list = await as(editor).get('/api/admin/sites');
      expect(list.json<SiteBody[]>().map((site) => site.key)).toEqual(['marketing']);
      expect((await as(editor).get(`/api/admin/sites/${PRIMARY_SITE_ID}`)).statusCode).toBe(404);
    });
  });

  const deliveryRoleId = async () => {
    const existing = await database.current.db
      .selectFrom('admin_roles')
      .select('id')
      .where('key', '=', 'site-reader')
      .executeTakeFirst();
    if (existing) {
      return existing.id;
    }
    const created = await as(owner).post('/api/admin/roles', {
      key: 'site-reader',
      name: 'Site reader',
      kind: 'delivery',
      permissions: [{ action: 'read', modelId: null, condition: null, fieldIds: null }],
    });
    expect(created.statusCode).toBe(201);
    return created.json<{ id: string }>().id;
  };

  describe('resolution order: credential, then ?site= / Shapio-Site, then the primary site', () => {
    const probe = (headers: Record<string, string>, query = '') =>
      testApp.app.inject({ method: 'GET', url: `${PROBE}${query}`, headers });

    it('falls back to the primary site, and follows ?site= or the header for an anonymous caller', async () => {
      expect((await probe({})).json()).toEqual({ key: 'default', principal: 'anonymous' });
      expect((await probe({}, '?site=marketing')).json()).toMatchObject({ key: 'marketing' });
      expect((await probe({ [SITE_HEADER]: 'marketing' })).json()).toMatchObject({ key: 'marketing' });
    });

    it('answers 404 for an unknown site key and 403 when the header and ?site= disagree', async () => {
      const unknown = await probe({}, '?site=nowhere');
      expect(unknown.statusCode).toBe(404);
      expect(codeOf(unknown)).toBe('SITE_NOT_FOUND');
      const split = await probe({ [SITE_HEADER]: 'default' }, '?site=marketing');
      expect(split.statusCode).toBe(403);
      expect(codeOf(split)).toBe('SITE_MISMATCH');
    });

    it("uses a site token's site, and refuses a request naming another site (403 SITE_MISMATCH)", async () => {
      const created = await createToken(
        owner,
        { name: 'mkt site', roleId: await deliveryRoleId() },
        {
          [SITE_HEADER]: 'marketing',
        },
      );
      expect(created.statusCode).toBe(201);
      const { token, apiToken } = created.json<{ token: string; apiToken: { siteId: string | null } }>();
      expect(apiToken.siteId).toBe(other.id);
      const bearer = { authorization: `Bearer ${token}` };
      expect((await probe(bearer)).json()).toEqual({ key: 'marketing', principal: 'token' });
      expect((await probe(bearer, '?site=marketing')).statusCode).toBe(200);
      const mismatch = await probe(bearer, '?site=default');
      expect(mismatch.statusCode).toBe(403);
      expect(codeOf(mismatch)).toBe('SITE_MISMATCH');
      expect((await probe({ ...bearer, [SITE_HEADER]: 'default' })).statusCode).toBe(403);
    });

    it('lets a network admin token name any site', async () => {
      const [adminRole] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
      const created = await createToken(owner, { name: 'ci', roleId: adminRole?.id, network: true });
      const { token, apiToken } = created.json<{ token: string; apiToken: { siteId: string | null } }>();
      expect(apiToken.siteId).toBeNull();
      const bearer = { authorization: `Bearer ${token}` };
      expect((await probe(bearer)).json()).toMatchObject({ key: 'default' });
      expect((await probe(bearer, '?site=marketing')).json()).toMatchObject({ key: 'marketing' });
    });

    it("gives a token the request's site unless a network token is asked for", async () => {
      const [adminRole] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
      const created = await createToken(
        owner,
        { name: 'site ci', roleId: adminRole?.id },
        { [SITE_HEADER]: 'marketing' },
      );
      expect(created.statusCode).toBe(201);
      expect(created.json<{ apiToken: { siteId: string | null } }>().apiToken.siteId).toBe(other.id);
    });

    it("binds delivery tokens to the request's site and refuses network delivery tokens", async () => {
      const refused = await createToken(owner, { name: 'x', roleId: await deliveryRoleId(), network: true });
      expect(refused.statusCode).toBe(400);
      expect(codeOf(refused)).toBe('INVALID_TOKEN_SITE');
    });
  });

  describe('network and site permissions (privilege boundary)', () => {
    it('a site-only admin manages their site but never the network', async () => {
      const siteAdmin = await siteOnlyAdmin('admin', other.id);
      const onSite = as(siteAdmin, { [SITE_HEADER]: 'marketing' });
      // users.manage, roles.manage, audit.read and sites.manage are network actions.
      expect((await onSite.get('/api/admin/users')).statusCode).toBe(403);
      expect((await onSite.get('/api/admin/audit')).statusCode).toBe(403);
      expect(
        (await onSite.post('/api/admin/roles', { key: 'x', name: 'x', permissions: [] })).statusCode,
      ).toBe(403);
      // tokens.manage is a site action: allowed on their site, refused on another.
      expect((await onSite.get('/api/admin/tokens')).statusCode).toBe(200);
      expect((await as(siteAdmin, { [SITE_HEADER]: 'default' }).get('/api/admin/tokens')).statusCode).toBe(
        403,
      );
      // Their admin tokens are site tokens: they cannot mint a network token.
      const [adminRole] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
      const network = await onSite.post('/api/admin/tokens', {
        name: 'n',
        roleId: adminRole?.id,
        network: true,
      });
      expect(network.statusCode).toBe(403);
      const siteToken = await onSite.post('/api/admin/tokens', { name: 's', roleId: adminRole?.id });
      expect(siteToken.json<{ apiToken: { siteId: string } }>().apiToken.siteId).toBe(other.id);
    });

    it('me reports the request site, the sites worked on and the split permissions', async () => {
      const siteAdmin = await siteOnlyAdmin('admin', other.id);
      const onSite = (
        await as(siteAdmin, { [SITE_HEADER]: 'marketing' }).get('/api/admin/auth/me')
      ).json<MeBody>();
      expect(onSite.site.key).toBe('marketing');
      expect(onSite.sites.map((site) => site.key)).toEqual(['marketing']);
      expect(onSite.networkPermissions).toEqual([]);
      expect(onSite.sitePermissions).toContain('tokens.manage');
      expect(onSite.globalPermissions).toEqual(onSite.sitePermissions);
      const elsewhere = (
        await as(siteAdmin, { [SITE_HEADER]: 'default' }).get('/api/admin/auth/me')
      ).json<MeBody>();
      expect(elsewhere.site.key).toBe('default');
      expect(elsewhere.sitePermissions).toEqual([]);
      expect(elsewhere.modelPermissions).toEqual({});

      const ownerMe = (await as(owner).get('/api/admin/auth/me')).json<MeBody>();
      expect(ownerMe.site.key).toBe('default');
      expect(ownerMe.sites.map((site) => site.key)).toEqual(['default', 'marketing']);
      expect(ownerMe.networkPermissions).toEqual(
        expect.arrayContaining([
          'users.manage',
          'roles.manage',
          'audit.read',
          'schema.create',
          'sites.manage',
        ]),
      );
    });
  });

  describe('route declarations', () => {
    it('fails startup for an API route without a site declaration', async () => {
      const startup = createTestApp(database.current, {
        register: (app) => {
          app.get('/api/test/undeclared', async () => ({}));
        },
      });
      await expect(startup).rejects.toBeInstanceOf(MissingSiteDeclarationError);
    });

    it('accepts declared routes and ignores routes outside the API', async () => {
      const { app } = await createTestApp(database.current, {
        register: (instance) => {
          instance.get('/api/test/network', { config: { site: 'network' } }, async () => ({}));
          instance.get('/outside-the-api', async () => ({}));
        },
      });
      await app.close();
    });
  });
});
