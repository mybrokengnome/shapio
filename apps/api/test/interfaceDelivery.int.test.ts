import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Row = Record<string, unknown> & { id: string; __model: string; title?: string };
type DeliveryList = {
  data: Row[];
  meta: { snapshot: number; pagination: { total: number }; members?: unknown };
};

const title = {
  apiKey: 'title',
  label: 'Title',
  type: 'string',
  required: true,
  filterable: true,
  sortable: true,
};
const summary = { apiKey: 'summary', label: 'Summary', type: 'text' };

/**
 * Reading through an interface (plan interfaces, D4, D6): Featurable is implemented by Post (localized, with a
 * Guide kind), BlogPost, and the About singleton; Digital is not a member. Every member holds `title` under
 * its own field ID. The list filters, sorts, searches and pages across members; relations to Featurable and
 * to any entry accept, refuse and populate by membership.
 */
describe('interfaces: delivery reads and relation values', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let token: string;
  const models: Record<string, ModelBody> = {};
  const ids: Record<string, string> = {};

  const deliver = (url: string, bearer: string | null = token, method: 'GET' | 'POST' = 'GET') =>
    testApp.app.inject({
      method,
      url,
      ...(method === 'POST' ? { payload: { data: { title: 'x' } } } : {}),
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    });
  const list = async (url: string, bearer: string | null = token) =>
    expectStatus(await deliver(url, bearer), 200).json<DeliveryList>();
  const publishNew = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish: true }),
      201,
    ).json<EntryBody>();
  const tokenFor = (...apiKeys: string[]) =>
    createDeliveryToken(
      database.current.db,
      apiKeys.map((apiKey) => ({ modelId: models[apiKey]?.definition.id ?? apiKey })),
    );
  const model = async (apiKey: string, definition: Record<string, unknown>) => {
    models[apiKey] = await createDefinition(admin, { apiKey, label: apiKey, ...definition });
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const created = expectStatus(
      await admin.post('/api/admin/interfaces', {
        definition: {
          kind: 'interface',
          apiKey: 'featurable',
          label: 'Featurable',
          fields: [title, summary],
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    const featurable = expectStatus(
      await admin.get(`/api/admin/interfaces/${created.definitionId}`),
      200,
    ).json<ModelBody>();
    const contractTitle = featurable.definition.fields[0]?.id;
    expectStatus(
      await admin.put(`/api/admin/interfaces/${featurable.definition.id}`, {
        definition: {
          ...featurable.definition,
          display: { titleFieldId: contractTitle, defaultSort: { fieldId: contractTitle, direction: 'asc' } },
        },
        expectedVersion: featurable.version,
      }),
      200,
    );
    const implementsFeaturable = [featurable.definition.id];
    await model('post', {
      kind: 'collection',
      localized: true,
      implements: implementsFeaturable,
      fields: [{ ...title, localized: true }, summary],
    });
    await model('guide', {
      kind: 'collection',
      localized: true,
      extends: models.post?.definition.id,
      fields: [{ apiKey: 'level', label: 'Level', type: 'integer' }],
    });
    await model('blogPost', {
      kind: 'collection',
      implements: implementsFeaturable,
      fields: [title, summary, { apiKey: 'body', label: 'Body', type: 'text' }],
    });
    await model('about', { kind: 'singleton', implements: implementsFeaturable, fields: [title, summary] });
    await model('digital', { kind: 'collection', pluralApiKey: 'digitals', fields: [title] });
    await model('homepage', {
      kind: 'singleton',
      fields: [
        {
          apiKey: 'featured',
          label: 'Featured',
          type: 'relation',
          settings: { target: featurable.definition.id, cardinality: 'many' },
        },
        {
          apiKey: 'spotlight',
          label: 'Spotlight',
          type: 'relation',
          settings: { target: '*', cardinality: 'one' },
        },
      ],
    });
    await runContentSchemaJobs(database.current.db);
    ids.alpha = (await publishNew('post', { title: 'Alpha web sign', summary: 'a' })).id;
    ids.beta = (await publishNew('guide', { title: 'Beta web sign', summary: 'b', level: 2 })).id;
    ids.gamma = (await publishNew('blogPost', { title: 'Gamma web sign', body: 'g' })).id;
    ids.delta = (await publishNew('blogPost', { title: 'Delta web', body: 'd' })).id;
    ids.epsilon = (await publishNew('about', { title: 'Epsilon web sign' })).id;
    ids.digital = (await publishNew('digital', { title: 'Web sign digital' })).id;
    token = await tokenFor('post', 'blogPost', 'about', 'digital', 'homepage');
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists every member, filtered, searched, sorted and paged across members with their own field IDs', async () => {
    const page = await list(
      '/api/content/featurables?sort=title&filters[title][$contains]=web&q=sign&pageSize=2&page=2',
    );
    expect(page.meta.pagination.total).toBe(4);
    expect(page.data.map((row) => [row.title, row.__model])).toEqual([
      ['Epsilon web sign', 'about'],
      ['Gamma web sign', 'blogPost'],
    ]);
    // Each row in its own shape: a BlogPost carries its body, About does not.
    expect(page.data[1]).toMatchObject({ id: ids.gamma, body: 'g' });
    expect(page.data[0]).not.toHaveProperty('body');
    expect(page.meta.members).toEqual([
      { apiKey: 'post', label: 'post', routeKey: 'posts' },
      { apiKey: 'guide', label: 'guide', routeKey: 'posts/guides' },
      { apiKey: 'blogPost', label: 'blogPost', routeKey: 'blogPosts' },
      { apiKey: 'about', label: 'about', routeKey: 'about' },
    ]);
  });

  it("sorts by the contract's default, narrows by member, selects contract fields only", async () => {
    const all = await list('/api/content/featurables');
    expect(all.data.map((row) => row.title)).toEqual([
      'Alpha web sign',
      'Beta web sign',
      'Delta web',
      'Epsilon web sign',
      'Gamma web sign',
    ]);
    expect(all.data[1]).toMatchObject({ __model: 'guide', level: 2 });
    const blogPosts = await list('/api/content/featurables?filters[__model]=blogPost&sort=title:desc');
    expect(blogPosts.data.map((row) => row.title)).toEqual(['Gamma web sign', 'Delta web']);
    const selected = await list(
      '/api/content/featurables?fields=title&filters[title][$eq]=Gamma%20web%20sign',
    );
    expect(Object.keys(selected.data[0] ?? {})).not.toContain('body');
    expect(selected.data[0]).toMatchObject({ title: 'Gamma web sign' });
    expect((await deliver('/api/content/featurables?fields=body')).statusCode).toBe(400);
    expect((await deliver('/api/content/featurables?filters[body][$eq]=g')).statusCode).toBe(400);
  });

  it('reads one entry of any member by ID; a non-member entry is not found', async () => {
    const one = expectStatus(await deliver(`/api/content/featurables/${ids.beta}`), 200).json<{
      data: Row;
    }>();
    expect(one.data).toMatchObject({ id: ids.beta, __model: 'guide', level: 2 });
    expect((await deliver(`/api/content/featurables/${ids.digital}`)).statusCode).toBe(404);
  });

  it('serves only the members the caller may read, and refuses a caller that may read none', async () => {
    const blogOnly = await list('/api/content/featurables', await tokenFor('blogPost'));
    expect(blogOnly.data.map((row) => row.__model)).toEqual(['blogPost', 'blogPost']);
    expect(blogOnly.meta.members).toEqual([{ apiKey: 'blogPost', label: 'blogPost', routeKey: 'blogPosts' }]);
    expect((await deliver('/api/content/featurables', await tokenFor('digital'))).statusCode).toBe(403);
    expect((await deliver('/api/content/featurables', null)).statusCode).toBe(401);
  });

  it('reads a pinned snapshot across members', async () => {
    const live = await list('/api/content/featurables');
    const pinned = await list(`/api/content/featurables?snapshot=${live.meta.snapshot}`);
    expect(pinned.data.map((row) => row.id)).toEqual(live.data.map((row) => row.id));
  });

  it('refuses writes through the interface, naming the member routes', async () => {
    const write = await admin.post('/api/admin/content/featurable', { data: { title: 'x' } });
    expect(write.statusCode).toBe(405);
    expect(write.body).toContain('/api/content/blogPosts');
  });

  it('a relation to the interface accepts members and kinds, refuses others; any entry accepts a singleton', async () => {
    const save = (data: Record<string, unknown>) =>
      admin.post('/api/admin/content/homepage', { data, publish: true });
    const refused = await save({ featured: [ids.beta, ids.digital] });
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('RELATION_TARGET_MISSING');
    expectStatus(await save({ featured: [ids.beta, ids.gamma, ids.epsilon], spotlight: ids.epsilon }), 201);
    const home = await list('/api/content/homepage?populate=featured,spotlight');
    const data = home.data as unknown as { featured: Row[]; spotlight: Row };
    expect(data.featured.map((row) => [row.id, row.__model])).toEqual([
      [ids.beta, 'guide'],
      [ids.gamma, 'blogPost'],
      [ids.epsilon, 'about'],
    ]);
    expect(data.spotlight).toMatchObject({ id: ids.epsilon, __model: 'about', title: 'Epsilon web sign' });
    // A member the caller may not read is left out of the value.
    const hidden = await list('/api/content/homepage', await tokenFor('homepage', 'blogPost'));
    expect((hidden.data as unknown as { featured: string[] }).featured).toEqual([ids.gamma]);
  });
});
