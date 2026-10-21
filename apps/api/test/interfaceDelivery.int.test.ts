import { SEO_COMPONENT_ID } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createDeliveryToken,
  createRole,
  createTokenForRole,
  fieldIdOf,
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
    // Every member has an author: the contract names the relation, so a path may run through it.
    await model('person', {
      kind: 'collection',
      pluralApiKey: 'people',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const author = {
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: models.person?.definition.id, cardinality: 'one' },
    };
    const created = expectStatus(
      await admin.post('/api/admin/interfaces', {
        definition: {
          kind: 'interface',
          apiKey: 'featurable',
          label: 'Featurable',
          fields: [title, summary, author],
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
      fields: [{ ...title, localized: true }, summary, author],
    });
    await model('guide', {
      kind: 'collection',
      localized: true,
      extends: models.post?.definition.id,
      fields: [{ apiKey: 'level', label: 'Level', type: 'integer' }],
    });
    await model('digital', { kind: 'collection', pluralApiKey: 'digitals', fields: [title] });
    await model('blogPost', {
      kind: 'collection',
      implements: implementsFeaturable,
      fields: [
        title,
        summary,
        author,
        { apiKey: 'body', label: 'Body', type: 'text' },
        {
          apiKey: 'related',
          label: 'Related',
          type: 'relation',
          settings: { target: models.digital?.definition.id, cardinality: 'many' },
        },
      ],
    });
    expectStatus(await admin.post('/api/admin/components/builtin/seo/ensure', {}), 201);
    await model('about', {
      kind: 'singleton',
      implements: implementsFeaturable,
      fields: [
        title,
        summary,
        author,
        { apiKey: 'seo', label: 'SEO', type: 'component', settings: { component: SEO_COMPONENT_ID } },
      ],
    });
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
    models.card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          {
            apiKey: 'item',
            label: 'Item',
            type: 'relation',
            settings: { target: featurable.definition.id, cardinality: 'one' },
          },
        ],
      },
      'components',
    );
    await runContentSchemaJobs(database.current.db);
    ids.alpha = (await publishNew('post', { title: 'Alpha web sign', summary: 'a' })).id;
    // A French version of the Post only: Post is localized, every other member is not.
    expectStatus(
      await admin.put(`/api/admin/content/post/${ids.alpha}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'Alpha FR web sign' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/post/${ids.alpha}/publish`, { locales: ['fr'] }), 200);
    ids.beta = (await publishNew('guide', { title: 'Beta web sign', summary: 'b', level: 2 })).id;

    ids.delta = (await publishNew('blogPost', { title: 'Delta web', body: 'd' })).id;
    ids.epsilon = (await publishNew('about', { title: 'Epsilon web sign' })).id;
    ids.digital = (await publishNew('digital', { title: 'Web sign digital' })).id;
    ids.ada = (await publishNew('person', { name: 'Ada' })).id;
    ids.gamma = (
      await publishNew('blogPost', {
        title: 'Gamma web sign',
        body: 'g',
        related: [ids.digital],
        author: ids.ada,
      })
    ).id;
    token = await tokenFor('post', 'blogPost', 'about', 'digital', 'homepage', 'person');
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
    const notMember = await deliver('/api/content/featurables?filters[__model][$eq]=digital');
    expect(notMember.statusCode).toBe(400);
    expect(notMember.json<{ error: { message: string } }>().error.message).toBe(
      '"digital" is not a member of this interface',
    );
    expect((await deliver('/api/content/featurables?fields=body')).statusCode).toBe(400);
    expect((await deliver('/api/content/featurables?filters[body][$eq]=g')).statusCode).toBe(400);
  });

  it('serves each member in its own locale scope: the localized one in French, the others as they are', async () => {
    const french = await list('/api/content/featurables?locale=fr&filters[title][$contains]=Alpha');
    expect(french.data.map((row) => [row.title, row.locale])).toEqual([['Alpha FR web sign', 'fr']]);
    const all = await list('/api/content/featurables?locale=fr');
    expect(all.data.map((row) => row.title)).toEqual([
      'Alpha FR web sign',
      'Beta web sign',
      'Delta web',
      'Epsilon web sign',
      'Gamma web sign',
    ]);
  });

  it("populate=* expands each member's own relations", async () => {
    const page = await list('/api/content/featurables?populate=*&filters[__model][$in]=blogPost,post');
    const gamma = page.data.find((row) => row.id === ids.gamma) as { related: Row[] } | undefined;
    expect(gamma?.related.map((row) => [row.id, row.__model])).toEqual([[ids.digital, 'digital']]);
    expect(page.data.find((row) => row.id === ids.alpha)).not.toHaveProperty('related');
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

  it('an interface no type implements lists nothing to a reader of some type; others are still refused', async () => {
    expectStatus(
      await admin.post('/api/admin/interfaces', {
        definition: { kind: 'interface', apiKey: 'listable', label: 'Listable', fields: [title] },
      }),
      201,
    );
    const empty = await list('/api/content/listables', await tokenFor('blogPost'));
    expect(empty.data).toEqual([]);
    expect(empty.meta).toMatchObject({ members: [], pagination: { total: 0 } });
    expect(typeof empty.meta.snapshot).toBe('number');
    expect(
      (await deliver(`/api/content/listables/${ids.gamma}`, await tokenFor('blogPost'))).statusCode,
    ).toBe(404);
    expect((await deliver('/api/content/listables', await tokenFor())).statusCode).toBe(403);
    expect((await deliver('/api/content/listables', null)).statusCode).toBe(401);
  });

  it('reads a pinned snapshot across members', async () => {
    const live = await list('/api/content/featurables');
    const pinned = await list(`/api/content/featurables?snapshot=${live.meta.snapshot}`);
    expect(pinned.data.map((row) => row.id)).toEqual(live.data.map((row) => row.id));
  });

  it("entry events carry the routes of the member's interfaces, a kind's included", async () => {
    const payloadOf = async (entryId: string | undefined) => {
      const event = await database.current.db
        .selectFrom('outbox_events')
        .select(['payload'])
        .where('aggregate_id', '=', entryId ?? '')
        .where('type', '=', 'entry.published')
        .executeTakeFirstOrThrow();
      return (typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload) as Record<
        string,
        unknown
      >;
    };
    expect(await payloadOf(ids.gamma)).toMatchObject({ routeKey: 'blogPosts', interfaces: ['featurables'] });
    expect(await payloadOf(ids.beta)).toMatchObject({
      routeKey: 'posts/guides',
      interfaces: ['featurables'],
    });
    expect(await payloadOf(ids.digital)).toMatchObject({ interfaces: [] });
  });

  it("?seo=resolved resolves each member's own SEO fields; members without one are as they were", async () => {
    const raw = await list('/api/content/featurables?filters[__model][$in]=about,blogPost');
    expect(raw.data.find((row) => row.id === ids.epsilon)).toMatchObject({ seo: null });
    const resolved = await list('/api/content/featurables?seo=resolved&filters[__model][$in]=about,blogPost');
    const about = resolved.data.find((row) => row.id === ids.epsilon) as
      { seo: { title: string } } | undefined;
    expect(about?.seo.title).toContain('Epsilon web sign');
    expect(resolved.data.find((row) => row.id === ids.gamma)).not.toHaveProperty('seo');
    // Only BlogPost readable: no member has an SEO field to resolve.
    const blogOnly = await deliver('/api/content/featurables?seo=resolved', await tokenFor('blogPost'));
    expect(blogOnly.statusCode).toBe(400);
  });

  it("previews a member's entry through the interface route, read as its own type", async () => {
    const session = await login(testApp.app, await createAdmin(database.current.db));
    const tokenOf = async (modelKey: string, entryId: string | undefined) =>
      expectStatus(
        await testApp.app.inject({
          method: 'POST',
          url: '/api/admin/preview/tokens',
          payload: { modelKey, entryId },
          headers: session.headers,
        }),
        201,
      ).json<{ token: string }>().token;
    const preview = (path: string, previewToken: string) =>
      testApp.app.inject({
        method: 'GET',
        url: `/api/preview/content/${path}`,
        headers: { authorization: `Bearer ${previewToken}` },
      });
    const guideToken = await tokenOf('guide', ids.beta);
    const one = expectStatus(await preview(`featurables/${ids.beta}`, guideToken), 200).json<{ data: Row }>();
    expect(one.data).toMatchObject({ id: ids.beta, __model: 'guide', level: 2 });
    const page = expectStatus(await preview('featurables', guideToken), 200).json<DeliveryList>();
    expect(page.data.map((row) => [row.id, row.__model])).toEqual([[ids.beta, 'guide']]);
    // A token for a type that does not implement the interface is not served through it.
    const digitalToken = await tokenOf('digital', ids.digital);
    expect((await preview('featurables', digitalToken)).statusCode).toBe(403);
  });

  it('refuses writes through the interface, naming the member routes', async () => {
    const write = await admin.post('/api/admin/content/featurable', { data: { title: 'x' } });
    expect(write.statusCode).toBe(405);
    expect(write.body).toContain('/api/content/blogPosts');
    // Through the delivery route the 405 wins over body validation (no expectedVersion here).
    for (const [method, url] of [
      ['POST', '/api/content/featurables'],
      ['PUT', `/api/content/featurables/${ids.gamma}`],
      ['DELETE', `/api/content/featurables/${ids.gamma}`],
    ] as const) {
      const refused = await testApp.app.inject({
        method,
        url,
        payload: method === 'DELETE' ? undefined : { data: { title: 'x' } },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(refused.statusCode, `${method} ${url}`).toBe(405);
    }
    // An anonymous writer learns nothing of the interface: the 401 an anonymous reader gets.
    const anonymous = await testApp.app.inject({
      method: 'PUT',
      url: `/api/content/featurables/${ids.gamma}`,
      payload: { data: { title: 'x' } },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).not.toContain('blogPosts');
  });

  it('a relation to the interface accepts members and kinds, refuses others; any entry accepts a singleton', async () => {
    const save = (data: Record<string, unknown>) =>
      admin.post('/api/admin/content/homepage', { data, publish: true });
    const refused = await save({ featured: [ids.beta, ids.digital] });
    expect(refused.statusCode).toBe(422);
    expect(refused.body).toContain('RELATION_TARGET_MISSING');
    expect(refused.body).toContain(
      `entry ${ids.digital} is not a Featurable (a post, guide, blogPost, or about)`,
    );
    const nowhere = await save({ spotlight: '00000000-0000-4000-8000-0000000000ff' });
    expect(nowhere.body).toContain('entry 00000000-0000-4000-8000-0000000000ff is not an entry of this site');
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

  it('populates a path below a relation to an interface from a model route; none below any entry', async () => {
    // The Homepage the test above saved: featured Beta, Gamma, Epsilon.
    const home = await list('/api/content/homepage?populate=featured.author');
    const featured = (home.data as unknown as { featured: Array<Row & { author: unknown }> }).featured;
    expect(featured.map((row) => [row.id, row.__model])).toEqual([
      [ids.beta, 'guide'],
      [ids.gamma, 'blogPost'],
      [ids.epsilon, 'about'],
    ]);
    expect(featured[1]?.author).toMatchObject({ id: ids.ada, __model: 'person', name: 'Ada' });
    expect(featured[0]?.author).toBeNull();
    const refused = await deliver('/api/content/homepage?populate=spotlight.author');
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('Cannot populate');
  });

  describe('content targets (the admin relation picker)', () => {
    type Targets = {
      target: { kind: string; label: string | null };
      members: Array<{ apiKey: string }>;
      items: Array<{ id: string; model: string; title: string | null; status: string }>;
      total: number;
    };
    const featured = () => fieldIdOf(models.homepage as ModelBody, 'featured');
    const spotlight = () => fieldIdOf(models.homepage as ModelBody, 'spotlight');
    const targets = async (query: string, client: SchemaClient = admin, status = 200) =>
      expectStatus(await client.get(`/api/admin/content-targets?${query}`), status).json<Targets>();
    const adminWith = async (grants: Parameters<typeof createRole>[2]) =>
      schemaClient(
        testApp.app,
        await createTokenForRole(database.current.db, await createRole(database.current.db, 'admin', grants)),
      );

    it("lists an interface's members' drafts, searched on each one's own title, narrowed by type", async () => {
      const found = await targets(`field=${featured()}&q=sign`);
      expect(found.target).toEqual({ kind: 'interface', label: 'Featurable' });
      expect(found.members.map((member) => member.apiKey)).toEqual(['post', 'guide', 'blogPost', 'about']);
      expect(found.total).toBe(4);
      expect(found.items.map((item) => [item.title, item.model]).sort()).toEqual([
        ['Alpha web sign', 'post'],
        ['Beta web sign', 'guide'],
        ['Epsilon web sign', 'about'],
        ['Gamma web sign', 'blogPost'],
      ]);
      const blogPosts = await targets(`field=${featured()}&types=blogPost&pageSize=1`);
      expect(blogPosts.total).toBe(2);
      expect(blogPosts.items).toHaveLength(1);
      expect(blogPosts.items[0]?.model).toBe('blogPost');
      await targets(`field=${featured()}&types=digital`, admin, 400);
    });

    it('labels a stored value by ID: members only for an interface, any model for any entry', async () => {
      const asked = `ids=${ids.digital},${ids.gamma},${ids.beta}`;
      const featuredItems = await targets(`field=${featured()}&${asked}`);
      expect(featuredItems.items.map((item) => [item.id, item.model])).toEqual([
        [ids.gamma, 'blogPost'],
        [ids.beta, 'guide'],
      ]);
      expect(featuredItems.total).toBe(2);
      const anyItems = await targets(`field=${spotlight()}&${asked}`);
      expect(anyItems.target).toEqual({ kind: 'any', label: null });
      expect(anyItems.items.map((item) => item.model)).toEqual(['digital', 'blogPost', 'guide']);
      await targets(`field=${spotlight()}&ids=not-an-id`, admin, 400);
    });

    it('resolves a relation field inside a component', async () => {
      const found = await targets(`field=${fieldIdOf(models.card as ModelBody, 'item')}&types=about`);
      expect(found.items.map((item) => item.title)).toEqual(['Epsilon web sign']);
    });

    it('skips a model whose title the caller may not search, masks it, and refuses when nothing is readable', async () => {
      const limited = await adminWith([
        {
          action: 'read',
          modelId: models.blogPost?.definition.id ?? null,
          fieldIds: [fieldIdOf(models.blogPost as ModelBody, 'body')],
        },
        { action: 'read', modelId: models.about?.definition.id ?? null },
      ]);
      const searched = await targets(`field=${featured()}&q=sign`, limited);
      expect(searched.items.map((item) => item.model)).toEqual(['about']);
      const listed = await targets(`field=${featured()}&types=blogPost`, limited);
      expect(listed.items.map((item) => item.title)).toEqual([null, null]);
      const none = await adminWith([{ action: 'read', modelId: models.digital?.definition.id ?? null }]);
      await targets(`field=${featured()}`, none, 403);
    });
  });
});
