import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRequestSite } from '../src/plugins/siteResolution.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { setPublicGrants } from './helpers/appUsers.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { GRAPHQL_ENV } from './helpers/graphql.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type SiteBody = { id: string; key: string; name: string; isPrimary: boolean; version: number };
type OpenApiOperation = { operationId: string; tags: string[]; deprecated?: boolean };
type OpenApi = {
  paths: Record<string, { get: OpenApiOperation }>;
  tags: Array<{ name: string }>;
};

const WORKSPACE = 'shapio-workspace';
const SITE = 'shapio-site';

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

/** A route that answers with the workspace the request resolved to. */
const PROBE = '/api/test/workspace-probe';
const registerProbe = (app: FastifyInstance) => {
  app.get(PROBE, { config: { site: 'site' } }, async (request) => ({ key: getRequestSite(request).key }));
};

/**
 * Workspace rename (plan workspace-rename, WP1): every way a request names its workspace has a workspace
 * spelling, and the site spelling keeps working. Header, query, delivery and admin route prefixes, the
 * mismatch rule across all four inputs, `Vary`, the GraphQL playground, the docs page and OpenAPI.
 */
describe('workspace spellings', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestSession;
  let marketing: SiteBody;

  const get = (url: string, headers: Record<string, string> = {}) =>
    testApp.app.inject({ method: 'GET', url, headers });
  const asOwner = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, headers = {}) =>
    testApp.app.inject({
      method,
      url,
      headers: { ...owner.headers, ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const probeKey = async (query: string, headers: Record<string, string> = {}) =>
    expectStatus(await get(`${PROBE}${query}`, headers), 200).json<{ key: string }>().key;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: GRAPHQL_ENV,
      register: registerProbe,
    });
    owner = await login(testApp.app, await createAdmin(database.current.db));
    // Created through the new prefix.
    marketing = expectStatus(
      await asOwner('POST', '/api/admin/workspaces', { key: 'marketing', name: 'Marketing' }),
      201,
    ).json<SiteBody>();
    const model = await asOwner('POST', '/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: 'post',
        label: 'Post',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      scope: 'network',
    });
    const modelId = expectStatus(model, 201).json<{ definitionId: string }>().definitionId;
    await setPublicGrants(database.current.db, [{ action: 'read', modelId }]);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('resolution', () => {
    it('follows each header and each query parameter', async () => {
      expect(await probeKey('')).toBe('default');
      expect(await probeKey('', { [WORKSPACE]: 'marketing' })).toBe('marketing');
      expect(await probeKey('', { [SITE]: 'marketing' })).toBe('marketing');
      expect(await probeKey('?workspace=marketing')).toBe('marketing');
      expect(await probeKey('?site=marketing')).toBe('marketing');
    });

    it('accepts every spelling at once when they name the same workspace', async () => {
      expect(
        await probeKey('?workspace=marketing&site=marketing', {
          [WORKSPACE]: 'marketing',
          [SITE]: 'marketing',
        }),
      ).toBe('marketing');
    });

    it('refuses any two spellings naming different workspaces (403 SITE_MISMATCH)', async () => {
      const pairs: Array<[string, Record<string, string>]> = [
        ['', { [WORKSPACE]: 'marketing', [SITE]: 'default' }],
        ['?site=default', { [WORKSPACE]: 'marketing' }],
        ['?workspace=default', { [WORKSPACE]: 'marketing' }],
        ['?workspace=default', { [SITE]: 'marketing' }],
        ['?site=default', { [SITE]: 'marketing' }],
        ['?workspace=marketing&site=default', {}],
      ];
      for (const [query, headers] of pairs) {
        const response = await get(`${PROBE}${query}`, headers);
        expect(response.statusCode, `${query} ${JSON.stringify(headers)}`).toBe(403);
        expect(codeOf(response)).toBe('SITE_MISMATCH');
        expect(response.json<{ error: { message: string } }>().error.message).toMatch(/different workspaces/);
      }
    });

    it('refuses a repeated parameter (400) instead of falling back to the primary workspace', async () => {
      for (const query of ['?site=marketing&site=default', '?workspace=marketing&workspace=marketing']) {
        const response = await get(`${PROBE}${query}`);
        expect(response.statusCode, query).toBe(400);
        expect(codeOf(response)).toBe('INVALID_QUERY');
      }
      expect((await get('/api/content/posts?site=default&site=default')).statusCode).toBe(400);
    });
  });

  describe('delivery', () => {
    it('reads content with ?workspace= taken out of the query, like ?site=', async () => {
      const titles = (response: LightMyRequestResponse) =>
        expectStatus(response, 200).json<{ data: unknown[] }>().data;
      expect(titles(await get('/api/content/posts?workspace=default&locale=en'))).toEqual([]);
      expect(titles(await get('/api/content/posts?site=default&locale=en'))).toEqual([]);
      expect(titles(await get('/api/content/posts?locale=en', { [WORKSPACE]: 'default' }))).toEqual([]);
    });

    it('answers GET /api/workspace exactly as GET /api/site', async () => {
      const byNew = expectStatus(
        await asOwner('GET', '/api/workspace', undefined, { [WORKSPACE]: 'marketing' }),
        200,
      );
      const byOld = expectStatus(await asOwner('GET', '/api/site', undefined, { [SITE]: 'marketing' }), 200);
      expect(byNew.json()).toEqual(byOld.json());
      expect(byNew.json()).toMatchObject({ key: 'marketing', name: 'Marketing' });
      expect(
        expectStatus(await asOwner('GET', '/api/workspace?workspace=marketing'), 200).json<{ key: string }>()
          .key,
      ).toBe('marketing');
    });

    it('varies cacheable REST and GraphQL responses on both headers', async () => {
      const vary = 'Authorization, Cookie, Shapio-Workspace, Shapio-Site';
      expect((await get('/api/content/posts')).headers.vary).toBe(vary);
      expect((await get('/api/workspace')).headers.vary).toBe(vary);
      const query = new URLSearchParams({ query: '{ _snapshot { snapshot } }' }).toString();
      expect((await get(`/api/graphql?${query}`)).headers.vary).toBe(vary);
    });

    it('reads GraphQL on the workspace ?workspace= names', async () => {
      const query = new URLSearchParams({ query: '{ _site { key } }' }).toString();
      const response = await asOwner('GET', `/api/graphql?workspace=marketing&${query}`);
      expect(expectStatus(response, 200).json<{ data: { _site: { key: string } } }>().data._site.key).toBe(
        'marketing',
      );
    });
  });

  describe('admin routes', () => {
    it('lists and reads workspaces under /api/admin/workspaces as under /api/admin/sites', async () => {
      const byNew = expectStatus(await asOwner('GET', '/api/admin/workspaces'), 200);
      const byOld = expectStatus(await asOwner('GET', '/api/admin/sites'), 200);
      expect(byNew.json()).toEqual(byOld.json());
      const one = expectStatus(await asOwner('GET', `/api/admin/workspaces/${marketing.id}`), 200);
      expect(one.json()).toEqual(
        expectStatus(await asOwner('GET', `/api/admin/sites/${marketing.id}`), 200).json(),
      );
      const roles = expectStatus(
        await asOwner('GET', `/api/admin/workspaces/${marketing.id}/app-roles`),
        200,
      );
      expect(roles.json()).toEqual(
        expectStatus(await asOwner('GET', `/api/admin/sites/${marketing.id}/app-roles`), 200).json(),
      );
    });

    it('renames under /api/admin/workspaces/:id, with the same version check', async () => {
      const renamed = await asOwner('PATCH', `/api/admin/workspaces/${marketing.id}`, {
        name: 'Marketing team',
        expectedVersion: marketing.version,
      });
      marketing = expectStatus(renamed, 200).json<SiteBody>();
      expect(marketing.name).toBe('Marketing team');
      const stale = await asOwner('PATCH', `/api/admin/sites/${marketing.id}`, {
        name: 'Stale',
        expectedVersion: marketing.version - 1,
      });
      expect(stale.statusCode).toBe(409);
    });

    it('serves the per-workspace settings under /api/admin/workspace as under /api/admin/site', async () => {
      for (const path of ['seo', 'change-sets']) {
        const byNew = expectStatus(
          await asOwner('GET', `/api/admin/workspace/${path}`, undefined, { [WORKSPACE]: 'marketing' }),
          200,
        );
        const byOld = expectStatus(
          await asOwner('GET', `/api/admin/site/${path}`, undefined, { [SITE]: 'marketing' }),
          200,
        );
        expect(byNew.json(), path).toEqual(byOld.json());
      }
    });

    it('narrows admin requests to the workspace Shapio-Workspace names', async () => {
      const me = await asOwner('GET', '/api/admin/auth/me', undefined, { [WORKSPACE]: 'marketing' });
      expect(expectStatus(me, 200).json<{ site: { key: string } }>().site.key).toBe('marketing');
      const split = await asOwner('GET', '/api/admin/auth/me', undefined, {
        [WORKSPACE]: 'marketing',
        [SITE]: 'default',
      });
      expect(codeOf(split)).toBe('SITE_MISMATCH');
    });

    it('makes a workspace primary under /api/admin/workspaces/:id/make-primary', async () => {
      const made = await asOwner('POST', `/api/admin/workspaces/${marketing.id}/make-primary`);
      expect(expectStatus(made, 200).json<SiteBody>().isPrimary).toBe(true);
      expect(await probeKey('')).toBe('marketing');
      const builtIn = expectStatus(await asOwner('GET', '/api/admin/workspaces'), 200)
        .json<SiteBody[]>()
        .find((site) => site.key === 'default');
      expectStatus(await asOwner('POST', `/api/admin/sites/${builtIn?.id ?? ''}/make-primary`), 200);
      expect(await probeKey('')).toBe('default');
    });
  });

  describe('GraphQL playground and docs', () => {
    it('points the playground at the workspace with ?workspace= on the endpoint, from either spelling', async () => {
      for (const query of [
        '?workspace=marketing',
        '?site=marketing',
        '?workspace=marketing&site=marketing',
      ]) {
        const page = expectStatus(await asOwner('GET', `/api/graphql/playground${query}`), 200);
        expect(page.body, query).toContain('data-endpoint="/api/graphql?workspace=marketing"');
      }
      const split = await asOwner('GET', '/api/graphql/playground?workspace=marketing&site=default');
      expect(split.statusCode).toBe(403);
      expect(codeOf(split)).toBe('SITE_MISMATCH');
      expect((await asOwner('GET', '/api/graphql/playground?workspace=Not%20a%20key')).statusCode).toBe(400);
    });

    it("links the docs page to the request's workspace with ?workspace=", async () => {
      const page = expectStatus(await asOwner('GET', '/api/docs?workspace=marketing'), 200);
      expect(page.body).toContain('href="/api/docs/openapi.json?workspace=marketing"');
      expect(page.body).toContain('<code>/api/graphql?workspace=marketing</code>');
    });

    it('documents GET /api/workspace, and keeps GET /api/site as deprecated', async () => {
      const document = expectStatus(await asOwner('GET', '/api/docs/openapi.json'), 200).json<OpenApi>();
      expect(document.paths['/api/workspace']?.get).toMatchObject({
        operationId: 'getWorkspace',
        tags: ['Workspace'],
      });
      expect(document.paths['/api/workspace']?.get.deprecated).toBeUndefined();
      expect(document.paths['/api/site']?.get).toMatchObject({ operationId: 'getSite', deprecated: true });
      expect(document.tags.map((tag) => tag.name)).toContain('Workspace');
    });
  });
});
