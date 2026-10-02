import { hashDefinition, type LockFile, type SchemaDefinition } from '@shapio/schema';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPublicGrants } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ExportBody = {
  schemaVersion: number;
  definitions: Array<{
    definition: SchemaDefinition & { pluralApiKey?: string };
    version: number;
    hash: string;
  }>;
};
type ApplyBody = { schemaVersion: number; results: Array<{ apiKey: string; decision: { action: string } }> };
type Issue = { path: string; code: string; message: string };

/**
 * Plural API IDs (docs/plans/plural-api-id.md): delivery and preview address a collection by its plural API
 * ID and a singleton by its API ID; GraphQL lists a collection under the plural; the admin API keeps the
 * singular. Collections stored before plural API IDs get the derived one on read, with a consistent hash.
 */
describe('plural API IDs', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let token: string;
  let admin: SchemaClient;
  let article: ModelBody;
  let published: EntryBody;

  const deliver = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    testApp.app.inject({ method, url, ...(payload ? { payload } : {}) });
  const exportSchema = async () =>
    expectStatus(await admin.get('/api/admin/schema/export'), 200).json<ExportBody>();
  const lockOf = (exported: ExportBody): LockFile => ({
    formatVersion: 1,
    schemaVersion: exported.schemaVersion,
    definitions: Object.fromEntries(
      exported.definitions.map(({ definition, version, hash }) => [
        definition.id,
        { kind: definition.kind, apiKey: definition.apiKey, version, hash },
      ]),
    ),
  });
  const apply = async (definitions: unknown[], base: LockFile) =>
    expectStatus(await admin.post('/api/admin/schema/apply', { definitions, base }), 200).json<ApplyBody>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    token = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, token);
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const homepage = await createDefinition(admin, {
      kind: 'singleton',
      apiKey: 'homepage',
      label: 'Homepage',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    published = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Hello' }, publish: true }),
      201,
    ).json<EntryBody>();
    expectStatus(
      await admin.post('/api/admin/content/homepage', { data: { title: 'Home' }, publish: true }),
      201,
    );
    await setPublicGrants(database.current.db, [
      { action: 'read', modelId: article.definition.id },
      { action: 'create', modelId: article.definition.id },
      { action: 'read', modelId: homepage.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('stores the derived plural on a collection, none on a singleton', async () => {
    expect(article.definition.pluralApiKey).toBe('articles');
    const listed = expectStatus(await admin.get('/api/admin/models'), 200).json<{ items: ModelBody[] }>();
    const homepage = listed.items.find((item) => item.definition.apiKey === 'homepage');
    expect(homepage?.definition).not.toHaveProperty('pluralApiKey');
  });

  it('serves a collection under its plural API ID and 404s the singular', async () => {
    const list = expectStatus(await deliver('GET', '/api/content/articles'), 200).json<{
      data: Array<{ id: string; title: string }>;
    }>();
    expect(list.data.map((entry) => entry.title)).toEqual(['Hello']);
    const one = expectStatus(await deliver('GET', `/api/content/articles/${published.id}`), 200);
    expect(one.json<{ data: { title: string } }>().data.title).toBe('Hello');

    const singular = await deliver('GET', '/api/content/article');
    expect(singular.statusCode).toBe(404);
    expect(singular.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'MODEL_NOT_FOUND',
      message: 'No content model "article"',
    });
    expect((await deliver('GET', `/api/content/article/${published.id}`)).statusCode).toBe(404);
    expect((await deliver('POST', '/api/content/article', { data: { title: 'x' } })).statusCode).toBe(404);

    const created = await deliver('POST', '/api/content/articles', { data: { title: 'From delivery' } });
    expect(created.statusCode, created.body).toBe(201);
    // The admin API keeps the singular.
    const drafts = expectStatus(await admin.get('/api/admin/content/article'), 200).json<{
      items: Array<{ data: { title: string } }>;
    }>();
    expect(drafts.items.map((item) => item.data.title)).toContain('From delivery');
    expect((await admin.get('/api/admin/content/articles')).statusCode).toBe(404);
  });

  it('serves a singleton under its API ID', async () => {
    const home = expectStatus(await deliver('GET', '/api/content/homepage'), 200);
    expect(home.json<{ data: { title: string } }>().data.title).toBe('Home');
    expect((await deliver('GET', '/api/content/homepages')).statusCode).toBe(404);
  });

  it('names the GraphQL list query after the plural', async () => {
    const headers = { authorization: `Bearer ${token}` };
    const data = dataOf(
      await graphql<{ articles: { totalCount: number }; homepage: { title: string } }>(
        testApp.app,
        '{ articles { totalCount } homepage { title } }',
        { headers },
      ),
    );
    expect(data.articles.totalCount).toBe(1);
    expect(data.homepage.title).toBe('Home');
    const gone = await graphql(testApp.app, '{ articleCollection { totalCount } }', { headers });
    expect(gone.body.errors?.[0]?.message).toContain('articleCollection');
  });

  it('refuses a plural that collides with another model API ID', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'posts',
      label: 'Posts',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const refused = await admin.post('/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: 'post',
        label: 'Post',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
    });
    expect(refused.statusCode, refused.body).toBe(422);
    const issues = refused.json<{ error: { details: { issues: Issue[] } } }>().error.details.issues;
    expect(
      issues.some((issue) => issue.path.endsWith('/pluralApiKey')),
      JSON.stringify(issues),
    ).toBe(true);
  });

  it('applies a schema file without a plural, deriving it', async () => {
    const result = await apply(
      [
        {
          kind: 'collection',
          apiKey: 'category',
          label: 'Category',
          fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
        },
      ],
      lockOf(await exportSchema()),
    );
    expect(result.results.find((item) => item.apiKey === 'category')?.decision.action).toBe('create');
    const exported = await exportSchema();
    const category = exported.definitions.find((entry) => entry.definition.apiKey === 'category');
    expect(category?.definition.pluralApiKey).toBe('categories');
    expect(category?.hash).toBe(await hashDefinition(category!.definition));
  });
});

describe('plural API IDs on definitions stored before them', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let legacyId: string;
  let legacyHash: string;

  beforeAll(async () => {
    const before = await createTestApp(database.current, { schemaListen: false });
    const token = await createRoleToken(database.current.db);
    const created = await createDefinition(schemaClient(before.app, token), {
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    await before.app.close();
    // What a revision saved by an older Shapio looks like: no plural, hashed without it.
    legacyId = created.definition.id;
    const { pluralApiKey: _plural, ...legacy } = created.definition;
    legacyHash = await hashDefinition(legacy as unknown as SchemaDefinition);
    await database.current.db.transaction().execute(async (trx) => {
      await sql`alter table schema_revisions disable trigger schema_revisions_no_update`.execute(trx);
      await sql`update schema_revisions set definition = definition - 'pluralApiKey', hash = ${legacyHash}
        where model_id = ${legacyId}`.execute(trx);
      await sql`alter table schema_revisions enable trigger schema_revisions_no_update`.execute(trx);
    });

    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, token);
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: legacyId }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('fills the plural on read and hashes what it serves', async () => {
    const model = expectStatus(await admin.get(`/api/admin/models/${legacyId}`), 200).json<{
      definition: SchemaDefinition & { pluralApiKey?: string };
      hash: string;
    }>();
    expect(model.definition.pluralApiKey).toBe('stories');
    expect(model.hash).not.toBe(legacyHash);
    expect(model.hash).toBe(await hashDefinition(model.definition));
    expect((await testApp.app.inject({ method: 'GET', url: '/api/content/stories' })).statusCode).toBe(200);
  });

  it('pull → apply shows no change, with or without the plural in the file', async () => {
    const exported = expectStatus(await admin.get('/api/admin/schema/export'), 200).json<ExportBody>();
    const story = exported.definitions.find((entry) => entry.definition.id === legacyId);
    expect(story?.definition.pluralApiKey).toBe('stories');
    const base: LockFile = {
      formatVersion: 1,
      schemaVersion: exported.schemaVersion,
      definitions: Object.fromEntries(
        exported.definitions.map(({ definition, version, hash }) => [
          definition.id,
          { kind: definition.kind, apiKey: definition.apiKey, version, hash },
        ]),
      ),
    };
    const { pluralApiKey: _plural, ...withoutPlural } = story!.definition;
    for (const file of [story!.definition, withoutPlural]) {
      const applied = expectStatus(
        await admin.post('/api/admin/schema/apply', { definitions: [file], base }),
        200,
      ).json<ApplyBody>();
      expect(applied.results.map((item) => item.decision.action)).toEqual(['skip']);
      expect(applied.schemaVersion).toBe(exported.schemaVersion);
    }
  });
});
