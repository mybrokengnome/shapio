import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type OpenApi = {
  openapi: string;
  info: { version: string };
  paths: Record<string, Record<string, { parameters?: Array<{ name: string; description?: string }> }>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
};

/** Generated contracts (build plan §4.E7): regenerated from the active schema, no restart. */
describe('API docs and generated types', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let event: ModelBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const venue = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'venue',
      label: 'Venue',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const hero = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
      },
      'components',
    );
    event = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'event',
      label: 'Event',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        { apiKey: 'starts', label: 'Starts', type: 'datetime', sortable: true },
        {
          apiKey: 'state',
          label: 'State',
          type: 'enum',
          settings: {
            values: [
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
            ],
          },
        },
        {
          apiKey: 'venue',
          label: 'Venue',
          type: 'relation',
          settings: { target: venue.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'dynamiczone',
          settings: { components: [hero.definition.id] },
        },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
      ],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('serves an OpenAPI 3.1 document per model, regenerated when a model changes', async () => {
    const document = (await admin.get('/api/docs/openapi.json')).json<OpenApi>();
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/content/events',
        '/api/content/events/{id}',
        '/api/admin/content/event',
        '/api/admin/content/event/{id}/publish',
      ]),
    );
    expect(Object.keys(document.components.schemas.Event?.properties ?? {})).toEqual(
      expect.arrayContaining(['id', 'locale', 'title', 'starts', 'state', 'venue', 'sections', 'body']),
    );
    expect(document.components.schemas.Hero).toBeDefined();
    const filters = document.paths['/api/content/events']?.get?.parameters?.find(
      (parameter) => parameter.name === 'filters',
    );
    expect(filters?.description).toContain('`title`');
    expect(filters?.description).toContain('`starts`: $eq $ne $in $nin $null $notNull $lt $lte $gt $gte');

    const changed = await admin.put(`/api/admin/models/${event.definition.id}`, {
      definition: {
        ...event.definition,
        fields: [...event.definition.fields, { apiKey: 'capacity', label: 'Capacity', type: 'integer' }],
      },
      expectedVersion: event.version,
    });
    expect(changed.statusCode).toBe(200);
    const next = (await admin.get('/api/docs/openapi.json')).json<OpenApi>();
    expect(next.info.version).not.toBe(document.info.version);
    expect(next.components.schemas.Event?.properties).toHaveProperty('capacity');
  });

  it('serves a self-hosted HTML index without scripts', async () => {
    const page = await admin.get('/api/docs');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('/api/content/events');
    expect(page.body).not.toMatch(/<script|https:\/\/cdn/);
  });

  it('generates TypeScript declarations', async () => {
    const { source, schemaVersion } = (await admin.get('/api/docs/typescript')).json<{
      source: string;
      schemaVersion: number;
    }>();
    expect(schemaVersion).toBeGreaterThan(0);
    expect(source).toContain('export type Event = EntrySystemFields & {');
    expect(source).toContain('state: "open" | "closed" | null;');
    expect(source).toContain('venue: Related<Venue> | null;');
    expect(source).toContain('sections: Array<({ __component: "hero" } & Hero)> | null;');
    expect(source).toContain('export type EventInput = {');
    expect(source).toContain('  event: Event;');
  });

  it('is for admins only', async () => {
    expect((await testApp.app.inject({ method: 'GET', url: '/api/docs/openapi.json' })).statusCode).toBe(401);
    expect((await testApp.app.inject({ method: 'GET', url: '/api/docs' })).statusCode).toBe(401);
  });
});
