import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import * as permissionsVersionRepository from '../src/repositories/permissionsVersion.js';
import { GRAPHQL_LENS_SCHEMA_CACHE_SIZE } from '../src/schema/codegen/graphql/schemaCache.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Data = Record<string, unknown>;
type Node = Record<string, unknown>;
type Connection = { nodes: Node[]; totalCount: number };

/** A document written against the client's version: every name in it is one that version had. */
const OLD_LIST = `query Old($title: String) {
  articles(filter: { title: { eq: $title } }, sort: [{ title: ASC }]) {
    totalCount
    nodes {
      id
      title
      count
      price
      summary
      secret
      restricted
      hero { heading note }
      blocks { __typename ... on Hero { heading note } ... on Badge { label } }
      writer { id name }
    }
  }
  _schemaVersion
}`;

const OLD_ONE = `query One($id: ID!) {
  article(id: $id) { id title count price summary secret restricted hero { heading note } writer { name } }
}`;

const NARROW_ONE = 'query ($id: ID!) { article(id: $id) { title restricted } }';

/**
 * Schema lenses over GraphQL (plan schema-lenses, WP4): a request naming a schema version is validated and
 * executed against the workspace's GraphQL schema at that version, reads only, with today's visibility
 * (rule 7), from a separate bounded cache that never disturbs the current schema.
 */
describe('schema lenses: GraphQL', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let hero: ModelBody;
  let badge: ModelBody;
  let article: ModelBody;
  let gadget: ModelBody;
  let promo: ModelBody;
  let product: ModelBody;
  let featurableId: string;
  let token: string;
  let narrowRole: string;
  let narrowToken: string;
  let first: EntryBody;
  /** The schema version the old client was built against. */
  let v: string;
  let before: { list: Data; one: Data; narrow: Data };

  const headersOf = (credential: string, version?: string) => ({
    authorization: `Bearer ${credential}`,
    ...(version ? { 'shapio-schema-version': version } : {}),
  });
  const gql = (
    query: string,
    {
      credential = token,
      version,
      variables,
    }: { credential?: string; version?: string; variables?: Data } = {},
  ) =>
    graphql<Data>(testApp.app, query, {
      headers: headersOf(credential, version),
      ...(variables ? { variables } : {}),
    });
  const old = (query: string, options: { credential?: string; variables?: Data } = {}) =>
    gql(query, { ...options, version: v });
  const currentToken = async () =>
    expectStatus(
      await testApp.app.inject({ method: 'GET', url: '/api/snapshots/current', headers: headersOf(token) }),
      200,
    ).json<{ schemaVersionToken: string }>().schemaVersionToken;
  const createEntry = async (modelKey: string, data: Data, publish = true) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish }),
      201,
    ).json<EntryBody>();
  const reload = async (model: ModelBody, kind: 'models' | 'components') =>
    (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
  /** Applies a change to a definition and runs its jobs until it is live. */
  const change = async (
    model: ModelBody,
    update: (definition: ModelBody['definition']) => Data,
    kind: 'models' | 'components' = 'models',
  ) => {
    const current = await reload(model, kind);
    const response = await admin.put(`/api/admin/${kind}/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      throw new Error(
        `Changing ${current.definition.apiKey} failed: ${response.statusCode} ${response.body}`,
      );
    }
    await runContentSchemaJobs(database.current.db);
    return reload(model, kind);
  };
  const field = (definition: ModelBody['definition'], apiKey: string) =>
    definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
  const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({ ...rest, type, settings: {} });
  const nodesOf = (data: Data, key: string) => (data[key] as Connection).nodes;
  const fieldNames = async (typeName: string, version?: string) => {
    const data = dataOf(
      await gql('query ($name: String!) { __type(name: $name) { fields { name } } }', {
        ...(version ? { version } : {}),
        variables: { name: typeName },
      }),
    );
    const type = data.__type as { fields: Array<{ name: string }> } | null;
    return type ? type.fields.map(({ name }) => name) : null;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    hero = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string' },
        ],
      },
      'components',
    );
    badge = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'badge',
        label: 'Badge',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    const author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      pluralApiKey: 'articles',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
        { apiKey: 'count', label: 'Count', type: 'integer', filterable: true, required: true },
        { apiKey: 'price', label: 'Price', type: 'decimal' },
        { apiKey: 'summary', label: 'Summary', type: 'text', filterable: true, required: true },
        { apiKey: 'secret', label: 'Secret', type: 'string', required: true },
        { apiKey: 'restricted', label: 'Restricted', type: 'string' },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: hero.definition.id } },
        {
          apiKey: 'blocks',
          label: 'Blocks',
          type: 'dynamiczone',
          settings: { components: [hero.definition.id, badge.definition.id] },
        },
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    gadget = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'gadget',
      label: 'Gadget',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    promo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'promo',
      label: 'Promo',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const created = await admin.post('/api/admin/interfaces', {
      definition: {
        kind: 'interface',
        apiKey: 'featurable',
        pluralApiKey: 'featurables',
        label: 'Featurable',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    featurableId = created.json<{ definitionId: string }>().definitionId;
    const post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      implements: [featurableId],
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const models = [article, author, gadget, promo, product, post];
    token = await createTokenForRole(
      database.current.db,
      await createRole(
        database.current.db,
        'delivery',
        models.map((model) => ({ action: 'read' as const, modelId: model.definition.id })),
      ),
    );
    narrowRole = await createRole(database.current.db, 'delivery', [
      {
        action: 'read',
        modelId: article.definition.id,
        fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'restricted')],
      },
    ]);
    narrowToken = await createTokenForRole(database.current.db, narrowRole);

    const writer = await createEntry('author', { name: 'Ada' });
    first = await createEntry('article', {
      title: 'First',
      count: 3,
      price: '12.5',
      summary: 'One',
      secret: 'shh',
      restricted: 'r1',
      hero: { heading: 'Hi', note: 'private soon' },
      blocks: [
        { __component: 'hero', heading: 'Block hero', note: 'block note' },
        { __component: 'badge', label: 'New' },
      ],
      writer: writer.id,
    });
    await createEntry('article', {
      title: 'Second',
      count: 5,
      price: '2',
      summary: 'Two',
      secret: 'psst',
      writer: writer.id,
    });
    await createEntry('gadget', { name: 'Widget' });
    await createEntry('product', { name: 'Lamp' });
    await createEntry('post', { name: 'Featured' });

    v = await currentToken();
    before = {
      list: dataOf(await old(OLD_LIST)),
      one: dataOf(await old(OLD_ONE, { variables: { id: first.id } })),
      narrow: dataOf(await old(NARROW_ONE, { credential: narrowToken, variables: { id: first.id } })),
    };

    // Everything an old client must survive.
    hero = await change(
      hero,
      (definition) => ({
        ...definition,
        fields: [
          { ...field(definition, 'heading'), apiKey: 'title' },
          { ...field(definition, 'note'), public: false },
        ],
      }),
      'components',
    );
    badge = await change(
      badge,
      (definition) => ({ ...definition, fields: [{ ...field(definition, 'label'), apiKey: 'text' }] }),
      'components',
    );
    article = await change(article, (definition) => ({
      ...definition,
      apiKey: 'story',
      pluralApiKey: 'stories',
      label: 'Story',
      fields: [
        { ...field(definition, 'writer') },
        { ...field(definition, 'title'), apiKey: 'headline' },
        retype(field(definition, 'count'), 'string'),
        retype(field(definition, 'price'), 'number'),
        { ...field(definition, 'secret'), public: false },
        { ...field(definition, 'restricted') },
        { ...field(definition, 'hero') },
        { ...field(definition, 'blocks') },
        { apiKey: 'subtitle', label: 'Subtitle', type: 'string', required: true, defaultValue: 'Sub' },
      ],
    }));
    expectStatus(
      await admin.delete(
        `/api/admin/models/${gadget.definition.id}?expectedVersion=${gadget.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
    promo = await change(promo, (definition) => ({
      ...definition,
      kind: 'singleton',
      pluralApiKey: undefined,
    }));
    // Kinds and members the old version does not know.
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'lampshade',
      label: 'Lampshade',
      extends: product.definition.id,
      fields: [{ apiKey: 'shade', label: 'Shade', type: 'string' }],
    });
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'newcomer',
      label: 'Newcomer',
      implements: [featurableId],
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    await createEntry('lampshade', { name: 'Shade', shade: 'red' });
    await createEntry('newcomer', { name: 'Newcomer entry' });
    // The narrow role loses `restricted` since the client's version.
    await database.current.db.transaction().execute(async (trx) => {
      await adminRolesRepository.deletePermissionsForRole(narrowRole, trx);
      await adminRolesRepository.insertPermissions(
        [
          {
            role_id: narrowRole,
            action: 'read',
            model_id: article.definition.id,
            condition: null,
            field_ids: [fieldIdOf(article, 'headline')],
          },
        ],
        trx,
      );
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('runs an old document unchanged: old names, converted values, nulls for what is gone or hidden', async () => {
    // What the old client saw at its version (so the nulls below are real changes).
    expect(JSON.stringify(before.list)).toMatch(/shh[\s\S]*private soon[\s\S]*block note/);
    const result = await old(OLD_LIST);
    const data = dataOf(result);
    const expected = nodesOf(before.list, 'articles').map((node) => ({
      ...node,
      summary: null,
      secret: null,
      hero: node.hero ? { ...(node.hero as Node), note: null } : null,
      blocks: (node.blocks as Node[]).map((block) => ('note' in block ? { ...block, note: null } : block)),
    }));
    expect(nodesOf(data, 'articles')).toEqual(expected);
    expect(nodesOf(data, 'articles')[0]).toMatchObject({
      title: 'First',
      count: 3,
      price: '12.5',
      hero: { heading: 'Hi', note: null },
      blocks: [
        { __typename: 'Hero', heading: 'Block hero', note: null },
        { __typename: 'Badge', label: 'New' },
      ],
      writer: { name: 'Ada' },
    });
    expect(JSON.stringify(data)).not.toMatch(/shh|psst|private soon|block note|headline|subtitle/);
    // `_schemaVersion` stays an Int and reports the version the client named.
    expect(data._schemaVersion).toBe(Number(v.split(':')[1]));
    const now = await currentToken();
    expect(result.body).toMatchObject({ extensions: { schemaVersion: { requested: v, current: now } } });
    expect(result.response.headers['shapio-schema-version-current']).toBe(now);
    expect(String(result.response.headers.vary)).toContain('Shapio-Schema-Version');

    const one = dataOf(await old(OLD_ONE, { variables: { id: first.id } }));
    expect(one.article).toEqual({
      ...(before.one.article as Node),
      summary: null,
      secret: null,
      hero: { heading: 'Hi', note: null },
    });
  });

  it('answers today’s clients in today’s shape', async () => {
    const data = dataOf(
      await gql(
        '{ stories(sort: [{ headline: ASC }]) { nodes { headline count price subtitle } } _schemaVersion }',
      ),
    );
    expect(nodesOf(data, 'stories')[0]).toMatchObject({
      headline: 'First',
      count: '3',
      price: 12.5,
      subtitle: 'Sub',
    });
    expect(errorCodes(await gql('{ articles { totalCount } }'))).toEqual(['GRAPHQL_VALIDATION_FAILED']);
  });

  it('shows the old version’s types and fields in introspection', async () => {
    const articleFields = await fieldNames('Article', v);
    expect(articleFields).toEqual(expect.arrayContaining(['title', 'count', 'summary', 'secret', 'hero']));
    expect(articleFields).not.toContain('headline');
    expect(articleFields).not.toContain('subtitle');
    expect(await fieldNames('Story', v)).toBeNull();
    expect(await fieldNames('Hero', v)).toEqual(['heading', 'note']);
    expect(await fieldNames('Story')).toContain('headline');
    // Reads only: no mutation type through a lens.
    const mutation = dataOf(await gql('{ __schema { mutationType { name } } }', { version: v }));
    expect(mutation).toEqual({ __schema: { mutationType: null } });
  });

  it('takes filters and sorts in the old names and refuses those the lens cannot answer', async () => {
    const filtered = dataOf(await old(OLD_LIST, { variables: { title: 'Second' } }));
    expect(nodesOf(filtered, 'articles').map((node) => node.title)).toEqual(['Second']);
    const sorted = dataOf(await old('{ articles(sort: [{ title: DESC }]) { nodes { title } } }'));
    expect(nodesOf(sorted, 'articles').map((node) => node.title)).toEqual(['Second', 'First']);
    for (const filter of ['{ count: { eq: 3 } }', '{ summary: { eq: "One" } }']) {
      const refused = await old(`{ articles(filter: ${filter}) { nodes { id } } }`);
      expect(errorCodes(refused)).toEqual(['LENS_QUERY_UNSUPPORTED']);
      expect(refused.body.data).toEqual({ articles: null });
    }
  });

  it('reads deleted models as empty, refuses a kind change, and drops kinds and members added since', async () => {
    const gone = await old(
      `query ($id: ID!) { gadgets { totalCount nodes { id name } } gadget(id: $id) { id } }`,
      { variables: { id: first.id } },
    );
    expect(dataOf(gone)).toEqual({ gadgets: { totalCount: 0, nodes: [] }, gadget: null });
    const promoted = await old('{ promos { nodes { id } } }');
    expect(errorCodes(promoted)).toEqual(['LENS_UNCOVERED']);
    const kinds = dataOf(await old('{ products { nodes { __typename name } } }'));
    expect(nodesOf(kinds, 'products')).toEqual([{ __typename: 'Product', name: 'Lamp' }]);
    const members = dataOf(await old('{ featurables { nodes { __typename name } } }'));
    expect(nodesOf(members, 'featurables')).toEqual([{ __typename: 'Post', name: 'Featured' }]);
    // Today's clients see both (the admin token reads the new member too).
    const today = dataOf(await gql('{ featurables { nodes { name } } }', { credential: adminToken }));
    expect(nodesOf(today, 'featurables')).toHaveLength(2);
    const lensed = dataOf(await old('{ featurables { nodes { name } } }', { credential: adminToken }));
    expect(nodesOf(lensed, 'featurables')).toEqual([{ name: 'Featured' }]);
  });

  it('never shows what is not visible today (rule 7)', async () => {
    const one = dataOf(await old(OLD_ONE, { variables: { id: first.id } }));
    expect(one.article).toMatchObject({ secret: null, hero: { note: null } });
    // A role that lost a field since the client's version reads it as null.
    expect(before.narrow.article).toMatchObject({ title: 'First', restricted: 'r1' });
    const narrow = await old(NARROW_ONE, {
      credential: narrowToken,
      variables: { id: first.id },
    });
    expect(dataOf(narrow)).toEqual({ article: { title: 'First', restricted: null } });
    // A field private today cannot be filtered on through a lens.
    const filtered = await old('{ articles(filter: { secret: { eq: "shh" } }) { nodes { id } } }');
    expect(filtered.body.data).toEqual({ articles: null });
    expect(JSON.stringify(filtered.body)).not.toContain('"id"');
    // Drafts never show, and a delivery token may not ask for them.
    await createEntry('story', { headline: 'Draft only', count: '1', secret: 'x' }, false);
    expect(JSON.stringify(await old(OLD_LIST))).not.toContain('Draft only');
    const drafts = await old('{ articles(publicationState: DRAFT) { nodes { title } } }');
    expect(drafts.body.data).toEqual({ articles: null });
    expect(JSON.stringify(drafts.body)).not.toContain('Draft only');
  });

  it('names the old models in `_changes`', async () => {
    type Changes = { _changes: { nodes: Array<{ modelKey: string; routeKey: string }> } };
    const changes = dataOf(await old('{ _changes(from: 0) { nodes { modelKey routeKey } } }')) as Changes;
    const keys = changes._changes.nodes.map((node) => node.modelKey);
    expect(keys).toContain('article');
    expect(keys).not.toContain('story');
    expect(keys).not.toContain('newcomer');
    expect(changes._changes.nodes.find((node) => node.modelKey === 'article')?.routeKey).toBe('articles');
  });

  it('refuses a mutation naming a schema version', async () => {
    for (const version of [v, await currentToken()]) {
      const refused = await gql('mutation { deleteArticle(id: "x") { id } }', {
        credential: adminToken,
        version,
      });
      expect(refused.statusCode).toBe(400);
      expect(errorCodes(refused)).toEqual(['LENS_MUTATIONS_UNSUPPORTED']);
    }
  });

  it('checks the version it is given', async () => {
    const schemaId = v.split(':')[0] as string;
    const conflict = await testApp.app.inject({
      method: 'GET',
      url: `/api/graphql?query=${encodeURIComponent('{ _schemaVersion }')}&schemaVersion=${schemaId}:1`,
      headers: headersOf(token, v),
    });
    expect(conflict.statusCode).toBe(400);
    expect(
      conflict.json<{ errors: Array<{ extensions: { code: string } }> }>().errors[0]?.extensions.code,
    ).toBe('SCHEMA_VERSION_MISMATCH');
    for (const [version, code] of [
      [`${schemaId}:99999999`, 'SCHEMA_VERSION_AHEAD'],
      ['elsewhere:1', 'SCHEMA_VERSION_FOREIGN'],
    ] as const) {
      const refused = await gql('{ _schemaVersion }', { version });
      expect(refused.statusCode, code).toBe(400);
      expect(errorCodes(refused)).toEqual([code]);
    }
    // The query form on GET works as the header does.
    const viaQuery = await testApp.app.inject({
      method: 'GET',
      url: `/api/graphql?query=${encodeURIComponent('{ articles { totalCount } }')}&schemaVersion=${encodeURIComponent(v)}`,
      headers: headersOf(token),
    });
    expect(viaQuery.statusCode).toBe(200);
    expect(viaQuery.json()).toMatchObject({ data: { articles: { totalCount: 2 } } });
  });

  it('serves today’s schema byte for byte while lens schemas are cached', async () => {
    const current =
      '{ stories(sort: [{ headline: ASC }]) { nodes { id headline count price subtitle hero { title } } } _schemaVersion }';
    const baseline = (await gql(current)).response.body;
    const cache = testApp.app.graphqlRuntime.schemas;
    const held = cache.list();
    await old(OLD_LIST);
    await old(OLD_LIST, { credential: narrowToken });
    expect((await gql(current)).response.body).toBe(baseline);
    // Naming today's version reads today's shape too, with the versions in extensions.
    const named = await gql(current, { version: await currentToken() });
    expect(named.body.data).toEqual((JSON.parse(baseline) as { data: unknown }).data);
    expect(named.body).toHaveProperty('extensions.schemaVersion.requested');
    expect(cache.listLens().length).toBeGreaterThan(0);
    expect(cache.list()).toStrictEqual(held);
  });

  it('bounds the lens schemas and never evicts the current one', async () => {
    const scratch = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'scratch',
      label: 'Scratch',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const cache = testApp.app.graphqlRuntime.schemas;
    const versions: string[] = [];
    let current = scratch;
    for (let i = 0; i < GRAPHQL_LENS_SCHEMA_CACHE_SIZE + 1; i += 1) {
      versions.push(await currentToken());
      current = await change(current, (definition) => ({ ...definition, label: `Scratch ${i}` }));
    }
    const today = dataOf(await gql('{ _schemaVersion }', { credential: adminToken }));
    const currentEntries = cache.list();
    const views: string[] = [];
    for (const version of versions) {
      dataOf(await gql('{ scratches { totalCount } }', { credential: adminToken, version }));
      views.push(cache.listLens().at(-1)?.view as string);
    }
    expect(new Set(views).size).toBe(versions.length);
    const held = cache.listLens().map((entry) => entry.view);
    expect(held).toHaveLength(GRAPHQL_LENS_SCHEMA_CACHE_SIZE);
    expect(held).not.toContain(views[0]);
    expect(held).toEqual(expect.arrayContaining(views.slice(1)));
    expect(cache.list()).toEqual(currentEntries);
    expect(dataOf(await gql('{ _schemaVersion }', { credential: adminToken }))).toEqual(today);
  });
});
