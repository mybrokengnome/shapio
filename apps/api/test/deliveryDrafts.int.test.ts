import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAuthenticatedGrants, setPublicGrants, signUp } from './helpers/appUsers.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Meta = { locale: string; snapshot: number; publicationState?: string };
type DeliveryList = { data: Array<Record<string, unknown>>; meta: Meta & { pagination: { total: number } } };
type DeliveryItem = { data: Record<string, unknown>; meta: Meta };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Drafts mode (plan drafts-mode): a delivery token whose role grants `readDrafts` reads draft heads through
 * `?publicationState=draft` and GraphQL `publicationState: DRAFT`; nobody else but admin principals may, and
 * published reads are unchanged.
 */
describe('delivery drafts mode', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let article: ModelBody;
  let author: ModelBody;
  let readOnly: string;
  let drafts: string;
  const ids: Record<string, string> = {};

  const deliver = (url: string, credential: string | null) =>
    testApp.app.inject({ method: 'GET', url, headers: credential ? bearer(credential) : {} });
  const create = async (modelKey: string, data: Record<string, unknown>, publish: boolean) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish }),
      201,
    ).json<EntryBody>();
  const save = async (modelKey: string, id: string, data: Record<string, unknown>) => {
    const current = expectStatus(
      await admin.get(`/api/admin/content/${modelKey}/${id}`),
      200,
    ).json<EntryBody>();
    return expectStatus(
      await admin.put(`/api/admin/content/${modelKey}/${id}`, { expectedVersion: current.version, data }),
      200,
    ).json<EntryBody>();
  };
  const errorOf = (response: LightMyRequestResponse) =>
    response.json<{ error: { code: string; message: string } }>().error;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    ids.draftAuthor = (await create('author', { name: 'Draft author' }, false)).id;
    ids.deletedAuthor = (await create('author', { name: 'Deleted author' }, true)).id;
    ids.unchanged = (await create('article', { title: 'Unchanged' }, true)).id;
    ids.edited = (await create('article', { title: 'Published title' }, true)).id;
    await save('article', ids.edited, { title: 'Saved, not published' });
    ids.draftOnly = (await create('article', { title: 'Draft only', author: ids.draftAuthor }, false)).id;
    ids.publishedAuthor = (await create('author', { name: 'Published author' }, true)).id;
    ids.switched = (await create('article', { title: 'Switched', author: ids.publishedAuthor }, true)).id;
    await save('article', ids.switched, { title: 'Switched', author: ids.draftAuthor });
    expectStatus(await admin.delete(`/api/admin/content/author/${ids.deletedAuthor}`), 204);

    const readGrants = [{ action: 'read' as const, modelId: null }];
    readOnly = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', readGrants),
    );
    drafts = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [
        ...readGrants,
        { action: 'readDrafts', modelId: null },
      ]),
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('refuses drafts to a delivery token without the grant, naming the grant', async () => {
    for (const url of [
      '/api/content/articles?publicationState=draft',
      `/api/content/articles/${ids.edited}?publicationState=draft`,
    ]) {
      const response = expectStatus(await deliver(url, readOnly), 403);
      expect(errorOf(response).code).toBe('DRAFTS_FORBIDDEN');
      expect(errorOf(response).message).toContain('grant Read drafts');
    }
    const gql = await graphql(testApp.app, '{ articles(publicationState: DRAFT) { totalCount } }', {
      headers: bearer(readOnly),
    });
    expect(errorCodes(gql)).toEqual(['DRAFTS_FORBIDDEN']);
  });

  it('serves draft heads in the delivery shape to a token granted Read drafts, never stored', async () => {
    const response = expectStatus(await deliver('/api/content/articles?publicationState=draft', drafts), 200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(String(response.headers.vary)).toContain('Authorization');
    const list = response.json<DeliveryList>();
    expect(list.meta.publicationState).toBe('draft');
    expect(list.data.map((entry) => entry.title).sort()).toEqual(
      ['Draft only', 'Saved, not published', 'Switched', 'Unchanged'].sort(),
    );

    const one = expectStatus(
      await deliver(`/api/content/articles/${ids.draftOnly}?publicationState=draft`, drafts),
      200,
    );
    expect(one.headers['cache-control']).toBe('private, no-store');
    expect(one.json<DeliveryItem>().data.title).toBe('Draft only');
    expect(one.json<DeliveryItem>().meta.publicationState).toBe('draft');

    // The same token's published reads are unchanged: no drafts, no publicationState, cacheable.
    const published = expectStatus(await deliver('/api/content/articles', drafts), 200);
    expect(published.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
    const publishedList = published.json<DeliveryList>();
    expect(publishedList.meta).not.toHaveProperty('publicationState');
    expect(publishedList.data.map((entry) => entry.title).sort()).toEqual(
      ['Published title', 'Switched', 'Unchanged'].sort(),
    );
    expect(
      expectStatus(await deliver('/api/content/articles?publicationState=published', drafts), 200).body,
    ).toBe(published.body);
  });

  it('reads a published entry with no draft change exactly as published', async () => {
    const draft = expectStatus(
      await deliver(`/api/content/articles/${ids.unchanged}?publicationState=draft`, drafts),
      200,
    ).json<DeliveryItem>();
    const published = expectStatus(
      await deliver(`/api/content/articles/${ids.unchanged}`, drafts),
      200,
    ).json<DeliveryItem>();
    expect(draft.data).toEqual(published.data);
  });

  it("resolves relation targets against draft heads, under the target model's read policy", async () => {
    const draftOnly = expectStatus(
      await deliver(`/api/content/articles/${ids.draftOnly}?publicationState=draft&populate=author`, drafts),
      200,
    ).json<DeliveryItem>();
    expect(draftOnly.data.author).toMatchObject({ id: ids.draftAuthor, name: 'Draft author' });
    // The saved draft points at another author than the published version: each read follows its own.
    const switchedUrl = `/api/content/articles/${ids.switched}?populate=author`;
    const draftSwitched = expectStatus(
      await deliver(`${switchedUrl}&publicationState=draft`, drafts),
      200,
    ).json<DeliveryItem>();
    expect(draftSwitched.data.author).toMatchObject({ id: ids.draftAuthor });
    const publishedSwitched = expectStatus(await deliver(switchedUrl, drafts), 200).json<DeliveryItem>();
    expect(publishedSwitched.data.author).toMatchObject({ id: ids.publishedAuthor });
    // A deleted entry has no draft head.
    const authors = expectStatus(
      await deliver('/api/content/authors?publicationState=draft', drafts),
      200,
    ).json<DeliveryList>();
    expect(authors.data.map((entry) => entry.id)).toContain(ids.draftAuthor);
    expect(authors.data.map((entry) => entry.id)).not.toContain(ids.deletedAuthor);
    // Read drafts adds no model: a target model the role may not read stays hidden in a draft read.
    const articlesOnly = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [
        { action: 'read', modelId: article.definition.id },
        { action: 'readDrafts', modelId: null },
      ]),
    );
    const hidden = expectStatus(
      await deliver(
        `/api/content/articles/${ids.draftOnly}?publicationState=draft&populate=author`,
        articlesOnly,
      ),
      200,
    ).json<DeliveryItem>();
    expect(JSON.stringify(hidden.data)).not.toContain('Draft author');
    expectStatus(await deliver('/api/content/authors?publicationState=draft', articlesOnly), 403);
  });

  it('refuses drafts with a pinned snapshot, and the parameter outside the delivery API', async () => {
    const { snapshot } = expectStatus(
      await deliver('/api/content/articles', drafts),
      200,
    ).json<DeliveryList>().meta;
    const pinned = expectStatus(
      await deliver(`/api/content/articles?publicationState=draft&snapshot=${snapshot}`, drafts),
      400,
    );
    expect(errorOf(pinned).code).toBe('INVALID_QUERY');
    expect(
      errorOf(expectStatus(await deliver('/api/content/articles?publicationState=maybe', drafts), 400)).code,
    ).toBe('INVALID_QUERY');
    expect(
      errorOf(expectStatus(await admin.get('/api/admin/content/article?publicationState=draft'), 400)).code,
    ).toBe('INVALID_QUERY');
  });

  it('never lets anonymous callers or app users read drafts, whatever they may read', async () => {
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: null }]);
    await setAuthenticatedGrants(database.current.db, [{ action: 'read', modelId: null }]);
    expectStatus(await deliver('/api/content/articles', null), 200);
    const anonymous = expectStatus(await deliver('/api/content/articles?publicationState=draft', null), 403);
    expect(errorOf(anonymous).code).toBe('DRAFTS_FORBIDDEN');
    const appUser = await signUp(testApp.app);
    const signedIn = expectStatus(
      await deliver('/api/content/articles?publicationState=draft', appUser.accessToken),
      403,
    );
    expect(errorOf(signedIn).code).toBe('DRAFTS_FORBIDDEN');
    const gql = await graphql(testApp.app, '{ articles(publicationState: DRAFT) { totalCount } }');
    expect(errorCodes(gql)).toEqual(['DRAFTS_FORBIDDEN']);
  });

  it('lets admin principals read drafts over REST too', async () => {
    const list = expectStatus(
      await deliver('/api/content/articles?publicationState=draft', adminToken),
      200,
    ).json<DeliveryList>();
    expect(list.data.map((entry) => entry.title)).toContain('Draft only');
  });

  it('serves GraphQL drafts to a granted token with the no-store header', async () => {
    const query =
      '{ articles(publicationState: DRAFT, sort: [{ title: ASC }]) { nodes { title } snapshot } }';
    type Articles = { articles: { nodes: Array<{ title: string }>; snapshot: number | null } };
    for (const method of ['POST', 'GET'] as const) {
      const result = await graphql<Articles>(testApp.app, query, { headers: bearer(drafts), method });
      const data = dataOf(result);
      expect(
        data.articles.nodes.map((node) => node.title),
        method,
      ).toContain('Saved, not published');
      expect(data.articles.snapshot, method).toBeNull();
      expect(result.response.headers['cache-control'], method).toBe('private, no-store');
    }
    // A published GET query keeps its validators and private caching.
    const published = await graphql(testApp.app, '{ articles { totalCount } }', {
      headers: bearer(drafts),
      method: 'GET',
    });
    expect(published.response.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
  });

  it('keeps Read drafts to delivery roles, on every model', async () => {
    const role = (kind: 'admin' | 'delivery', modelId: string | null) =>
      admin.post('/api/admin/roles', {
        key: `drafts-${kind}-${modelId === null ? 'all' : 'one'}`,
        name: 'Drafts',
        description: '',
        kind,
        permissions: [
          { action: 'read', modelId: null, condition: null, fieldIds: null },
          { action: 'readDrafts', modelId, condition: null, fieldIds: null },
        ],
      });
    expectStatus(await role('delivery', null), 201);
    const perModel = expectStatus(await role('delivery', article.definition.id), 400);
    expect(errorOf(perModel).code).toBe('INVALID_PERMISSIONS');
    const onAdmin = expectStatus(await role('admin', null), 400);
    expect(errorOf(onAdmin).code).toBe('INVALID_PERMISSIONS');
  });
});
