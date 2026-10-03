import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { setPublicGrants } from './helpers/appUsers.js';
import { createRole, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryListBody = {
  data: Array<{ id: string; title: string }>;
  meta: { snapshot: number; pagination: { total: number } };
};
type DeliveryItemBody = { data: { id: string; title: string }; meta: { snapshot: number } };
type SnapshotChangesBody = { from: number; to: number; items: Array<{ id: string; title: string | null }> };
type AdminSnapshotsBody = { items: Array<{ seq: number }>; current: number };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Delivery per site (plan agentic-ecosystem §H, package G6): two sites with the same content type and their
 * own content. REST, GraphQL and the snapshot routes read the request's site: the token's, else
 * `Shapio-Site` / `?site=`, else the primary site.
 */
describe('delivery per site', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestSession;
  let modelId: string;
  const entries = { primary: '', marketing: '', marketingDraftOnly: '' };
  const tokens = { primary: '', marketing: '' };
  const seqs = { primary: 0, marketing: 0 };

  /** Admin requests as the owner, on `site` (the primary site when left out). */
  const admin = (method: 'GET' | 'POST', url: string, payload?: unknown, site?: string) =>
    testApp.app.inject({
      method,
      url,
      headers: { ...owner.headers, ...(site ? { [SITE_HEADER]: site } : {}) },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  const createPost = async (title: string, site?: string) =>
    expectStatus(
      await admin('POST', '/api/admin/content/post', { locale: 'en', data: { title } }, site),
      201,
    ).json<EntryBody>().id;
  const publish = async (id: string, site?: string) =>
    expectStatus(
      await admin('POST', `/api/admin/content/post/${id}/publish`, { locales: ['en'] }, site),
      200,
    );
  const deliveryToken = async (site: string) => {
    const roleId = await createRole(database.current.db, 'delivery', [{ action: 'read', modelId }]);
    const created = await admin('POST', '/api/admin/tokens', { name: `delivery ${site}`, roleId }, site);
    return expectStatus(created, 201).json<{ token: string }>().token;
  };
  const get = (url: string, headers: Record<string, string> = {}) =>
    testApp.app.inject({ method: 'GET', url, headers });
  /** Titles in alphabetical order (the model is not sortable: no index job needed). */
  const titlesOf = (response: LightMyRequestResponse) =>
    expectStatus(response, 200)
      .json<DeliveryListBody>()
      .data.map((entry) => entry.title)
      .sort();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    owner = await login(testApp.app, await createAdmin(database.current.db));
    expectStatus(await admin('POST', '/api/admin/sites', { key: 'marketing', name: 'Marketing' }), 201);
    const model = await admin('POST', '/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: 'post',
        label: 'Post',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string', filterable: true }],
      },
    });
    modelId = expectStatus(model, 201).json<{ definitionId: string }>().definitionId;

    entries.primary = await createPost('Primary post');
    await publish(entries.primary);
    entries.marketing = await createPost('Marketing post', 'marketing');
    await publish(entries.marketing, 'marketing');
    entries.marketingDraftOnly = await createPost('Marketing draft', 'marketing');
    // A second primary publish, so the two sites' sequences differ (2 on the primary site, 1 on marketing).
    await publish(await createPost('Primary second'));
    seqs.primary = 2;
    seqs.marketing = 1;

    tokens.primary = await deliveryToken('default');
    tokens.marketing = await deliveryToken('marketing');
    await setPublicGrants(database.current.db, [{ action: 'read', modelId }]);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('REST /api/content', () => {
    it("reads the site token's site only, and another site's entry is not found", async () => {
      expect(titlesOf(await get('/api/content/posts', bearer(tokens.marketing)))).toEqual(['Marketing post']);
      expect(titlesOf(await get('/api/content/posts', bearer(tokens.primary)))).toEqual([
        'Primary post',
        'Primary second',
      ]);
      const own = await get(`/api/content/posts/${entries.marketing}`, bearer(tokens.marketing));
      expect(expectStatus(own, 200).json<DeliveryItemBody>().data.title).toBe('Marketing post');
      const across = await get(`/api/content/posts/${entries.primary}`, bearer(tokens.marketing));
      expect(across.statusCode).toBe(404);
    });

    it('accepts ?site= naming the token site, alongside query parameters and on one entry', async () => {
      expect(
        titlesOf(
          await get('/api/content/posts?site=marketing&filters[title][$eq]=Marketing%20post', {
            ...bearer(tokens.marketing),
          }),
        ),
      ).toEqual(['Marketing post']);
      const one = await get(
        `/api/content/posts/${entries.marketing}?site=marketing`,
        bearer(tokens.marketing),
      );
      expect(one.statusCode).toBe(200);
    });

    it('refuses ?site= or Shapio-Site naming another site than the token (403 SITE_MISMATCH)', async () => {
      const byQuery = await get('/api/content/posts?site=default', bearer(tokens.marketing));
      expect(byQuery.statusCode).toBe(403);
      expect(codeOf(byQuery)).toBe('SITE_MISMATCH');
      const byHeader = await get('/api/content/posts', {
        ...bearer(tokens.marketing),
        [SITE_HEADER]: 'default',
      });
      expect(byHeader.statusCode).toBe(403);
      expect(codeOf(byHeader)).toBe('SITE_MISMATCH');
      const split = await get('/api/content/posts?site=marketing', {
        ...bearer(tokens.marketing),
        [SITE_HEADER]: 'default',
      });
      expect(codeOf(split)).toBe('SITE_MISMATCH');
    });

    it('serves anonymous reads from the primary site by default', async () => {
      expect(titlesOf(await get('/api/content/posts'))).toEqual(['Primary post', 'Primary second']);
      expect(titlesOf(await get('/api/content/posts?site=default'))).toEqual([
        'Primary post',
        'Primary second',
      ]);
    });

    it('denies anonymous reads on a site that binds no public role (deny by default)', async () => {
      const unbound = await get('/api/content/posts?site=marketing');
      expect(unbound.statusCode).toBe(401);
    });

    it('pins ?snapshot=N to the numbers of the request site', async () => {
      const latest = expectStatus(await get('/api/content/posts', bearer(tokens.marketing)), 200);
      expect(latest.json<DeliveryListBody>().meta.snapshot).toBe(seqs.marketing);
      const pinned = await get(`/api/content/posts?snapshot=${seqs.marketing}`, bearer(tokens.marketing));
      expect(titlesOf(pinned)).toEqual(['Marketing post']);
      // Snapshot 2 exists on the primary site only.
      const beyond = await get(`/api/content/posts?snapshot=${seqs.primary}`, bearer(tokens.marketing));
      expect(beyond.statusCode).toBe(400);
      const primaryPinned = await get(`/api/content/posts?snapshot=1`, bearer(tokens.primary));
      expect(titlesOf(primaryPinned)).toEqual(['Primary post']);
    });

    it('writes into the request site (a network admin token naming the site through the delivery API)', async () => {
      const roleId = await createRole(database.current.db, 'admin', [
        { action: 'read', modelId },
        { action: 'create', modelId },
      ]);
      const created = await admin('POST', '/api/admin/tokens', { name: 'writer', roleId });
      const { token } = expectStatus(created, 201).json<{ token: string }>();
      const write = (headers: Record<string, string>) =>
        testApp.app.inject({
          method: 'POST',
          url: '/api/content/posts',
          headers: { ...bearer(token), ...headers },
          payload: { data: { title: 'Written' } },
        });
      const onMarketing = expectStatus(await write({ [SITE_HEADER]: 'marketing' }), 201);
      const { id } = onMarketing.json<{ data: { id: string } }>().data;
      expect((await admin('GET', `/api/admin/content/post/${id}`, undefined, 'marketing')).statusCode).toBe(
        200,
      );
      expect((await admin('GET', `/api/admin/content/post/${id}`)).statusCode).toBe(404);
      // A site token cannot write elsewhere either: resolution refuses before the write runs.
      const refused = await testApp.app.inject({
        method: 'POST',
        url: '/api/content/posts?site=default',
        headers: bearer(tokens.marketing),
        payload: { data: { title: 'Nope' } },
      });
      expect(codeOf(refused)).toBe('SITE_MISMATCH');
    });

    it('varies cacheable responses on Shapio-Site', async () => {
      const response = await get('/api/content/posts', { [SITE_HEADER]: 'default' });
      expect(response.headers.vary).toBe('Authorization, Cookie, Shapio-Site');
    });
  });

  it('keeps the CORS Vary: Origin on cacheable REST and GraphQL responses', async () => {
    const corsApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, CORS_ORIGINS: 'https://site.example' },
    });
    try {
      const origin = { origin: 'https://site.example' };
      const rest = await corsApp.app.inject({ method: 'GET', url: '/api/content/posts', headers: origin });
      expect(rest.headers.vary).toBe('Origin, Authorization, Cookie, Shapio-Site');
      const query = new URLSearchParams({ query: '{ _snapshot { snapshot } }' }).toString();
      const gql = await corsApp.app.inject({ method: 'GET', url: `/api/graphql?${query}`, headers: origin });
      expect(gql.headers.vary).toBe('Origin, Authorization, Cookie, Shapio-Site');
    } finally {
      await corsApp.app.close();
    }
  });

  describe('snapshot routes', () => {
    it('reports the current snapshot of the request site', async () => {
      const current = (token: string, query = '') =>
        get(`/api/snapshots/current${query}`, bearer(token)).then((response) =>
          expectStatus(response, 200).json<{ snapshot: number }>(),
        );
      expect((await current(tokens.marketing)).snapshot).toBe(seqs.marketing);
      expect((await current(tokens.primary)).snapshot).toBe(seqs.primary);
      expect((await current(tokens.marketing, '?site=marketing')).snapshot).toBe(seqs.marketing);
    });

    it('lists the changes of the request site only, and takes ?site= despite its strict query schema', async () => {
      const marketing = await get('/api/snapshots/changes?from=0&site=marketing', bearer(tokens.marketing));
      expect(
        expectStatus(marketing, 200)
          .json<SnapshotChangesBody>()
          .items.map((item) => item.id),
      ).toEqual([entries.marketing]);
      const primary = await get('/api/snapshots/changes?from=0', bearer(tokens.primary));
      const primaryIds = expectStatus(primary, 200)
        .json<SnapshotChangesBody>()
        .items.map((item) => item.id);
      expect(primaryIds).toContain(entries.primary);
      expect(primaryIds).not.toContain(entries.marketing);
      const mismatch = await get('/api/snapshots/changes?from=0&site=default', bearer(tokens.marketing));
      expect(codeOf(mismatch)).toBe('SITE_MISMATCH');
    });

    it("lists the admin snapshot ledger of the header's site", async () => {
      const ledger = (site?: string) =>
        admin('GET', '/api/admin/snapshots', undefined, site).then((response) =>
          expectStatus(response, 200).json<AdminSnapshotsBody>(),
        );
      const marketing = await ledger('marketing');
      expect(marketing.current).toBe(seqs.marketing);
      expect(marketing.items.map((item) => item.seq)).toEqual([1]);
      const primary = await ledger();
      expect(primary.current).toBe(seqs.primary);
      expect(primary.items.map((item) => item.seq)).toEqual([2, 1]);
      const one = await admin('GET', `/api/admin/snapshots/${seqs.primary}`, undefined, 'marketing');
      expect(one.statusCode).toBe(404);
    });
  });

  describe('GraphQL', () => {
    type PostsData = {
      posts: { nodes: Array<{ id: string; title: string }> };
      _snapshot: { snapshot: number };
      _changes: { nodes: Array<{ id: string }> };
    };
    const QUERY =
      '{ posts { nodes { id title } } _snapshot { snapshot } _changes(from: 0) { nodes { id } } }';
    const titles = (data: PostsData | null | undefined) => data?.posts.nodes.map((node) => node.title).sort();

    it("reads the token's site: entries, _snapshot and _changes", async () => {
      const marketing = await graphql<PostsData>(testApp.app, QUERY, { headers: bearer(tokens.marketing) });
      expect(marketing.body.errors).toBeUndefined();
      expect(titles(marketing.body.data)).toEqual(['Marketing post']);
      expect(marketing.body.data?._snapshot.snapshot).toBe(seqs.marketing);
      expect(marketing.body.data?._changes.nodes.map((node) => node.id)).toEqual([entries.marketing]);

      const primary = await graphql<PostsData>(testApp.app, QUERY, { headers: bearer(tokens.primary) });
      expect(titles(primary.body.data)).toEqual(['Primary post', 'Primary second']);
      expect(primary.body.data?._snapshot.snapshot).toBe(seqs.primary);
    });

    it("never resolves another site's entry by ID", async () => {
      const result = await graphql<{ post: { title: string } | null }>(
        testApp.app,
        'query ($id: ID!) { post(id: $id) { title } }',
        { variables: { id: entries.primary }, headers: bearer(tokens.marketing) },
      );
      expect(result.body.data?.post ?? null).toBeNull();
    });

    it('takes the site from Shapio-Site or ?site= on GET, and refuses a mismatch with 403', async () => {
      const network = await graphql<PostsData>(testApp.app, QUERY, {
        method: 'GET',
        headers: { [SITE_HEADER]: 'default' },
      });
      expect(network.statusCode).toBe(200);
      expect(network.response.headers.vary).toBe('Authorization, Cookie, Shapio-Site');
      const viaQuery = await get(
        `/api/graphql?${new URLSearchParams({ query: QUERY, site: 'marketing' }).toString()}`,
        bearer(tokens.marketing),
      );
      expect(expectStatus(viaQuery, 200).json<{ data: PostsData }>().data._snapshot.snapshot).toBe(
        seqs.marketing,
      );
      const mismatch = await graphql(testApp.app, QUERY, {
        headers: { ...bearer(tokens.marketing), [SITE_HEADER]: 'default' },
      });
      expect(mismatch.statusCode).toBe(403);
      expect(mismatch.body.errors?.[0]?.extensions?.code).toBe('SITE_MISMATCH');
      const unknown = await graphql(testApp.app, QUERY, { headers: { [SITE_HEADER]: 'nowhere' } });
      expect(unknown.statusCode).toBe(404);
    });
  });
});
