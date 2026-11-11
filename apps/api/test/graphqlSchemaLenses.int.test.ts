import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GRAPHQL_LENS_SCHEMAS_PROBATION, GRAPHQL_LENS_SCHEMAS_PROTECTED } from '../src/constants/graphql.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import * as permissionsVersionRepository from '../src/repositories/permissionsVersion.js';
import { resetLensBuildBudgets, takeLensBuildBudget } from '../src/schema/lens/budget.js';
import { clearLensCaches } from '../src/schema/lens/views.js';
import { setPublicGrants } from './helpers/appUsers.js';
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
      restricted
      hero { heading }
      blocks { __typename ... on Hero { heading } ... on Badge { label } }
      writer { id name }
    }
  }
  _schemaVersion
}`;

const OLD_ONE = `query One($id: ID!) {
  article(id: $id) { id title count price summary restricted hero { heading } writer { name } }
}`;

/**
 * What the old client's version also let it read, hidden since: the secret and the hero note were made
 * private. A delivery caller's lens schema no longer names them, so this fails validation as it would today.
 */
const OLD_HIDDEN = `query Hidden($id: ID!) { article(id: $id) { secret hero { note } blocks { ... on Hero { note } } } }`;

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
  let profile: ModelBody;
  /** Granted the profile's `name` by name only. */
  let nameOnlyToken: string;
  let first: EntryBody;
  /** The schema version the old client was built against. */
  let v: string;
  let before: { list: Data; one: Data; narrow: Data; hidden: Data };

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
  const fieldNames = async (typeName: string, version?: string, credential = token) => {
    const data = dataOf(
      await gql('query ($name: String!) { __type(name: $name) { fields { name } } }', {
        credential,
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
    profile = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'profile',
      label: 'Profile',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string' },
        { apiKey: 'salary', label: 'Salary', type: 'string' },
        { apiKey: 'ssn', label: 'SSN', type: 'string' },
        { apiKey: 'nickname', label: 'Nickname', type: 'string' },
      ],
    });
    nameOnlyToken = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [
        { action: 'read', modelId: profile.definition.id, fieldIds: [fieldIdOf(profile, 'name')] },
      ]),
    );
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

    await createEntry('profile', { name: 'Pat', salary: '100', ssn: '123', nickname: 'P' });
    v = await currentToken();
    before = {
      list: dataOf(await old(OLD_LIST)),
      one: dataOf(await old(OLD_ONE, { variables: { id: first.id } })),
      narrow: dataOf(await old(NARROW_ONE, { credential: narrowToken, variables: { id: first.id } })),
      hidden: dataOf(await old(OLD_HIDDEN, { variables: { id: first.id } })),
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
    // Salary and SSN made private, the nickname removed: the name-only role's mask now covers every public
    // field, yet its grant still names one field.
    profile = await change(profile, (definition) => ({
      ...definition,
      fields: [
        field(definition, 'name'),
        { ...field(definition, 'salary'), public: false },
        { ...field(definition, 'ssn'), public: false },
      ],
    }));
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
    const result = await old(OLD_LIST);
    const data = dataOf(result);
    // A field removed since reads null for a grant that reads every public field today.
    const expected = nodesOf(before.list, 'articles').map((node) => ({ ...node, summary: null }));
    expect(nodesOf(data, 'articles')).toEqual(expected);
    expect(nodesOf(data, 'articles')[0]).toMatchObject({
      title: 'First',
      count: 3,
      price: '12.5',
      hero: { heading: 'Hi' },
      blocks: [
        { __typename: 'Hero', heading: 'Block hero' },
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
    expect(one.article).toEqual({ ...(before.one.article as Node), summary: null });
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

  it('records the version a GraphQL read names for its token, and clears it when it names none', async () => {
    const roleId = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: article.definition.id },
    ]);
    const reader = await createTokenForRole(database.current.db, roleId);
    const { id: readerId } = await database.current.db
      .selectFrom('api_tokens')
      .select('id')
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    const versionOf = async () => {
      await testApp.app.usage.flush();
      const { principals } = expectStatus(
        await testApp.app.inject({
          method: 'GET',
          url: '/api/admin/usage/schema-versions',
          headers: headersOf(adminToken),
        }),
        200,
      ).json<{ principals: Array<{ principalKey: string; schemaVersion: number }> }>();
      return principals.find((entry) => entry.principalKey === `token:${readerId}`)?.schemaVersion ?? null;
    };
    const query = 'query ($id: ID!) { article(id: $id) { title } }';
    dataOf(await gql(query, { credential: reader, version: v, variables: { id: first.id } }));
    expect(await versionOf()).toBe(Number(v.split(':')[1]));
    const today = await currentToken();
    dataOf(
      await gql('query ($id: ID!) { story(id: $id) { headline } }', {
        credential: reader,
        version: today,
        variables: { id: first.id },
      }),
    );
    expect(await versionOf()).toBe(Number(today.split(':')[1]));
    dataOf(
      await gql('query ($id: ID!) { story(id: $id) { headline } }', {
        credential: reader,
        variables: { id: first.id },
      }),
    );
    expect(await versionOf()).toBeNull();
  });

  it('shows the old version’s types and fields in introspection', async () => {
    const articleFields = await fieldNames('Article', v);
    expect(articleFields).toEqual(expect.arrayContaining(['title', 'count', 'summary', 'hero']));
    expect(articleFields).not.toContain('headline');
    expect(articleFields).not.toContain('subtitle');
    // Private today: not named, whatever the old version had.
    expect(articleFields).not.toContain('secret');
    expect(await fieldNames('Story', v)).toBeNull();
    expect(await fieldNames('Hero', v)).toEqual(['id', 'heading']);
    expect(await fieldNames('Gadget', v)).toBeNull();
    expect(await fieldNames('Story')).toContain('headline');
    // The old version's mutations, none for a model deleted since.
    type Mutations = { __schema: { mutationType: { fields: Array<{ name: string }> } } };
    const mutations = dataOf(
      await gql('{ __schema { mutationType { fields { name } } } }', { version: v }),
    ) as Mutations;
    const names = mutations.__schema.mutationType.fields.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining(['createArticle', 'updateArticle', 'deleteArticle']));
    expect(names).not.toContain('createStory');
    expect(names).not.toContain('createGadget');
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

  it('leaves deleted models out (admins read them empty), refuses a kind change, and drops kinds and members added since', async () => {
    const goneQuery = `query ($id: ID!) { gadgets { totalCount nodes { id name } } gadget(id: $id) { id } }`;
    const gone = await old(goneQuery, { variables: { id: first.id } });
    expect(gone.statusCode).toBe(400);
    expect(errorCodes(gone)).toEqual(['GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_VALIDATION_FAILED']);
    const asAdmin = await old(goneQuery, { credential: adminToken, variables: { id: first.id } });
    expect(dataOf(asAdmin)).toEqual({ gadgets: { totalCount: 0, nodes: [] }, gadget: null });
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
    // Fields made private since: the old client read them, the lens schema no longer names them, exactly as
    // today's schema does not.
    expect(JSON.stringify(before.hidden)).toMatch(/shh[\s\S]*private soon[\s\S]*block note/);
    const hidden = await old(OLD_HIDDEN, { variables: { id: first.id } });
    const today = await gql('query ($id: ID!) { story(id: $id) { secret hero { note } } }', {
      variables: { id: first.id },
    });
    for (const result of [hidden, today]) {
      expect(result.statusCode).toBe(400);
      expect(new Set(errorCodes(result))).toEqual(new Set(['GRAPHQL_VALIDATION_FAILED']));
      expect(result.body.data ?? null).toBeNull();
    }
    expect(JSON.stringify(hidden.body)).not.toMatch(/shh|private soon|block note/);
    // A field private today cannot be filtered on through a lens either.
    const filtered = await old('{ articles(filter: { secret: { eq: "shh" } }) { nodes { id } } }');
    expect(errorCodes(filtered)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    // Drafts never show, and a delivery token may not ask for them.
    await createEntry('story', { headline: 'Draft only', count: '1', secret: 'x' }, false);
    expect(JSON.stringify(await old(OLD_LIST))).not.toContain('Draft only');
    const drafts = await old('{ articles(publicationState: DRAFT) { nodes { title } } }');
    expect(drafts.body.data).toEqual({ articles: null });
    expect(JSON.stringify(drafts.body)).not.toContain('Draft only');
  });

  it("names nothing a field-restricted token cannot read today, as today's schema does not", async () => {
    // At the old version the narrow token read title and restricted; today its grant names the headline only.
    expect(before.narrow.article).toMatchObject({ title: 'First', restricted: 'r1' });
    const articleFields = await fieldNames('Article', v, narrowToken);
    expect(articleFields).toContain('title');
    for (const name of ['restricted', 'secret', 'summary', 'count', 'hero']) {
      expect(articleFields, name).not.toContain(name);
    }
    const old_ = await old(NARROW_ONE, { credential: narrowToken, variables: { id: first.id } });
    const today = await gql('query ($id: ID!) { story(id: $id) { headline restricted } }', {
      credential: narrowToken,
      variables: { id: first.id },
    });
    for (const result of [old_, today]) {
      expect(result.statusCode).toBe(400);
      expect(errorCodes(result)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    }
    expect(JSON.stringify(old_.body)).not.toContain('r1');
    // A field removed since is not named for a restricted grant either; the title still reads.
    const removed = await old('query ($id: ID!) { article(id: $id) { summary } }', {
      credential: narrowToken,
      variables: { id: first.id },
    });
    expect(errorCodes(removed)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    const title = await old('query ($id: ID!) { article(id: $id) { title } }', {
      credential: narrowToken,
      variables: { id: first.id },
    });
    expect(dataOf(title)).toEqual({ article: { title: 'First' } });
  });

  it('never names a deleted model to an anonymous caller; an unrestricted public grant reads removed fields as null', async () => {
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: article.definition.id }]);
    const anonymous = (query: string) =>
      graphql<Data>(testApp.app, query, { headers: { 'shapio-schema-version': v } });
    const gone = await anonymous('{ gadgets { totalCount } }');
    expect(gone.statusCode).toBe(400);
    expect(errorCodes(gone)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    expect(JSON.stringify(gone.body)).not.toMatch(/Did you mean/);
    const read = await anonymous('{ articles(sort: [{ title: ASC }]) { nodes { title summary } } }');
    expect(nodesOf(dataOf(read), 'articles')).toEqual([
      { title: 'First', summary: null },
      { title: 'Second', summary: null },
    ]);
    await setPublicGrants(database.current.db, []);
  });

  it('answers a caller allowed nothing exactly as without a version, whatever version it names', async () => {
    const schemaId = v.split(':')[0] as string;
    const query = encodeURIComponent('{ articles { totalCount } }');
    const send = (url: string, headers: Record<string, string>) =>
      testApp.app.inject({ method: 'GET', url, headers });
    const plainUrl = `/api/graphql?query=${query}`;
    const cases: Array<[string, Record<string, string>]> = [
      [plainUrl, { 'shapio-schema-version': v }],
      [plainUrl, { 'shapio-schema-version': 'elsewhere:1' }],
      [plainUrl, { 'shapio-schema-version': `${schemaId}:99999999` }],
      [plainUrl, { 'shapio-schema-version': 'not a version' }],
      // Longer than any version: checked after authorization too, never by the route's schema.
      [plainUrl, { 'shapio-schema-version': `${schemaId}:${'9'.repeat(81)}` }],
      [`${plainUrl}&schemaVersion=${schemaId}:1`, { 'shapio-schema-version': v }],
      [`${plainUrl}&schemaVersion=${encodeURIComponent(v)}&schemaVersion=${schemaId}:1`, {}],
    ];
    const credentialSets: Array<Record<string, string>> = [{}, { authorization: 'Bearer not-a-token' }];
    for (const credentials of credentialSets) {
      const plain = await send(plainUrl, credentials);
      expect(plain.statusCode).toBe(401);
      for (const [url, headers] of cases) {
        const named = await send(url, { ...credentials, ...headers });
        expect(named.statusCode, `${url} ${JSON.stringify(headers)}`).toBe(plain.statusCode);
        expect(named.body).toBe(plain.body);
      }
    }
    // An authorized caller is told what is wrong with the version.
    for (const version of ['not a version', `${schemaId}:${'9'.repeat(81)}`]) {
      const malformed = await gql('{ _schemaVersion }', { version });
      expect(malformed.statusCode).toBe(400);
      expect(errorCodes(malformed)).toEqual(['SCHEMA_VERSION_INVALID']);
    }
  });

  it('never tells a caller allowed nothing the schema ID or version, headers included', async () => {
    /** Headers that differ between any two requests (the clock, the rate-limit counter). */
    const withoutDate = (headers: Record<string, unknown>) => {
      const { date: _date, 'x-ratelimit-remaining': _remaining, ...rest } = headers;
      return rest;
    };
    // Queries that answer 200 (or an error from a resolver) on an empty schema.
    for (const query of ['{ __typename }', '{ _schemaVersion }', '{ _snapshot { snapshot } }']) {
      const url = `/api/graphql?query=${encodeURIComponent(query)}`;
      const plain = await testApp.app.inject({ method: 'GET', url });
      const named = await testApp.app.inject({
        method: 'GET',
        url,
        headers: { 'shapio-schema-version': v },
      });
      expect(plain.headers['shapio-schema-version-current'], query).toBeUndefined();
      expect(named.headers['shapio-schema-version-current'], query).toBeUndefined();
      expect(named.statusCode).toBe(plain.statusCode);
      expect(named.body).toBe(plain.body);
      expect(withoutDate(named.headers)).toEqual(withoutDate(plain.headers));
    }
    // A caller allowed some content is told the current version.
    const allowed = await gql('{ __typename }');
    expect(allowed.response.headers['shapio-schema-version-current']).toBe(await currentToken());
  });

  it('authorizes a mutation as without a version before any lens answer', async () => {
    // `promo` switched to a singleton since; this token may read it but not create: the refusal is today's.
    const refused = await old('mutation { createPromo { id } }');
    expect(errorCodes(refused)).toEqual(['FORBIDDEN']);
    const writable = await old('mutation { createPromo(data: { name: "x" }) { id } }', {
      credential: adminToken,
    });
    expect(errorCodes(writable)).toEqual(['LENS_UNCOVERED']);
  });

  it('answers the snapshot routes to a caller allowed nothing exactly as without a version', async () => {
    const schemaId = v.split(':')[0] as string;
    for (const path of ['/api/snapshots/current', '/api/snapshots/changes?from=0']) {
      const join = path.includes('?') ? '&' : '?';
      const plain = await testApp.app.inject({ method: 'GET', url: path });
      expect(plain.statusCode, path).toBe(401);
      for (const version of [v, 'elsewhere:1', `${schemaId}:99999999`, 'not a version']) {
        const named = await testApp.app.inject({
          method: 'GET',
          url: `${path}${join}schemaVersion=${encodeURIComponent(version)}`,
        });
        expect(named.statusCode, `${path} ${version}`).toBe(plain.statusCode);
        expect(named.body).toBe(plain.body);
      }
      // An authorized caller is told what is wrong with the version.
      const foreign = await testApp.app.inject({
        method: 'GET',
        url: `${path}${join}schemaVersion=elsewhere:1`,
        headers: headersOf(token),
      });
      expect(foreign.statusCode).toBe(400);
      expect(foreign.json<{ error: { code: string } }>().error.code).toBe('SCHEMA_VERSION_FOREIGN');
    }
  });

  it("spends the caller's lens build budget on an uncached lens schema, and refuses with 429 when it is gone", async () => {
    // The view of the old version is cached by now; the narrow token's lens schema for it is not rebuilt
    // for free when its visibility changes, so make the narrow token's bucket empty first.
    const { id: narrowTokenId } = await database.current.db
      .selectFrom('api_tokens')
      .select('id')
      .where('role_id', '=', narrowRole)
      .executeTakeFirstOrThrow();
    resetLensBuildBudgets();
    while (takeLensBuildBudget(`token:${narrowTokenId}`)) {
      // drain
    }
    // A cached lens schema costs nothing.
    dataOf(await old('{ _schemaVersion }', { credential: narrowToken }));
    // A narrower grant today: a new visibility, so a lens schema not cached yet.
    await database.current.db.transaction().execute(async (trx) => {
      await adminRolesRepository.deletePermissionsForRole(narrowRole, trx);
      await adminRolesRepository.insertPermissions(
        [
          {
            role_id: narrowRole,
            action: 'read',
            model_id: article.definition.id,
            condition: null,
            field_ids: [fieldIdOf(article, 'headline'), fieldIdOf(article, 'price')],
          },
        ],
        trx,
      );
      await permissionsVersionRepository.bumpPermissionsVersion(trx);
    });
    const refused = await old('{ _schemaVersion }', { credential: narrowToken });
    expect(refused.statusCode).toBe(429);
    expect(errorCodes(refused)).toEqual(['LENS_BUDGET_EXCEEDED']);
    resetLensBuildBudgets();
    dataOf(await old('{ _schemaVersion }', { credential: narrowToken }));
  });

  it("judges a removed field by the grant's shape: a name-only grant never sees it, nor fields made private", async () => {
    const profileFields = await fieldNames('Profile', v, nameOnlyToken);
    expect(profileFields).toContain('name');
    for (const name of ['salary', 'ssn', 'nickname']) {
      expect(profileFields, name).not.toContain(name);
    }
    for (const selection of ['salary', 'nickname']) {
      const old_ = await old(`{ profiles { nodes { ${selection} } } }`, { credential: nameOnlyToken });
      const today = await gql(`{ profiles { nodes { ${selection} } } }`, { credential: nameOnlyToken });
      for (const result of [old_, today]) {
        expect(result.statusCode, selection).toBe(400);
        expect(errorCodes(result)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
      }
      expect(JSON.stringify(old_.body)).not.toMatch(/100|"P"/);
    }
    expect(dataOf(await old('{ profiles { nodes { name } } }', { credential: nameOnlyToken }))).toEqual({
      profiles: { nodes: [{ name: 'Pat' }] },
    });
    // A grant naming no fields reads the removed nickname as null.
    expect(dataOf(await old('{ profiles { nodes { name nickname } } }', { credential: adminToken }))).toEqual(
      { profiles: { nodes: [{ name: 'Pat', nickname: null }] } },
    );
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

  it('runs a mutation naming a schema version under today’s permissions (writes: graphqlSchemaLensWrites)', async () => {
    const mutation = `mutation ($id: ID!) { deleteArticle(id: $id) }`;
    const refused = await old(mutation, { variables: { id: first.id } });
    // `deleteArticle` is non-null, so its refusal takes the response's data and status (as without a lens).
    expect(refused.statusCode).toBe(403);
    expect(errorCodes(refused)).toEqual(['FORBIDDEN']);
    expect(errorCodes(await old('mutation { deleteGadget(id: "x") }'))).toEqual([
      'GRAPHQL_VALIDATION_FAILED',
    ]);
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

  it('keeps a version clients read again while another caller walks versions, and shares look-alike versions', async () => {
    const scratch = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'scratch',
      label: 'Scratch',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    // Two tokens of one role: the same visibility, so the same lens cache.
    const scratchRole = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: scratch.definition.id },
    ]);
    const walker = await createTokenForRole(database.current.db, scratchRole);
    const reader = await createTokenForRole(database.current.db, scratchRole);
    const cache = testApp.app.graphqlRuntime.schemas;
    const versions: string[] = [];
    let current = scratch;
    for (let i = 0; i < GRAPHQL_LENS_SCHEMAS_PROBATION + GRAPHQL_LENS_SCHEMAS_PROTECTED + 1; i += 1) {
      versions.push(await currentToken());
      current = await change(current, (definition) => ({ ...definition, label: `Scratch ${i}` }));
    }
    // A change to a model this role never sees: the version looks the same to it.
    const lookAlike = await currentToken();
    const story = (await admin.get(`/api/admin/models/${article.definition.id}`)).json<ModelBody>();
    await change(story, (definition) => ({ ...definition, label: 'Story renamed' }));
    const lookAlikeToo = await currentToken();
    // The full current-version schema catches up with the change on its next request, or in the background
    // (the registry's refresh, on its own schedule per dialect): bring it to the current version and wait for
    // that real condition, then hold every current schema fixed.
    const now = Number(lookAlikeToo.split(':')[1]);
    dataOf(await gql('{ _schemaVersion }', { credential: adminToken }));
    await vi.waitFor(
      () => {
        for (const entry of cache.list()) {
          expect(entry.visibility !== 'full' || entry.version === now).toBe(true);
        }
      },
      { timeout: 10_000, interval: 25 },
    );
    const currentEntries = cache.list();
    const read = async (credential: string, version: string) =>
      gql('{ scratches { totalCount } }', { credential, version });
    const kept = versions[0] as string;
    // Read twice by the reader (built, then read again): a version a real client keeps using.
    dataOf(await read(reader, kept));
    dataOf(await read(reader, kept));
    for (const version of versions.slice(1)) {
      dataOf(await read(walker, version));
    }
    // Versions that look the same to this role share one lens schema.
    const before = cache.listLens().length;
    dataOf(await read(walker, lookAlike));
    dataOf(await read(walker, lookAlikeToo));
    expect(cache.listLens().length).toBeLessThanOrEqual(before + 1);
    // With both tokens' build budgets spent, the reader's version is still served: it is still cached.
    const tokenIds = await database.current.db
      .selectFrom('api_tokens')
      .select('id')
      .where('role_id', '=', scratchRole)
      .execute();
    for (const { id } of tokenIds) {
      while (takeLensBuildBudget(`token:${id}`)) {
        // drain
      }
    }
    expect(dataOf(await read(reader, kept))).toEqual({ scratches: { totalCount: 0 } });
    // A version the walker read once is gone or refused; never at the reader's expense.
    expect(cache.listLens().some((entry) => entry.segment === 'protected')).toBe(true);
    resetLensBuildBudgets();
    // Current-version schemas are never displaced (the current version read above adds its own).
    expect(cache.list()).toEqual(expect.arrayContaining(currentEntries));
  });
  it('leaves a definition whose history does not reach the version out of its schema, answering 409', async () => {
    let legacy = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'legacy',
      pluralApiKey: 'legacies',
      label: 'Legacy',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    await createEntry('legacy', { name: 'Old' });
    const atCreation = await currentToken();
    legacy = await change(legacy, (definition) => ({
      ...definition,
      fields: [...definition.fields, { apiKey: 'note', label: 'Note', type: 'string' }],
    }));
    const changed = Number((await currentToken()).split(':')[1]);
    // An install upgraded to 0.9.0 whose audit log lacks the older rows: a backfilled baseline only.
    const { db } = database.current;
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', legacy.definition.id)
      .where('schema_version', '<', changed)
      .execute();
    await db
      .updateTable('schema_activations')
      .set({ backfilled: true })
      .where('model_id', '=', legacy.definition.id)
      .execute();
    clearLensCaches();
    // Not presented in its later shape: no type, no queries.
    const type = dataOf(
      await gql('{ __type(name: "Legacy") { name } }', { credential: adminToken, version: atCreation }),
    );
    expect(type).toEqual({ __type: null });
    const refused = await gql('{ legacies { nodes { name note } } }', {
      credential: adminToken,
      version: atCreation,
    });
    expect(refused.statusCode).toBe(409);
    expect(errorCodes(refused)).toEqual(['SCHEMA_VERSION_UNAVAILABLE']);
    expect(refused.body.errors?.[0]?.extensions?.details).toMatchObject({
      modelKey: 'legacy',
      oldestVersion: changed,
    });
    // A caller that may not read it today is never told about it: the answer it gets for any unknown field.
    const hidden = await gql('{ legacies { nodes { name } } }', { version: atCreation });
    const unknown = await gql('{ nothings { nodes { name } } }', { version: atCreation });
    for (const result of [hidden, unknown]) {
      expect(result.statusCode).toBe(400);
      expect(errorCodes(result)).toEqual(['GRAPHQL_VALIDATION_FAILED']);
    }
    expect(JSON.stringify(hidden.body)).not.toMatch(/SCHEMA_VERSION_UNAVAILABLE|oldestVersion|"legacy"/);
    // Everything else of that version still reads.
    expect(
      dataOf(await gql('{ stories { totalCount } }', { credential: adminToken, version: atCreation })),
    ).toHaveProperty('stories');
  });
});
