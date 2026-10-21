import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import * as usageRepository from '../src/repositories/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type TypeInfo = {
  kind: string;
  interfaces: Array<{ name: string }> | null;
  possibleTypes: Array<{ name: string }> | null;
  fields: Array<{ name: string; type: unknown }> | null;
};

const TYPE_QUERY = `query ($name: String!) {
  __type(name: $name) {
    kind
    interfaces { name }
    possibleTypes { name }
    fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

/** A contract field as the interface and each member declare it (members match by API ID and type). */
const TITLE = {
  apiKey: 'title',
  label: 'Title',
  type: 'string',
  required: true,
  filterable: true,
  sortable: true,
};
const SUMMARY = { apiKey: 'summary', label: 'Summary', type: 'text' };
const TONE = {
  apiKey: 'tone',
  label: 'Tone',
  type: 'enum',
  settings: { values: [{ value: 'calm', label: 'Calm' }] },
};

/**
 * GraphQL over interfaces (plan interfaces D8, WP3): the interface type from a definition, its members'
 * types, `Entry` on an any-entry relation, the schema of a delivery token granted one member, usage through
 * an interface, and a model untouched by interfaces changing only by `Entry`.
 */
describe('interfaces: GraphQL', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let featurableId: string;
  let post: ModelBody;
  let guide: ModelBody;
  let blogPost: ModelBody;
  let about: ModelBody;
  let note: ModelBody;
  let homepage: ModelBody;
  let alpha: EntryBody;
  let bravo: EntryBody;
  let aboutEntry: EntryBody;
  let hello: EntryBody;
  let noteTypeBefore: TypeInfo;
  let noteQueryBefore: unknown;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const gql = <T = Record<string, unknown>>(
    query: string,
    token: string,
    variables?: Record<string, unknown>,
  ) => graphql<T>(testApp.app, query, { headers: bearer(token), ...(variables ? { variables } : {}) });
  const typeOf = async (name: string, token = adminToken) =>
    dataOf(await gql<{ __type: TypeInfo | null }>(TYPE_QUERY, token, { name })).__type;
  const queryFieldOf = async (name: string, token = adminToken) =>
    (await typeOf('Query', token))?.fields?.find((field) => field.name === name);
  const names = (list: Array<{ name: string }> | null | undefined) =>
    (list ?? []).map(({ name }) => name).sort();
  const create = async (modelKey: string, data: Record<string, unknown>) => {
    const entry = expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${entry.id}/publish`, {}), 200);
    return entry;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ apiKey: 'text', label: 'Text', type: 'string', filterable: true }],
    });
    // The schema of a model no interface touches, before any interface exists.
    noteTypeBefore = (await typeOf('Note')) as TypeInfo;
    noteQueryBefore = await queryFieldOf('notes');

    const created = await admin.post('/api/admin/interfaces', {
      definition: {
        kind: 'interface',
        apiKey: 'featurable',
        pluralApiKey: 'featurables',
        label: 'Featurable',
        fields: [TITLE, SUMMARY, TONE],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    featurableId = created.json<{ definitionId: string }>().definitionId;
    post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      implements: [featurableId],
      fields: [TITLE, SUMMARY, TONE],
    });
    guide = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'guide',
      label: 'Guide',
      extends: post.definition.id,
      fields: [{ apiKey: 'steps', label: 'Steps', type: 'integer' }],
    });
    blogPost = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'blogPost',
      label: 'Blog post',
      implements: [featurableId],
      fields: [TITLE, SUMMARY, TONE, { apiKey: 'secret', label: 'Secret', type: 'string', public: false }],
    });
    about = await createDefinition(admin, {
      kind: 'singleton',
      apiKey: 'about',
      label: 'About',
      implements: [featurableId],
      fields: [TITLE, SUMMARY, TONE],
    });
    homepage = await createDefinition(admin, {
      kind: 'singleton',
      apiKey: 'homepage',
      label: 'Homepage',
      fields: [
        {
          apiKey: 'featured',
          label: 'Featured',
          type: 'relation',
          settings: { target: featurableId, cardinality: 'many' },
        },
        {
          apiKey: 'spotlight',
          label: 'Spotlight',
          type: 'relation',
          settings: { target: '*', cardinality: 'one' },
        },
      ],
    });
    alpha = await create('blogPost', { title: 'Alpha', summary: 'First', secret: 's' });
    bravo = await create('guide', { title: 'Bravo', summary: 'Second', steps: 3 });
    aboutEntry = await create('about', { title: 'Charlie', summary: 'Us' });
    hello = await create('note', { text: 'hello' });
    await create('homepage', { featured: [alpha.id, bravo.id, aboutEntry.id], spotlight: hello.id });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('builds the interface from the definition, implemented by every member and kind', async () => {
    const featurable = await typeOf('Featurable');
    expect(featurable?.kind).toBe('INTERFACE');
    expect(names(featurable?.interfaces)).toEqual(['Entry']);
    expect(names(featurable?.possibleTypes)).toEqual(['About', 'BlogPost', 'Guide', 'Post']);
    expect(featurable?.fields?.map((field) => field.name)).toEqual([
      'id',
      'locale',
      'createdAt',
      'updatedAt',
      'publishedAt',
      'localizations',
      'title',
      'summary',
    ]);
    expect(names((await typeOf('Guide'))?.interfaces)).toEqual(['Entry', 'Featurable', 'PostInterface']);
    expect(names((await typeOf('PostInterface'))?.interfaces)).toEqual(['Entry', 'Featurable']);
    expect(names((await typeOf('About'))?.interfaces)).toEqual(['Entry', 'Featurable']);
    expect(JSON.stringify((await queryFieldOf('featurables'))?.type)).toContain('"FeaturableConnection"');
    expect(JSON.stringify((await queryFieldOf('featurable'))?.type)).toContain('"Featurable"');
    const featured = (await typeOf('Homepage'))?.fields?.find((field) => field.name === 'featured');
    expect(JSON.stringify(featured?.type)).toContain('"Featurable"');
    const spotlight = (await typeOf('Homepage'))?.fields?.find((field) => field.name === 'spotlight');
    expect(JSON.stringify(spotlight?.type)).toContain('"Entry"');
  });

  it('changes a model no interface touches only by Entry', async () => {
    const noteType = (await typeOf('Note')) as TypeInfo;
    expect(noteType).toEqual(noteTypeBefore);
    expect(noteType.interfaces).toEqual([{ name: 'Entry' }]);
    expect(await queryFieldOf('notes')).toEqual(noteQueryBefore);
    const entry = await typeOf('Entry');
    expect(entry?.kind).toBe('INTERFACE');
    expect(entry?.fields?.map((field) => field.name)).toEqual([
      'id',
      'locale',
      'createdAt',
      'updatedAt',
      'publishedAt',
    ]);
    const mutation = await typeOf('Mutation');
    const createNote = mutation?.fields?.find((field) => field.name === 'createNote');
    expect(JSON.stringify(createNote?.type)).toContain('"EntryState"');
  });

  it('resolves a relation to an interface per member and one to any entry as Entry', async () => {
    const data = dataOf(
      await gql<{ homepage: Record<string, unknown> }>(
        `{ homepage {
            featured { __typename id title
              ... on Guide { steps }
              ... on About { summary } }
            spotlight { __typename id ... on Note { text } } } }`,
        adminToken,
      ),
    );
    expect(data.homepage).toEqual({
      featured: [
        { __typename: 'BlogPost', id: alpha.id, title: 'Alpha' },
        { __typename: 'Guide', id: bravo.id, title: 'Bravo', steps: 3 },
        { __typename: 'About', id: aboutEntry.id, title: 'Charlie', summary: 'Us' },
      ],
      spotlight: { __typename: 'Note', id: hello.id, text: 'hello' },
    });
  });

  it('a delivery token granted one member gets a valid schema with the interface over it', async () => {
    const token = await createDeliveryToken(database.current.db, [{ modelId: blogPost.definition.id }]);
    const featurable = await typeOf('Featurable', token);
    expect(names(featurable?.possibleTypes)).toEqual(['BlogPost']);
    expect(featurable?.fields?.map((field) => field.name)).toEqual(
      expect.arrayContaining(['title', 'summary']),
    );
    expect(await typeOf('Post', token)).toBeNull();
    expect(await typeOf('Homepage', token)).toBeNull();
    const blog = await typeOf('BlogPost', token);
    expect(names(blog?.interfaces)).toEqual(['Entry', 'Featurable']);
    expect(blog?.fields?.map((field) => field.name)).not.toContain('secret');
    const read = dataOf(
      await gql<{ blogPosts: { nodes: Array<Record<string, unknown>> } }>(
        '{ blogPosts { nodes { __typename title } } }',
        token,
      ),
    );
    expect(read.blogPosts.nodes).toEqual([{ __typename: 'BlogPost', title: 'Alpha' }]);
  });

  it('a delivery token granted no member has no interface, and Entry stays', async () => {
    const token = await createDeliveryToken(database.current.db, [{ modelId: note.definition.id }]);
    expect(await typeOf('Featurable', token)).toBeNull();
    expect(await queryFieldOf('featurables', token)).toBeUndefined();
    expect(names((await typeOf('Entry', token))?.possibleTypes)).toEqual(['Note']);
  });

  it('counts reads through an interface relation against each member field', async () => {
    const token = await createDeliveryToken(database.current.db, [
      { modelId: homepage.definition.id },
      { modelId: post.definition.id },
      { modelId: blogPost.definition.id },
      { modelId: about.definition.id },
      { modelId: note.definition.id },
    ]);
    const result = await gql(
      '{ homepage { featured { title ... on Guide { steps } } spotlight { id ... on Note { text } } } }',
      token,
    );
    expect(result.body.errors).toBeUndefined();
    await testApp.app.usage.flush();
    const paths = (
      await usageRepository.fieldUsageForModel(
        PRIMARY_SITE_ID,
        homepage.definition.id,
        usageDayOf(new Date()),
        database.current.db,
      )
    )
      .filter((row) => row.selection === 'explicit')
      .map((row) => row.fieldPath);
    const featured = fieldIdOf(homepage, 'featured');
    const spotlight = fieldIdOf(homepage, 'spotlight');
    expect(paths).toEqual(
      expect.arrayContaining([
        featured,
        `${featured}.${fieldIdOf(post, 'title')}`,
        `${featured}.${fieldIdOf(blogPost, 'title')}`,
        `${featured}.${fieldIdOf(about, 'title')}`,
        `${featured}.${fieldIdOf(guide, 'steps')}`,
        spotlight,
        `${spotlight}.${fieldIdOf(note, 'text')}`,
      ]),
    );
  });

  /** These read the interface route (`listDelivery`/`getDelivery` with the interface's API ID, WP2). */
  describe('the interface route', () => {
    it('lists every member in title order, each as its own type with fragments', async () => {
      const data = dataOf(
        await gql<{ featurables: { totalCount: number; nodes: Array<Record<string, unknown>> } }>(
          `{ featurables(sort: [{ title: DESC }]) {
              totalCount
              nodes { __typename id title
                ... on Guide { steps }
                ... on BlogPost { summary } } } }`,
          adminToken,
        ),
      );
      expect(data.featurables.totalCount).toBe(3);
      expect(data.featurables.nodes).toEqual([
        { __typename: 'About', id: aboutEntry.id, title: 'Charlie' },
        { __typename: 'Guide', id: bravo.id, title: 'Bravo', steps: 3 },
        { __typename: 'BlogPost', id: alpha.id, title: 'Alpha', summary: 'First' },
      ]);
      const filtered = dataOf(
        await gql<{ featurables: { nodes: Array<{ id: string }> } }>(
          '{ featurables(filter: { title: { containsi: "a" } }, sort: [{ title: ASC }], pageSize: 1, page: 2) { nodes { id } } }',
          adminToken,
        ),
      );
      expect(filtered.featurables.nodes).toEqual([{ id: bravo.id }]);
    });

    it('looks up one entry through the interface, null for a non-member', async () => {
      const data = dataOf(
        await gql<{ featurable: Record<string, unknown> | null }>(
          `{ featurable(id: "${bravo.id}") { __typename title ... on Guide { steps } } }`,
          adminToken,
        ),
      );
      expect(data.featurable).toEqual({ __typename: 'Guide', title: 'Bravo', steps: 3 });
      const missing = dataOf(
        await gql<{ featurable: unknown }>(`{ featurable(id: "${hello.id}") { id } }`, adminToken),
      );
      expect(missing.featurable).toBeNull();
    });

    it('a member-only token lists only that member through the interface', async () => {
      const token = await createDeliveryToken(database.current.db, [{ modelId: blogPost.definition.id }]);
      const data = dataOf(
        await gql<{ featurables: { nodes: Array<Record<string, unknown>> } }>(
          '{ featurables { nodes { __typename title } } }',
          token,
        ),
      );
      expect(data.featurables.nodes).toEqual([{ __typename: 'BlogPost', title: 'Alpha' }]);
    });
  });
});
