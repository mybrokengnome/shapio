import { getIntrospectionQuery } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import { createAdmin, login, nextTestIp, toSession } from './helpers/adminIdentity.js';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV, toRestShape } from './helpers/graphql.js';
import { createPng, uploadAsset } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ModelPayload = {
  definition: Record<string, unknown> & { fields: Array<Record<string, unknown>> };
  version: number;
};

const LISTENING = /^Server listening at (http:\/\/127\.0\.0\.1:\d+)$/;

/** The GraphQL schema itself: live regeneration, limits, introspection, masking, mutations, structure. */
describe('GraphQL schema and runtime', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let reader: string;

  const bearer = (token: string | null): Record<string, string> =>
    token ? { authorization: `Bearer ${token}` } : {};
  const gql = <T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    token: string | null = reader,
  ) => graphql<T>(testApp.app, query, { ...(variables ? { variables } : {}), headers: bearer(token) });
  const getModel = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/models/${id}`), 200).json<ModelPayload>();
  const updateModel = async (
    id: string,
    change: (definition: ModelPayload['definition']) => ModelPayload['definition'],
  ) => {
    const current = await getModel(id);
    return expectStatus(
      await admin.put(`/api/admin/models/${id}`, {
        definition: change(current.definition),
        expectedVersion: current.version,
        acknowledgeBreaking: true,
      }),
      200,
    );
  };
  const create = async (modelKey: string, data: Record<string, unknown>, locale?: string) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, ...(locale ? { locale } : {}) }),
      201,
    ).json<EntryBody>();
  const publish = async (modelKey: string, id: string, locales?: string[]) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, locales ? { locales } : {}),
      200,
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    // Reads every model, including those created later in this file.
    reader = await createDeliveryToken(database.current.db, [{ modelId: null }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('reflects a new field, a new model and an API-key rename without a restart; cached plans never serve a stale shape', async () => {
    const before = dataOf(await gql<{ _schemaVersion: number }>('{ _schemaVersion }'))._schemaVersion;
    const event = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'event',
      label: 'Event',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const entry = await create('event', { title: 'Launch' });
    await publish('event', entry.id);
    const byTitle = '{ events { nodes { title } } }';
    // Twice: the second run is served from the parsed-and-validated document cache.
    for (let run = 0; run < 2; run += 1) {
      expect(dataOf(await gql(byTitle))).toEqual({ events: { nodes: [{ title: 'Launch' }] } });
    }

    await updateModel(event.definition.id, (definition) => ({
      ...definition,
      fields: [...definition.fields, { apiKey: 'venue', label: 'Venue', type: 'string' }],
    }));
    expect(dataOf(await gql('{ events { nodes { title venue } } }'))).toEqual({
      events: { nodes: [{ title: 'Launch', venue: null }] },
    });

    await updateModel(event.definition.id, (definition) => ({
      ...definition,
      fields: definition.fields.map((field) =>
        field.apiKey === 'title' ? { ...field, apiKey: 'name' } : field,
      ),
    }));
    const stale = await gql(byTitle);
    expect(stale.statusCode).toBe(400);
    expect(errorCodes(stale)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    expect(stale.body.errors?.[0]?.message).toContain('title');
    expect(dataOf(await gql('{ events { nodes { name } } }'))).toEqual({
      events: { nodes: [{ name: 'Launch' }] },
    });

    expect(errorCodes(await gql('{ speakers { totalCount } }'))).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'speaker',
      label: 'Speaker',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    expect(dataOf(await gql('{ speakers { totalCount } }'))).toEqual({
      speakers: { totalCount: 0 },
    });
    expect(
      dataOf(await gql<{ _schemaVersion: number }>('{ _schemaVersion }'))._schemaVersion,
    ).toBeGreaterThan(before);
  });

  describe('a second instance with schema notifications disabled', () => {
    let second: SpawnedProcess;
    let secondUrl: string;

    const onSecond = async (query: string) => {
      const response = await fetch(`${secondUrl}/api/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(reader) },
        body: JSON.stringify({ query }),
      });
      return {
        status: response.status,
        body: (await response.json()) as { data?: unknown; errors?: unknown[] },
      };
    };

    beforeAll(async () => {
      second = spawnTsProcess('test/fixtures/schemaServer.ts', {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'info',
        DATABASE_URL: database.current.url,
        MIGRATE_ON_START: 'false',
        SCHEMA_LISTEN: 'false',
        GRAPHQL_ENABLED: 'true',
      });
      const line = await second.waitForLog(
        (entry) => typeof entry.msg === 'string' && LISTENING.test(entry.msg),
      );
      secondUrl = LISTENING.exec(line.msg ?? '')?.[1] ?? '';
    });
    afterAll(async () => {
      await second?.stop();
    });

    it('serves a model created on the first instance, with no notification and no restart', async () => {
      // Warm the second instance's GraphQL schema first.
      expect((await onSecond('{ _schemaVersion }')).status).toBe(200);
      expect((await onSecond('{ venues { totalCount } }')).status).toBe(400);
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'venue',
        label: 'Venue',
        fields: [{ apiKey: 'city', label: 'City', type: 'string' }],
      });
      const entry = await create('venue', { city: 'Lisbon' });
      await publish('venue', entry.id);
      const pid = second.pid;
      expect(await onSecond('{ venues { nodes { city } } }')).toEqual({
        status: 200,
        body: { data: { venues: { nodes: [{ city: 'Lisbon' }] } } },
      });
      expect(second.pid).toBe(pid);
      expect(second.child.exitCode).toBeNull();
    });
  });

  it('resolves masked optional fields to null and masked required fields to a FORBIDDEN_FIELD error', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'ticket',
      label: 'Ticket',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'internalNote', label: 'Internal note', type: 'string', public: false },
        { apiKey: 'code', label: 'Code', type: 'string', required: true, public: false },
      ],
    });
    const entry = await create('ticket', { title: 'T', internalNote: 'n', code: 'C-1' });
    await publish('ticket', entry.id);
    const result = await gql('{ tickets { nodes { title internalNote code } } }');
    expect(result.statusCode).toBe(200);
    expect(result.body.data).toEqual({
      tickets: { nodes: [{ title: 'T', internalNote: null, code: null }] },
    });
    expect(result.body.errors).toHaveLength(1);
    expect(result.body.errors?.[0]?.path).toEqual(['tickets', 'nodes', 0, 'code']);
    expect(result.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN_FIELD');
    // An admin principal sees both.
    const asAdmin = dataOf(await gql('{ tickets { nodes { internalNote code } } }', undefined, adminToken));
    expect(asAdmin).toEqual({ tickets: { nodes: [{ internalNote: 'n', code: 'C-1' }] } });
  });

  it('enforces the depth and complexity limits (introspection is exempt)', async () => {
    const node = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'folder',
      label: 'Folder',
      fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
    });
    await updateModel(node.definition.id, (definition) => ({
      ...definition,
      fields: [
        ...definition.fields,
        {
          apiKey: 'parent',
          label: 'Parent',
          type: 'relation',
          settings: { target: node.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'children',
          label: 'Children',
          type: 'relation',
          settings: { target: node.definition.id, cardinality: 'many' },
        },
      ],
    }));
    const nest = (levels: number): string => (levels === 0 ? 'id' : `parent { ${nest(levels - 1)} }`);
    expect((await gql(`{ folders { nodes { ${nest(7)} } } }`)).body.errors).toBeUndefined();
    const deep = await gql(`{ folders { nodes { ${nest(9)} } } }`);
    expect(deep.statusCode).toBe(400);
    expect(errorCodes(deep)).toEqual(['QUERY_TOO_DEEP']);

    const wide = await gql(
      '{ folders(pageSize: 100) { nodes { children { children { children { id label } } } } } }',
    );
    expect(wide.statusCode).toBe(400);
    expect(errorCodes(wide)).toEqual(['QUERY_TOO_COMPLEX']);
    expect(
      (await gql('{ folders(pageSize: 100) { nodes { children { id label } } } }')).body.errors,
    ).toBeUndefined();
    // Through a variable without a default, the page size counts as the maximum.
    const variable = await gql(
      'query ($n: Int) { folders(pageSize: $n) { nodes { children { children { id label } } } } }',
      { n: 1 },
    );
    expect(errorCodes(variable)).toEqual(['QUERY_TOO_COMPLEX']);

    const introspection = await gql(getIntrospectionQuery());
    expect(introspection.statusCode).toBe(200);
    expect(introspection.body.errors).toBeUndefined();
  });

  it('allows introspection for admins and API tokens; anonymous callers only when configured', async () => {
    const query = '{ __schema { queryType { name } } }';
    expect(dataOf(await gql(query))).toEqual({ __schema: { queryType: { name: 'Query' } } });
    expect(dataOf(await gql(query, undefined, adminToken))).toEqual({
      __schema: { queryType: { name: 'Query' } },
    });
    const anonymous = await gql(query, undefined, null);
    expect(anonymous.statusCode).toBe(403);
    expect(errorCodes(anonymous)).toEqual(['INTROSPECTION_DISABLED']);
    expect(
      errorCodes(
        await gql('query { ...Q } fragment Q on Query { __type(name: "Query") { name } }', undefined, null),
      ),
    ).toEqual(['INTROSPECTION_DISABLED']);
    // Nor do validation errors suggest schema members to callers who may not introspect.
    const typo = '{ tickets { nodes { internalNot } } }';
    expect((await gql(typo, undefined, null)).body.errors?.[0]?.message).not.toContain('Did you mean');
    expect((await gql(typo)).body.errors?.[0]?.message).toContain('Did you mean "internalNote"?');
    // __typename is not introspection.
    expect(dataOf(await gql('{ __typename }', undefined, null))).toEqual({ __typename: 'Query' });

    const open = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, GRAPHQL_PUBLIC_INTROSPECTION: 'true' },
    });
    try {
      expect(dataOf(await graphql(open.app, query))).toEqual({ __schema: { queryType: { name: 'Query' } } });
    } finally {
      await open.app.close();
    }
  });

  it('creates, updates and publishes through GraphQL; delivery sees the result only after publishing', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    });
    const restList = async () =>
      expectStatus(
        await testApp.app.inject({ method: 'GET', url: '/api/content/notes', headers: bearer(reader) }),
        200,
      ).json<{
        data: Array<Record<string, unknown>>;
      }>().data;
    const created = dataOf(
      await gql<{ createNote: { id: string; version: number; status: string } }>(
        'mutation ($data: NoteInput) { createNote(data: $data) { id version status } }',
        { data: { title: 'First', body: 'Hello' } },
        adminToken,
      ),
    ).createNote;
    expect(created).toMatchObject({ version: 1, status: 'draft' });
    expect(await restList()).toEqual([]);
    expect(dataOf(await gql('{ notes { totalCount } }'))).toEqual({
      notes: { totalCount: 0 },
    });

    const updated = dataOf(
      await gql<{ updateNote: { version: number } }>(
        'mutation ($id: ID!) { updateNote(id: $id, expectedVersion: 1, data: { body: "Hello again" }) { version } }',
        { id: created.id },
        adminToken,
      ),
    ).updateNote;
    expect(updated.version).toBe(2);
    expect(await restList()).toEqual([]);
    // An admin may preview the draft; it carries no publication time.
    expect(
      dataOf(
        await gql(
          'query ($id: ID!) { note(id: $id, publicationState: DRAFT) { title body publishedAt } }',
          { id: created.id },
          adminToken,
        ),
      ),
    ).toEqual({ note: { title: 'First', body: 'Hello again', publishedAt: null } });
    expect(
      errorCodes(
        await gql('query ($id: ID!) { note(id: $id, publicationState: DRAFT) { title } }', {
          id: created.id,
        }),
      ),
    ).toEqual(['DRAFTS_FORBIDDEN']);

    const published = dataOf(
      await gql<{ publishNote: { status: string } }>(
        'mutation ($id: ID!) { publishNote(id: $id) { status publishedAt } }',
        { id: created.id },
        adminToken,
      ),
    ).publishNote;
    expect(published.status).toBe('published');
    const delivered = await restList();
    expect(delivered).toEqual([
      expect.objectContaining({ id: created.id, title: 'First', body: 'Hello again' }),
    ]);
    expect(
      dataOf(await gql('{ notes { nodes { id locale createdAt updatedAt publishedAt title body } } }')),
    ).toEqual({
      notes: { nodes: delivered },
    });
    // Validation errors come back with REST's code and details.
    const invalid = await gql(
      'mutation { createNote(data: { body: "no title" }) { id } }',
      undefined,
      adminToken,
    );
    expect(errorCodes(invalid)).toEqual([expect.stringMatching(/^[A-Z_]+$/)]);
    expect(invalid.body.data).toEqual({ createNote: null });

    dataOf(
      await gql('mutation ($id: ID!) { unpublishNote(id: $id) { status } }', { id: created.id }, adminToken),
    );
    expect(await restList()).toEqual([]);
    expect(
      dataOf(await gql('mutation ($id: ID!) { deleteNote(id: $id) }', { id: created.id }, adminToken)),
    ).toEqual({
      deleteNote: created.id,
    });
  });

  it('serves localized entries per locale with fallback and localizations, like REST', async () => {
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    expectStatus(await admin.post('/api/admin/locales', { code: 'de', label: 'German' }), 201);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      localized: true,
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', localized: true },
        { apiKey: 'price', label: 'Price', type: 'integer' },
      ],
    });
    // Beyond GraphQL's 32-bit Int: Int53 carries every integer Shapio stores, identical to REST.
    const entry = await create('product', { name: 'Chair', price: 9_007_199_254_740_991 }, 'en');
    expectStatus(
      await admin.put(`/api/admin/content/product/${entry.id}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { name: 'Chaise' },
      }),
      200,
    );
    await publish('product', entry.id, ['en', 'fr']);
    const fields = 'id locale createdAt updatedAt publishedAt name price';
    for (const locale of ['en', 'fr', 'de']) {
      const rest = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: `/api/content/products?locale=${locale}`,
          headers: bearer(reader),
        }),
        200,
      ).json<{ data: unknown[] }>();
      const viaGraphql = dataOf(
        await gql<{ products: { nodes: unknown[]; locale: string } }>(
          `query ($l: String) { products(locale: $l) { locale nodes { ${fields} } } }`,
          { l: locale },
        ),
      ).products;
      expect(viaGraphql.nodes, locale).toEqual(rest.data);
      expect(viaGraphql.locale).toBe(locale);
    }
    expect(
      dataOf(await gql('{ products(filter: { price: { eq: 9007199254740991 } }) { totalCount } }')),
    ).toEqual({ products: { totalCount: 1 } });
    const noFallback = dataOf(
      await gql('query ($id: ID!) { product(id: $id, locale: "de", fallback: false) { name } }', {
        id: entry.id,
      }),
    );
    expect(noFallback).toEqual({ product: null });
    const french = dataOf(
      await gql<{
        product: { locale: string; name: string; localizations: Array<{ locale: string; name: string }> };
      }>(
        'query ($id: ID!) { product(id: $id, locale: "fr") { locale name localizations { locale name } } }',
        { id: entry.id },
      ),
    );
    expect(french.product).toEqual({
      locale: 'fr',
      name: 'Chaise',
      localizations: [{ locale: 'en', name: 'Chair' }],
    });
  });

  it("exposes components, dynamic zones, enums, JSON and media in REST's shape", async () => {
    const headers = { authorization: `Bearer ${adminToken}` };
    const image = await uploadAsset(testApp.app, headers, {
      file: await createPng(8, 8),
      filename: 'p.png',
      mimeType: 'image/png',
    });
    const hero = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'image', label: 'Image', type: 'media' },
        ],
      },
      'components',
    );
    const quote = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'quote',
        label: 'Quote',
        fields: [{ apiKey: 'text', label: 'Text', type: 'text' }],
      },
      'components',
    );
    const link = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'link',
        label: 'Link',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'href', label: 'Href', type: 'url' },
        ],
      },
      'components',
    );
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'landing',
      label: 'Landing',
      fields: [
        {
          apiKey: 'tone',
          label: 'Tone',
          type: 'enum',
          settings: {
            values: [
              { value: 'calm', label: 'Calm' },
              { value: 'loud', label: 'Loud' },
            ],
          },
        },
        {
          apiKey: 'tags',
          label: 'Tags',
          type: 'enum',
          settings: {
            multiple: true,
            values: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
          },
        },
        { apiKey: 'meta', label: 'Meta', type: 'json' },
        {
          apiKey: 'links',
          label: 'Links',
          type: 'component',
          settings: { component: link.definition.id, repeatable: true },
        },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'dynamiczone',
          settings: { components: [hero.definition.id, quote.definition.id] },
        },
      ],
    });
    const created = dataOf(
      await gql<{ createLanding: { id: string } }>(
        'mutation ($data: LandingInput) { createLanding(data: $data, publish: true) { id } }',
        {
          data: {
            tone: 'loud',
            tags: ['a', 'b'],
            meta: { nested: [1, 2] },
            links: [{ label: 'Docs', href: 'https://example.com/docs' }],
            sections: [{ hero: { heading: 'Welcome', image: image.id } }, { quote: { text: 'Ship it' } }],
          },
        },
        adminToken,
      ),
    ).createLanding;
    const rest = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/landings/${created.id}`,
        headers: bearer(reader),
      }),
      200,
    ).json<{ data: Record<string, unknown> }>();
    const media =
      'id filename mimeType sizeBytes width height alt caption focalPoint { x y } url urlExpiresAt variants { name width height format mimeType url }';
    const viaGraphql = dataOf(
      await gql<{ landing: unknown }>(
        `query ($id: ID!) { landing(id: $id) {
          id locale createdAt updatedAt publishedAt tone tags meta
          links { label href }
          sections {
            __typename
            ... on Hero { heading image { ${media} } }
            ... on Quote { text }
          }
        } }`,
        { id: created.id },
      ),
    ).landing;
    expect(toRestShape(viaGraphql)).toEqual(rest.data);
    const [heroSection, quoteSection] = rest.data.sections as Array<Record<string, unknown>>;
    expect(heroSection).toMatchObject({ __component: 'hero', heading: 'Welcome', image: { id: image.id } });
    expect(quoteSection).toEqual({ __component: 'quote', text: 'Ship it' });
    const invalidZone = await gql(
      'mutation { createLanding(data: { sections: [{ hero: { heading: "x" }, quote: { text: "y" } }] }) { id } }',
      undefined,
      adminToken,
    );
    expect(errorCodes(invalidZone)).toEqual(['INVALID_INPUT']);
  });

  it('serves GraphiQL to admins only, from local assets', async () => {
    const session = await login(testApp.app, await createAdmin(database.current.db));
    const page = await testApp.app.inject({
      method: 'GET',
      url: '/api/graphql/playground',
      headers: session.headers,
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const scripts = [...page.body.matchAll(/src="([^"]+)"/g)].map((match) => match[1] as string);
    expect(scripts).toHaveLength(4);
    for (const src of scripts) {
      expect(src.startsWith('/api/graphql/playground/')).toBe(true);
      const asset = await testApp.app.inject({ method: 'GET', url: src, headers: session.headers });
      expect(asset.statusCode, src).toBe(200);
      expect(asset.headers['content-type']).toContain('javascript');
    }
    expect(page.body).not.toMatch(/https?:\/\//);
    expect((await testApp.app.inject({ method: 'GET', url: '/api/graphql/playground' })).statusCode).toBe(
      401,
    );
    expect(
      (await testApp.app.inject({ method: 'GET', url: '/api/graphql/playground', headers: bearer(reader) }))
        .statusCode,
    ).toBe(403);
  });

  it('points the playground at the site it is opened for (?site= on the endpoint)', async () => {
    const session = await login(testApp.app, await createAdmin(database.current.db));
    const page = (url: string) => testApp.app.inject({ method: 'GET', url, headers: session.headers });
    const forSite = await page('/api/graphql/playground?site=b');
    expect(forSite.statusCode).toBe(200);
    expect(forSite.body).toContain('data-endpoint="/api/graphql?site=b"');
    expect((await page('/api/graphql/playground')).body).toContain('data-endpoint="/api/graphql"');
    expect((await page('/api/graphql/playground?site=Not%20a%20key')).statusCode).toBe(400);
  });

  it("opens the playground on a query in the admin's theme (?query=, ?theme=)", async () => {
    const session = await login(testApp.app, await createAdmin(database.current.db));
    const page = (url: string) => testApp.app.inject({ method: 'GET', url, headers: session.headers });
    const prefilled = await page(
      '/api/graphql/playground?site=b&query=%7B%20_schemaVersion%20%7D&theme=light',
    );
    expect(prefilled.statusCode).toBe(200);
    expect(prefilled.body).toContain('data-endpoint="/api/graphql?site=b"');
    expect(prefilled.body).toContain('data-query="{ _schemaVersion }"');
    expect(prefilled.body).toContain('data-theme="light"');
    expect((await page('/api/graphql/playground?theme=blue')).statusCode).toBe(400);
  });

  it('documents GraphQL and its type mapping on the docs page', async () => {
    const page = await admin.get('/api/docs');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h2>GraphQL</h2>');
    // The page is the request site's; its links name that site.
    expect(page.body).toContain('<code>/api/graphql?site=default</code>');
    expect(page.body).toContain('href="/api/docs/openapi.json?site=default"');
    expect(page.body).toContain('Int53');
  });

  it('lives under BASE_PATH like every other route', async () => {
    const hosted = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, BASE_PATH: '/cms' },
    });
    try {
      const result = await graphql(hosted.app, '{ _schemaVersion }', {
        url: '/cms/api/graphql',
        headers: bearer(reader),
      });
      expect(result.statusCode).toBe(200);
      const user = await createAdmin(database.current.db);
      const session = toSession(
        await hosted.app.inject({
          method: 'POST',
          url: '/cms/api/admin/auth/login',
          remoteAddress: nextTestIp(),
          payload: { email: user.email, password: user.password },
        }),
      );
      const page = await hosted.app.inject({
        method: 'GET',
        url: '/cms/api/graphql/playground',
        headers: session.headers,
      });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('src="/cms/api/graphql/playground/graphiql.min.js"');
      expect(page.body).toContain('data-endpoint="/cms/api/graphql"');
      expect(page.body).toContain('data-csrf="/cms/api/admin/auth/csrf"');
    } finally {
      await hosted.app.close();
    }
  });

  describe('one schema per site', () => {
    const SITE_B = 'gql-b';
    /** The admin API on one site, as the admin token. */
    const onSite = (siteKey: string) => ({
      post: (url: string, payload: unknown) =>
        admin.request({
          method: 'POST',
          url,
          payload: payload as object,
          headers: { [SITE_HEADER]: siteKey },
        }),
    });
    /** A GraphQL request on one site (`Shapio-Site`), as the admin token unless told otherwise. */
    const gqlOn = <T = Record<string, unknown>>(
      siteKey: string,
      query: string,
      options: { token?: string | null; method?: 'GET' | 'POST'; variables?: Record<string, unknown> } = {},
    ) =>
      graphql<T>(testApp.app, query, {
        headers: {
          [SITE_HEADER]: siteKey,
          ...bearer(options.token === undefined ? adminToken : options.token),
        },
        ...(options.method ? { method: options.method } : {}),
        ...(options.variables ? { variables: options.variables } : {}),
      });
    const createOn = async (siteKey: string, definition: Record<string, unknown>, scope?: 'network') => {
      const created = await onSite(siteKey).post('/api/admin/models', {
        definition,
        ...(scope ? { scope } : {}),
      });
      expectStatus(created, 201);
    };
    const typeName = '{ __type(name: "Widget") { name } }';
    const rootFields = async (siteKey: string) =>
      dataOf(
        await gqlOn<{ __schema: { queryType: { fields: Array<{ name: string }> } } }>(
          siteKey,
          '{ __schema { queryType { fields { name } } } }',
        ),
      ).__schema.queryType.fields.map((field) => field.name);

    beforeAll(async () => {
      expectStatus(await admin.post('/api/admin/sites', { key: SITE_B, name: 'GraphQL B' }), 201);
      await createOn('default', {
        kind: 'collection',
        apiKey: 'gadget',
        label: 'Gadget',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      });
      await createOn(SITE_B, {
        kind: 'collection',
        apiKey: 'gadget',
        label: 'Gadget',
        fields: [{ apiKey: 'sku', label: 'SKU', type: 'string' }],
      });
      await createOn('default', {
        kind: 'collection',
        apiKey: 'widget',
        label: 'Widget',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
      await createOn(
        'default',
        {
          kind: 'collection',
          apiKey: 'brand',
          label: 'Brand',
          fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
        },
        'network',
      );
    });

    it('gives the same API ID on two sites each site its own fields', async () => {
      expectStatus(await onSite(SITE_B).post('/api/admin/content/gadget', { data: { sku: 'B-1' } }), 201);
      const onB = '{ gadgets(publicationState: DRAFT) { nodes { sku } } }';
      const onDefault = '{ gadgets(publicationState: DRAFT) { totalCount nodes { title } } }';
      expect(dataOf(await gqlOn(SITE_B, onB))).toEqual({ gadgets: { nodes: [{ sku: 'B-1' }] } });
      expect(dataOf(await gqlOn('default', onDefault))).toEqual({ gadgets: { totalCount: 0, nodes: [] } });
      // Each query is valid on one site only; a document validated (and cached) for one site's schema is
      // never reused for the other.
      for (const run of [1, 2]) {
        const wrongOnDefault = await gqlOn('default', onB);
        expect(wrongOnDefault.statusCode, `run ${run}`).toBe(400);
        expect(errorCodes(wrongOnDefault)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
        expect(errorCodes(await gqlOn(SITE_B, onDefault))).toEqual(['GRAPHQL_VALIDATION_FAILED']);
      }
    });

    it('leaves a site model out of another site’s schema and introspection; shared models are on both', async () => {
      expect(dataOf(await gqlOn('default', '{ widgets { totalCount } }'))).toEqual({
        widgets: { totalCount: 0 },
      });
      expect(errorCodes(await gqlOn(SITE_B, '{ widgets { totalCount } }'))).toEqual([
        'GRAPHQL_VALIDATION_FAILED',
      ]);
      expect(dataOf(await gqlOn('default', typeName))).toEqual({ __type: { name: 'Widget' } });
      expect(dataOf(await gqlOn(SITE_B, typeName))).toEqual({ __type: null });
      const defaultFields = await rootFields('default');
      const siteBFields = await rootFields(SITE_B);
      expect(defaultFields).toEqual(expect.arrayContaining(['widgets', 'gadgets', 'brands']));
      expect(siteBFields).toEqual(expect.arrayContaining(['gadgets', 'brands']));
      expect(siteBFields).not.toContain('widgets');
      for (const siteKey of ['default', SITE_B]) {
        expect(dataOf(await gqlOn(siteKey, '{ brands { totalCount } }'))).toEqual({
          brands: { totalCount: 0 },
        });
      }
    });

    it('pins the GraphQL-over-HTTP error contract and status codes', async () => {
      const envelope = (code: string) => ({
        data: null,
        errors: [
          expect.objectContaining({
            message: expect.any(String) as unknown,
            extensions: { code },
          }) as unknown,
        ],
      });

      const parse = await gqlOn('default', '{ widgets {');
      expect(parse.statusCode).toBe(400);
      expect(parse.body).toEqual(envelope('GRAPHQL_VALIDATION_FAILED'));
      expect(parse.body.errors?.[0]?.message).toContain('Syntax Error');

      const invalid = await gqlOn('default', '{ widgets { nope } }');
      expect(invalid.statusCode).toBe(400);
      expect(invalid.body).toEqual(envelope('GRAPHQL_VALIDATION_FAILED'));

      // A resolver error alongside data stays 200.
      const missing = await gqlOn(
        'default',
        'mutation { updateWidget(id: "00000000-0000-4000-8000-00000000abcd", expectedVersion: 1, data: { name: "x" }) { id } }',
      );
      expect(missing.statusCode).toBe(200);
      expect(missing.body.data).toEqual({ updateWidget: null });
      expect(missing.body.errors?.[0]?.path).toEqual(['updateWidget']);
      expect(missing.body.errors?.[0]?.extensions?.code).toEqual(expect.any(String));

      const overGet = await gqlOn(
        'default',
        'mutation { deleteWidget(id: "00000000-0000-4000-8000-00000000abcd") }',
        {
          method: 'GET',
        },
      );
      expect(overGet.statusCode).toBe(405);
      expect(overGet.response.headers.allow).toBe('POST');
      expect(overGet.body).toEqual(envelope('METHOD_NOT_ALLOWED'));

      const introspection = await gqlOn('default', '{ __schema { queryType { name } } }', { token: null });
      expect(introspection.statusCode).toBe(403);
      expect(introspection.body).toEqual(envelope('INTROSPECTION_DISABLED'));

      const twoOperations = await gqlOn('default', 'query A { __typename } query B { __typename }');
      expect(twoOperations.statusCode).toBe(400);
      expect(twoOperations.body.data).toBeNull();

      const unknownSite = await gqlOn('no-such-site', '{ __typename }');
      expect(unknownSite.statusCode).toBe(404);
      expect(unknownSite.body).toEqual(envelope('SITE_NOT_FOUND'));

      const badVariables = await testApp.app.inject({
        method: 'GET',
        url: `/api/graphql?${new URLSearchParams({ query: '{ __typename }', variables: '[1' }).toString()}`,
        headers: bearer(adminToken),
      });
      expect(badVariables.statusCode).toBe(400);
      expect(badVariables.json()).toEqual(envelope('BAD_REQUEST'));

      const noQuery = await testApp.app.inject({
        method: 'POST',
        url: '/api/graphql',
        headers: bearer(adminToken),
        payload: { variables: {} },
      });
      expect(noQuery.statusCode).toBe(400);
      expect(noQuery.json()).toEqual(envelope('VALIDATION_ERROR'));

      // Cookie sessions need the CSRF header on GET queries too.
      const owner = await login(testApp.app, await createAdmin(database.current.db));
      const cookieOnly = await graphql(testApp.app, '{ __typename }', {
        method: 'GET',
        headers: { cookie: owner.headers.cookie as string },
      });
      expect(cookieOnly.statusCode).toBe(403);
      expect(cookieOnly.body).toEqual(envelope('CSRF_INVALID'));

      // Success: data and no `errors` key.
      const ok = await gqlOn('default', '{ __typename }');
      expect(ok.statusCode).toBe(200);
      expect(ok.body).toEqual({ data: { __typename: 'Query' } });
    });
  });
});
