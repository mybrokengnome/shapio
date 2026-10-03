import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: { snapshot: number; pagination: { total: number } };
};

describe('delivery API', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let author: ModelBody;
  let token: string;

  const deliver = (url: string, options: Partial<InjectOptions> = {}, bearer: string | null = token) =>
    testApp.app.inject({
      method: 'GET',
      url,
      ...options,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...options.headers },
    });
  const create = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, { data }), 201).json<EntryBody>();
  const save = async (modelKey: string, entry: EntryBody, data: Record<string, unknown>) =>
    expectStatus(
      await admin.put(`/api/admin/content/${modelKey}/${entry.id}`, { expectedVersion: entry.version, data }),
      200,
    ).json<EntryBody>();
  const publish = async (modelKey: string, id: string) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, {}), 200).json<EntryBody>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
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
        { apiKey: 'secret', label: 'Secret', type: 'string', public: false },
        { apiKey: 'views', label: 'Views', type: 'integer', sortable: true },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'related',
          label: 'Related',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'many' },
        },
      ],
      display: {},
    });
    token = await createDeliveryToken(database.current.db, [
      { modelId: article.definition.id },
      { modelId: author.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('never serves draft-only entries, draft values or filters on draft values', async () => {
    const draftOnly = await create('article', { title: 'Draft only', secret: 's' });
    const live = await create('article', { title: 'Live v1', views: 1 });
    await publish('article', live.id);
    const edited = await save(
      'article',
      (await admin.get(`/api/admin/content/article/${live.id}`)).json<EntryBody>(),
      {
        title: 'Live v2 draft',
      },
    );
    expect(edited.status).toBe('modified');

    const list = expectStatus(await deliver('/api/content/articles'), 200).json<DeliveryList>();
    expect(list.data.map((entry) => entry.title)).toEqual(['Live v1']);
    expect(JSON.stringify(list)).not.toContain('Draft only');
    expect(JSON.stringify(list)).not.toContain('Live v2 draft');
    expect((await deliver(`/api/content/articles/${draftOnly.id}`)).statusCode).toBe(404);
    expect(
      expectStatus(
        await deliver('/api/content/articles?filters[title][$eq]=Live v2 draft'),
        200,
      ).json<DeliveryList>().data,
    ).toEqual([]);
    expect(
      expectStatus(
        await deliver('/api/content/articles?filters[title][$eq]=Draft only'),
        200,
      ).json<DeliveryList>().data,
    ).toEqual([]);
    expect(
      expectStatus(
        await deliver('/api/content/articles?filters[title][$containsi]=draft'),
        200,
      ).json<DeliveryList>().data,
    ).toEqual([]);
    expect(
      expectStatus(
        await deliver('/api/content/articles?filters[title][$eq]=Live v1'),
        200,
      ).json<DeliveryList>().data,
    ).toHaveLength(1);
  });

  it('never leaks draft relations or the IDs of unpublished targets', async () => {
    const draftAuthor = await create('author', { name: 'Unpublished author' });
    const liveAuthor = await create('author', { name: 'Live author' });
    await publish('author', liveAuthor.id);
    const post = await create('article', {
      title: 'Relations',
      author: draftAuthor.id,
      related: [liveAuthor.id, draftAuthor.id],
    });
    await publish('article', post.id);

    const read = () => deliver(`/api/content/articles/${post.id}?populate=author,related`);
    let body = expectStatus(await read(), 200).json<{ data: Record<string, unknown> }>();
    expect(body.data.author).toBeNull();
    expect(body.data.related).toEqual([expect.objectContaining({ id: liveAuthor.id, name: 'Live author' })]);
    expect(JSON.stringify(body)).not.toContain(draftAuthor.id);
    const unpopulated = expectStatus(await deliver(`/api/content/articles/${post.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(unpopulated.data).toMatchObject({ author: null, related: [liveAuthor.id] });

    // A relation added only in the draft stays invisible.
    const current = (await admin.get(`/api/admin/content/article/${post.id}`)).json<EntryBody>();
    await save('article', current, { related: [liveAuthor.id], author: liveAuthor.id });
    body = expectStatus(await read(), 200).json<{ data: Record<string, unknown> }>();
    expect(body.data.author).toBeNull();

    await publish('author', draftAuthor.id);
    body = expectStatus(await read(), 200).json<{ data: Record<string, unknown> }>();
    expect(body.data.author).toMatchObject({ id: draftAuthor.id, name: 'Unpublished author' });
  });

  it('hides non-public fields from delivery tokens and rejects filtering or sorting on them', async () => {
    const entry = await create('article', { title: 'Has secret', secret: 'classified' });
    await publish('article', entry.id);
    const delivered = expectStatus(await deliver(`/api/content/articles/${entry.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(delivered.data).not.toHaveProperty('secret');
    expect(JSON.stringify(delivered)).not.toContain('classified');
    const adminView = (await admin.get(`/api/admin/content/article/${entry.id}`)).json<EntryBody>();
    expect(adminView.data.secret).toBe('classified');

    for (const url of [
      '/api/content/articles?filters[secret][$eq]=classified',
      '/api/content/articles?filters[$or][0][secret][$null]=true&filters[$or][1][title][$eq]=x',
      '/api/content/articles?sort=secret:asc',
      '/api/content/articles?fields=secret',
    ]) {
      const response = await deliver(url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN_FIELD' } });
    }

    // A role that names the field explicitly sees it.
    const named = await createDeliveryToken(database.current.db, [
      {
        modelId: article.definition.id,
        fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'secret')],
      },
    ]);
    const granted = expectStatus(await deliver(`/api/content/articles/${entry.id}`, {}, named), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(granted.data).toEqual(expect.objectContaining({ title: 'Has secret', secret: 'classified' }));
    expect(granted.data).not.toHaveProperty('views');
  });

  it('hides non-public fields of populated relation targets, at every populate depth', async () => {
    const publisher = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'publisher',
      label: 'Publisher',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string' },
        { apiKey: 'taxId', label: 'Tax ID', type: 'string', public: false },
      ],
    });
    const writer = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'writer',
      label: 'Writer',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', filterable: true, sortable: true },
        { apiKey: 'email', label: 'Email', type: 'string', public: false, filterable: true, sortable: true },
        {
          apiKey: 'publisher',
          label: 'Publisher',
          type: 'relation',
          settings: { target: publisher.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'agent',
          label: 'Agent',
          type: 'relation',
          public: false,
          settings: { target: publisher.definition.id, cardinality: 'one' },
        },
      ],
    });
    const story = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: writer.definition.id, cardinality: 'one' },
        },
      ],
    });
    const reader = await createDeliveryToken(database.current.db, [
      { modelId: story.definition.id },
      { modelId: writer.definition.id },
      { modelId: publisher.definition.id },
    ]);
    const house = await create('publisher', { name: 'Public House', taxId: 'TAX-SECRET-1' });
    await publish('publisher', house.id);
    const hiddenAgent = await create('publisher', { name: 'Hidden Agency', taxId: 'TAX-SECRET-2' });
    await publish('publisher', hiddenAgent.id);
    const person = await create('writer', {
      name: 'Ada',
      email: 'ada@private.example',
      publisher: house.id,
      agent: hiddenAgent.id,
    });
    await publish('writer', person.id);
    const tale = await create('story', { title: 'Tale', writer: person.id });
    await publish('story', tale.id);

    const read = async (query: string) =>
      expectStatus(await deliver(`/api/content/stories/${tale.id}?${query}`, {}, reader), 200).json<{
        data: Record<string, unknown>;
      }>();

    const one = await read('populate=writer');
    expect(one.data.writer).toMatchObject({ id: person.id, name: 'Ada', publisher: house.id });
    expect(one.data.writer).not.toHaveProperty('email');
    expect(one.data.writer).not.toHaveProperty('agent');
    expect(JSON.stringify(one)).not.toContain('ada@private.example');
    expect(JSON.stringify(one)).not.toContain(hiddenAgent.id);

    const two = await read('populate=writer.publisher');
    expect(two.data.writer).toMatchObject({ publisher: { id: house.id, name: 'Public House' } });
    expect((two.data.writer as Record<string, unknown>).publisher).not.toHaveProperty('taxId');
    for (const leaked of ['ada@private.example', 'TAX-SECRET-1', 'TAX-SECRET-2', hiddenAgent.id]) {
      expect(JSON.stringify(two)).not.toContain(leaked);
    }

    // Populating through the target's non-public relation leaves it out entirely (not even its ID).
    const throughHidden = await read('populate=writer.agent');
    expect(throughHidden.data.writer).not.toHaveProperty('agent');
    for (const leaked of ['Hidden Agency', 'TAX-SECRET-2', hiddenAgent.id]) {
      expect(JSON.stringify(throughHidden)).not.toContain(leaked);
    }

    // Relation paths are not filter or sort targets, so a hidden target field is never an oracle: the
    // answer is the same 400 for public and non-public target fields.
    for (const [hidden, visible] of [
      ['filters[writer.email][$eq]=ada@private.example', 'filters[writer.name][$eq]=Ada'],
      ['filters[writer][email][$eq]=ada@private.example', 'filters[writer][name][$eq]=Ada'],
      ['sort=writer.email:asc', 'sort=writer.name:asc'],
    ] as const) {
      const hiddenResponse = await deliver(`/api/content/stories?${hidden}`, {}, reader);
      const visibleResponse = await deliver(`/api/content/stories?${visible}`, {}, reader);
      expect(hiddenResponse.statusCode, hidden).toBe(400);
      expect(visibleResponse.statusCode, visible).toBe(400);
      expect(hiddenResponse.json<{ error: { code: string } }>().error.code).toBe(
        visibleResponse.json<{ error: { code: string } }>().error.code,
      );
    }
  });

  it('denies anonymous callers and tokens without a grant', async () => {
    expect((await deliver('/api/content/articles', {}, null)).statusCode).toBe(401);
    const other = await createDeliveryToken(database.current.db, [{ modelId: author.definition.id }]);
    expect((await deliver('/api/content/articles', {}, other)).statusCode).toBe(403);
    expect((await deliver('/api/content/nope')).statusCode).toBe(404);
  });

  it('sends validators and cache headers', async () => {
    const first = expectStatus(await deliver('/api/content/articles'), 200);
    expect(first.headers.vary).toBe('Authorization, Cookie, Shapio-Site');
    expect(first.headers['cache-control']).toContain('private');
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect((await deliver('/api/content/articles', { headers: { 'if-none-match': etag } })).statusCode).toBe(
      304,
    );
    const entry = await create('article', { title: 'Changes the list' });
    await publish('article', entry.id);
    expect((await deliver('/api/content/articles', { headers: { 'if-none-match': etag } })).statusCode).toBe(
      200,
    );
  });

  it('reads a consistent past moment with ?snapshot=N', async () => {
    const entry = await create('article', { title: 'Snap v1' });
    await publish('article', entry.id);
    const atV1 = expectStatus(
      await deliver('/api/content/articles?filters[title][$startsWith]=Snap'),
      200,
    ).json<DeliveryList>();
    const seq = atV1.meta.snapshot;
    expect(atV1.data.map((item) => item.title)).toEqual(['Snap v1']);

    const current = (await admin.get(`/api/admin/content/article/${entry.id}`)).json<EntryBody>();
    await save('article', current, { title: 'Snap v2' });
    await publish('article', entry.id);
    const extra = await create('article', { title: 'Snap extra' });
    await publish('article', extra.id);

    const now = expectStatus(
      await deliver('/api/content/articles?filters[title][$startsWith]=Snap&sort=title:asc'),
      200,
    ).json<DeliveryList>();
    expect(now.data.map((item) => item.title)).toEqual(['Snap extra', 'Snap v2']);
    const past = expectStatus(
      await deliver(`/api/content/articles?filters[title][$startsWith]=Snap&snapshot=${seq}`),
      200,
    ).json<DeliveryList>();
    expect(past.meta.snapshot).toBe(seq);
    expect(past.data.map((item) => item.title)).toEqual(['Snap v1']);
    expect(
      expectStatus(await deliver(`/api/content/articles/${entry.id}?snapshot=${seq}`), 200).json(),
    ).toMatchObject({
      data: { title: 'Snap v1' },
    });

    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/unpublish`, {}), 200);
    expect((await deliver(`/api/content/articles/${entry.id}`)).statusCode).toBe(404);
    expect((await deliver(`/api/content/articles/${entry.id}?snapshot=${seq}`)).statusCode).toBe(200);
    expect(
      (await deliver(`/api/content/articles?snapshot=${now.meta.snapshot + 1000}`)).json(),
    ).toMatchObject({
      error: { code: 'SNAPSHOT_INVALID' },
    });
  });

  it('counts only live entries in list totals: deleted ones never, unpublished ones only as drafts', async () => {
    const tally = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'tally',
      label: 'Tally',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const tallyToken = await createDeliveryToken(database.current.db, [{ modelId: tally.definition.id }]);
    const [kept, deleted, unpublished] = await Promise.all(
      ['kept', 'deleted', 'unpublished'].map((title) => create('tally', { title })),
    );
    for (const entry of [kept, deleted, unpublished]) {
      await publish('tally', entry!.id);
    }
    await create('tally', { title: 'draft only' });
    expect((await admin.delete(`/api/admin/content/tally/${deleted!.id}`)).statusCode).toBe(204);
    expectStatus(await admin.post(`/api/admin/content/tally/${unpublished!.id}/unpublish`, {}), 200);

    const delivered = expectStatus(
      await deliver('/api/content/tallies', {}, tallyToken),
      200,
    ).json<DeliveryList>();
    expect(delivered.data.map((entry) => entry.title)).toEqual(['kept']);
    expect(delivered.meta.pagination.total).toBe(1);
    const listed = expectStatus(await admin.get('/api/admin/content/tally'), 200).json<{
      items: Array<{ data: { title: string } }>;
      pagination: { total: number };
    }>();
    expect(listed.items.map((item) => item.data.title).sort()).toEqual(['draft only', 'kept', 'unpublished']);
    expect(listed.pagination.total).toBe(3);
  });

  it('renders rich text to sanitized HTML, selects fields and paginates', async () => {
    const entry = await create('article', {
      title: 'Rich',
      views: 7,
      body: {
        format: 'shapio-richtext',
        version: 1,
        doc: {
          type: 'doc',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '<script>x</script>' }] },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'link',
                  marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }],
                },
              ],
            },
          ],
        },
      },
    });
    await publish('article', entry.id);
    const body = expectStatus(
      await deliver(`/api/content/articles/${entry.id}?fields=title,body`),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>();
    expect(Object.keys(body.data).sort()).toEqual([
      'body',
      'createdAt',
      'id',
      'locale',
      'publishedAt',
      'title',
      'updatedAt',
    ]);
    expect((body.data.body as { html: string }).html).toBe(
      '<h2>&lt;script&gt;x&lt;/script&gt;</h2><p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">link</a></p>',
    );
    // Sorting follows PostgreSQL's NULL order (last ascending, first descending) so the field's index serves it.
    const page = expectStatus(
      await deliver('/api/content/articles?pageSize=2&page=1&sort=views:desc&filters[views][$notNull]=true'),
      200,
    ).json<DeliveryList>();
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.title).toBe('Rich');
    expect(page.meta.pagination.total).toBe(2);
    expect((await deliver('/api/content/articles?pageSize=1000')).statusCode).toBe(400);
  });
});
