import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type OpenApi = {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown> };
};

const title = { apiKey: 'title', label: 'Title', type: 'string', required: true, sortable: true };

/**
 * The generated contracts of a schema with an interface (plan interfaces, D10), served live from the active
 * schema: TypeScript (`shapio types generate`) and OpenAPI. Snapshots of the whole TypeScript output and of
 * the interface's part of the OpenAPI document.
 */
describe('interfaces: TypeScript and OpenAPI', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const created = expectStatus(
      await admin.post('/api/admin/interfaces', {
        scope: 'network',
        definition: {
          kind: 'interface',
          apiKey: 'featurable',
          label: 'Featurable',
          fields: [title, { apiKey: 'summary', label: 'Summary', type: 'text' }],
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    const featurable = created.definitionId;
    const member = {
      implements: [featurable],
      fields: [title, { apiKey: 'summary', label: 'Summary', type: 'text' }],
    };
    const post = await createDefinition(
      admin,
      { kind: 'collection', apiKey: 'post', pluralApiKey: 'posts', label: 'Post', ...member },
      'models',
      'network',
    );
    await createDefinition(
      admin,
      {
        kind: 'collection',
        apiKey: 'guide',
        pluralApiKey: 'guides',
        label: 'Guide',
        extends: post.definition.id,
        fields: [{ apiKey: 'level', label: 'Level', type: 'integer' }],
      },
      'models',
      'network',
    );
    await createDefinition(
      admin,
      { kind: 'singleton', apiKey: 'about', label: 'About', ...member },
      'models',
      'network',
    );
    await createDefinition(
      admin,
      {
        kind: 'singleton',
        apiKey: 'homepage',
        label: 'Homepage',
        fields: [
          {
            apiKey: 'featured',
            label: 'Featured',
            type: 'relation',
            settings: { target: featurable, cardinality: 'many' },
          },
          {
            apiKey: 'spotlight',
            label: 'Spotlight',
            type: 'relation',
            settings: { target: '*', cardinality: 'one' },
          },
        ],
      },
      'models',
      'network',
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('generates TypeScript with the contract, its members’ union and any entry', async () => {
    const { source } = expectStatus(await admin.get('/api/docs/typescript'), 200).json<{ source: string }>();
    expect(source).toContain('export type FeaturableAny = About | Guide | Post;');
    expect(source).toContain('  featured: Array<Related<FeaturableAny>> | null;');
    expect(source).toContain('  spotlight: Related<AnyEntry> | null;');
    expect(source).toMatchSnapshot();
  });

  it('generates OpenAPI with the contract, its members by __model, any entry and the list route', async () => {
    const document = expectStatus(await admin.get('/api/docs/openapi.json'), 200).json<OpenApi>();
    const { schemas } = document.components;
    expect({
      Featurable: schemas.Featurable,
      FeaturableAny: schemas.FeaturableAny,
      AnyEntry: schemas.AnyEntry,
      InterfaceMember: schemas.InterfaceMember,
      homepageRelations: (schemas.Homepage as { properties: Record<string, unknown> }).properties,
      list: document.paths['/api/content/featurables'],
      get: document.paths['/api/content/featurables/{id}'],
    }).toMatchSnapshot();
    expect(document.paths['/api/admin/content/featurable']).toBeUndefined();
  });
});
