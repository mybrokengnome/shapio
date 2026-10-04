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
import {
  dataOf,
  errorCodes,
  expectSameEntries,
  graphql,
  GRAPHQL_ENV,
  toRestShape,
} from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: {
    snapshot: number;
    pagination: { total: number; page: number; pageSize: number; pageCount: number };
  };
};
type Connection = {
  nodes: Array<Record<string, unknown>>;
  totalCount: number;
  snapshot: number | null;
  pageInfo: { page: number; pageSize: number; pageCount: number; hasNextPage: boolean };
};

/** The fields REST returns for an article to a token that may not read `secret`. */
const ARTICLE_FIELDS =
  'id locale createdAt updatedAt publishedAt title views body { json html } author { id } related { id }';
const ID_RELATIONS = { idRelations: ['author', 'related'] };

/**
 * GraphQL twins of the delivery API tests (contentDelivery.int.test.ts): each scenario runs through REST and
 * GraphQL and asserts identical results after shape normalisation (test/helpers/graphql.ts).
 */
describe('GraphQL delivery (twins of the REST delivery tests)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let author: ModelBody;
  let token: string;

  const bearer = (value: string | null): Record<string, string> =>
    value ? { authorization: `Bearer ${value}` } : {};
  // REST twins ask for rich text as GraphQL selects it (`body { json html }`): the document and its HTML.
  const withBothRichText = (url: string) =>
    url.startsWith('/api/content/') && !url.includes('richText=')
      ? `${url}${url.includes('?') ? '&' : '?'}richText=both`
      : url;
  const deliver = (url: string, options: Partial<InjectOptions> = {}, as: string | null = token) =>
    testApp.app.inject({
      method: 'GET',
      url: withBothRichText(url),
      ...options,
      headers: { ...bearer(as), ...options.headers },
    });
  const gql = <T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    as: string | null = token,
  ) => graphql<T>(testApp.app, query, { ...(variables ? { variables } : {}), headers: bearer(as) });
  const restList = async (url: string, as: string | null = token) =>
    expectStatus(await deliver(url, {}, as), 200).json<DeliveryList>();
  const gqlList = async (args: string, variables?: Record<string, unknown>, as: string | null = token) =>
    dataOf(
      await gql<{ articles: Connection }>(
        `query ($filter: ArticleFilter, $sort: [ArticleSort!], $snapshot: Int) {
          articles(filter: $filter, sort: $sort, snapshot: $snapshot ${args}) {
            nodes { ${ARTICLE_FIELDS} } totalCount snapshot pageInfo { page pageSize pageCount hasNextPage }
          }
        }`,
        variables,
        as,
      ),
    ).articles;
  /** Runs both and asserts identical entries; returns the REST body. */
  const twinList = async (url: string, args: string, variables?: Record<string, unknown>) => {
    const rest = await restList(url);
    const connection = await gqlList(args, variables);
    expectSameEntries(connection.nodes, rest.data, ID_RELATIONS);
    expect(connection.totalCount).toBe(rest.meta.pagination.total);
    expect(connection.pageInfo).toMatchObject({
      page: rest.meta.pagination.page,
      pageSize: rest.meta.pagination.pageSize,
      pageCount: rest.meta.pagination.pageCount,
    });
    expect(connection.snapshot).toBe(rest.meta.snapshot);
    return rest;
  };
  const gqlArticle = async (id: string, fields = ARTICLE_FIELDS, extra = '', as: string | null = token) =>
    dataOf(
      await gql<{ article: Record<string, unknown> | null }>(
        `query ($id: ID!) { article(id: $id ${extra}) { ${fields} } }`,
        { id },
        as,
      ),
    ).article;
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
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
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
    await save('article', (await admin.get(`/api/admin/content/article/${live.id}`)).json<EntryBody>(), {
      title: 'Live v2 draft',
    });

    const list = await twinList('/api/content/articles', '');
    expect(list.data.map((entry) => entry.title)).toEqual(['Live v1']);
    const raw = await gqlList('');
    expect(JSON.stringify(raw)).not.toContain('Draft only');
    expect(JSON.stringify(raw)).not.toContain('Live v2 draft');

    expect((await deliver(`/api/content/articles/${draftOnly.id}`)).statusCode).toBe(404);
    expect(await gqlArticle(draftOnly.id)).toBeNull();

    for (const [url, filter] of [
      ['/api/content/articles?filters[title][$eq]=Live v2 draft', { title: { eq: 'Live v2 draft' } }],
      ['/api/content/articles?filters[title][$eq]=Draft only', { title: { eq: 'Draft only' } }],
      ['/api/content/articles?filters[title][$containsi]=draft', { title: { containsi: 'draft' } }],
      ['/api/content/articles?filters[title][$eq]=Live v1', { title: { eq: 'Live v1' } }],
    ] as const) {
      await twinList(url, '', { filter });
    }
    expect((await gqlList('', { filter: { title: { eq: 'Live v1' } } })).nodes).toHaveLength(1);
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

    const populatedFields = ARTICLE_FIELDS.replace(
      'author { id } related { id }',
      'author { id locale createdAt updatedAt publishedAt name } related { id locale createdAt updatedAt publishedAt name }',
    );
    const twin = async ({ authorPublished = false } = {}) => {
      const rest = expectStatus(
        await deliver(`/api/content/articles/${post.id}?populate=author,related`),
        200,
      ).json<{
        data: Record<string, unknown>;
      }>();
      const entry = await gqlArticle(post.id, populatedFields);
      expect(toRestShape(entry)).toEqual(rest.data);
      if (!authorPublished) {
        expect(JSON.stringify(entry)).not.toContain(draftAuthor.id);
      }
      return rest.data;
    };
    let data = await twin();
    expect(data.author).toBeNull();
    expect(data.related).toEqual([expect.objectContaining({ id: liveAuthor.id, name: 'Live author' })]);

    const unpopulated = expectStatus(await deliver(`/api/content/articles/${post.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(toRestShape(await gqlArticle(post.id), ID_RELATIONS)).toEqual(unpopulated.data);

    const current = (await admin.get(`/api/admin/content/article/${post.id}`)).json<EntryBody>();
    await save('article', current, { related: [liveAuthor.id], author: liveAuthor.id });
    data = await twin();
    expect(data.author).toBeNull();

    await publish('author', draftAuthor.id);
    data = await twin({ authorPublished: true });
    expect(data.author).toMatchObject({ id: draftAuthor.id, name: 'Unpublished author' });
  });

  it('hides non-public fields from delivery tokens and rejects filtering or sorting on them', async () => {
    const entry = await create('article', { title: 'Has secret', secret: 'classified' });
    await publish('article', entry.id);
    const rest = expectStatus(await deliver(`/api/content/articles/${entry.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(toRestShape(await gqlArticle(entry.id), ID_RELATIONS)).toEqual(rest.data);
    // Selecting the hidden (optional) field gives null, never the value.
    const hidden = await gql(`query ($id: ID!) { article(id: $id) { title secret } }`, { id: entry.id });
    expect(hidden.body).toEqual({ data: { article: { title: 'Has secret', secret: null } } });

    for (const [url, variables] of [
      ['/api/content/articles?filters[secret][$eq]=classified', { filter: { secret: { eq: 'classified' } } }],
      [
        '/api/content/articles?filters[$or][0][secret][$null]=true&filters[$or][1][title][$eq]=x',
        { filter: { or: [{ secret: { null: true } }, { title: { eq: 'x' } }] } },
      ],
      ['/api/content/articles?sort=secret:asc', null],
    ] as const) {
      const response = await deliver(url);
      expect(response.statusCode, url).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN_FIELD' } });
      if (variables) {
        const result = await gql(
          'query ($filter: ArticleFilter) { articles(filter: $filter) { totalCount } }',
          variables,
        );
        expect(errorCodes(result), url).toEqual(['FORBIDDEN_FIELD']);
        expect(result.body.data).toEqual({ articles: null });
      }
    }
    // `secret` is not sortable, so the sort input has no such key: GraphQL rejects it at validation.
    expect(errorCodes(await gql('{ articles(sort: [{ secret: ASC }]) { totalCount } }'))).toEqual([
      'GRAPHQL_VALIDATION_FAILED',
    ]);

    const named = await createDeliveryToken(database.current.db, [
      {
        modelId: article.definition.id,
        fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'secret')],
      },
    ]);
    const granted = expectStatus(await deliver(`/api/content/articles/${entry.id}`, {}, named), 200).json<{
      data: Record<string, unknown>;
    }>();
    const viaGraphql = await gqlArticle(
      entry.id,
      'id locale createdAt updatedAt publishedAt title secret',
      '',
      named,
    );
    expect(viaGraphql).toEqual(granted.data);
    expect(granted.data).not.toHaveProperty('views');
    expect(await gqlArticle(entry.id, 'views', '', named)).toEqual({ views: null });
  });

  it('hides non-public fields of relation targets at every depth, like REST populate', async () => {
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

    const rest = expectStatus(
      await deliver(`/api/content/stories/${tale.id}?populate=writer.publisher`, {}, reader),
      200,
    ).json<{ data: { writer: Record<string, unknown> } }>();
    const result = await gql(
      `query ($id: ID!) {
        story(id: $id) {
          title
          writer { id name email agent { id name taxId } publisher { id name taxId } }
        }
      }`,
      { id: tale.id },
      reader,
    );
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data).toEqual({
      story: {
        title: 'Tale',
        writer: {
          id: person.id,
          name: 'Ada',
          email: null,
          agent: null,
          publisher: { id: house.id, name: 'Public House', taxId: null },
        },
      },
    });
    expect(rest.data.writer).toMatchObject({
      name: 'Ada',
      publisher: { id: house.id, name: 'Public House' },
    });
    for (const leaked of [
      'ada@private.example',
      'TAX-SECRET-1',
      'TAX-SECRET-2',
      'Hidden Agency',
      hiddenAgent.id,
    ]) {
      expect(JSON.stringify(result.body), leaked).not.toContain(leaked);
    }

    // Relation targets are not filter or sort targets: the inputs have no relation sub-fields, so a hidden
    // target field cannot be probed, and the answer is the same as for a public one.
    for (const [hidden, visible] of [
      [
        '{ stories(filter: { writer: { email: { eq: "x" } } }) { totalCount } }',
        '{ stories(filter: { writer: { name: { eq: "Ada" } } }) { totalCount } }',
      ],
      [
        '{ stories(sort: [{ writer: { email: ASC } }]) { totalCount } }',
        '{ stories(sort: [{ writer: { name: ASC } }]) { totalCount } }',
      ],
    ] as const) {
      const hiddenResult = await gql(hidden, undefined, reader);
      const visibleResult = await gql(visible, undefined, reader);
      expect(errorCodes(hiddenResult), hidden).toEqual(['GRAPHQL_VALIDATION_FAILED']);
      expect(errorCodes(visibleResult), visible).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    }
  });

  it('denies anonymous callers and tokens without a grant', async () => {
    expect((await deliver('/api/content/articles', {}, null)).statusCode).toBe(401);
    expect(errorCodes(await gql('{ articles { totalCount } }', undefined, null))).toEqual([
      'UNAUTHENTICATED',
    ]);
    const other = await createDeliveryToken(database.current.db, [{ modelId: author.definition.id }]);
    expect((await deliver('/api/content/articles', {}, other)).statusCode).toBe(403);
    expect(errorCodes(await gql('{ articles { totalCount } }', undefined, other))).toEqual(['FORBIDDEN']);
    expect((await deliver('/api/content/nope')).statusCode).toBe(404);
    const unknown = await gql('{ nopes { totalCount } }');
    expect(unknown.statusCode).toBe(400);
    expect(errorCodes(unknown)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
  });

  it('sends validators and cache headers for GET queries', async () => {
    const query = '{ articles { totalCount nodes { id title } } }';
    const get = (headers: Record<string, string> = {}, as: string | null = token) =>
      graphql(testApp.app, query, { method: 'GET', headers: { ...bearer(as), ...headers } });
    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(first.response.headers.vary).toBe('Authorization, Cookie, Shapio-Site');
    expect(first.response.headers['cache-control']).toContain('private');
    const etag = first.response.headers.etag as string;
    expect(etag).toMatch(/^"[\w-]+"$/);
    const revalidated = await testApp.app.inject({
      method: 'GET',
      url: `/api/graphql?${new URLSearchParams({ query }).toString()}`,
      headers: { ...bearer(token), 'if-none-match': etag },
    });
    expect(revalidated.statusCode).toBe(304);
    const entry = await create('article', { title: 'Changes the list' });
    await publish('article', entry.id);
    expect((await get({ 'if-none-match': etag })).statusCode).toBe(200);
    // POST responses are never stored.
    const posted = await gql(query);
    expect(posted.response.headers['cache-control']).toBe('no-store');
  });

  it('reads a consistent past moment with snapshot', async () => {
    const entry = await create('article', { title: 'Snap v1' });
    await publish('article', entry.id);
    const startsWithSnap = { filter: { title: { startsWith: 'Snap' } } };
    const atV1 = await twinList('/api/content/articles?filters[title][$startsWith]=Snap', '', startsWithSnap);
    const seq = atV1.meta.snapshot;

    const current = (await admin.get(`/api/admin/content/article/${entry.id}`)).json<EntryBody>();
    await save('article', current, { title: 'Snap v2' });
    await publish('article', entry.id);
    const extra = await create('article', { title: 'Snap extra' });
    await publish('article', extra.id);

    const now = await twinList('/api/content/articles?filters[title][$startsWith]=Snap&sort=title:asc', '', {
      ...startsWithSnap,
      sort: [{ title: 'ASC' }],
    });
    expect(now.data.map((item) => item.title)).toEqual(['Snap extra', 'Snap v2']);
    const past = await twinList(
      `/api/content/articles?filters[title][$startsWith]=Snap&snapshot=${seq}`,
      '',
      {
        ...startsWithSnap,
        snapshot: seq,
      },
    );
    expect(past.data.map((item) => item.title)).toEqual(['Snap v1']);
    expect(await gqlArticle(entry.id, 'title', ', snapshot: $snapshot').catch(() => null)).toBeNull();
    const pinned = dataOf(
      await gql<{ article: { title: string } }>(
        'query ($id: ID!, $snapshot: Int) { article(id: $id, snapshot: $snapshot) { title } }',
        { id: entry.id, snapshot: seq },
      ),
    );
    expect(pinned.article).toEqual({ title: 'Snap v1' });

    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/unpublish`, {}), 200);
    expect(await gqlArticle(entry.id, 'title')).toBeNull();
    const stillPinned = dataOf(
      await gql<{ article: { title: string } }>(
        'query ($id: ID!, $snapshot: Int) { article(id: $id, snapshot: $snapshot) { title } }',
        { id: entry.id, snapshot: seq },
      ),
    );
    expect(stillPinned.article).toEqual({ title: 'Snap v1' });
    const future = await gql('query ($s: Int) { articles(snapshot: $s) { totalCount } }', {
      s: now.meta.snapshot + 1000,
    });
    expect(errorCodes(future)).toEqual(['SNAPSHOT_INVALID']);
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
    const rest = expectStatus(
      await deliver(`/api/content/articles/${entry.id}?fields=title,body`),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>();
    const selected = await gqlArticle(
      entry.id,
      'id locale createdAt updatedAt publishedAt title body { json html }',
    );
    expect(toRestShape(selected)).toEqual(rest.data);
    expect((selected?.body as { html: string }).html).toBe(
      '<h2>&lt;script&gt;x&lt;/script&gt;</h2><p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">link</a></p>',
    );
    const page = await twinList(
      '/api/content/articles?pageSize=2&page=1&sort=views:desc&filters[views][$notNull]=true',
      ', pageSize: 2, page: 1',
      { sort: [{ views: 'DESC' }], filter: { views: { notNull: true } } },
    );
    expect(page.data).toHaveLength(2);
    expect(page.data[0]?.title).toBe('Rich');
    expect((await deliver('/api/content/articles?pageSize=1000')).statusCode).toBe(400);
    expect(errorCodes(await gql('{ articles(pageSize: 1000) { totalCount } }'))).toEqual(['INVALID_QUERY']);
  });
});
