import { SEO_COMPONENT_ID, SEO_FIELD_IDS } from '@shapio/schema';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type EnsureBody = { status: 'existing' | 'created'; definitionId: string; version: number };
type ComponentBody = {
  definition: { id: string; apiKey: string; fields: Array<{ id: string; apiKey: string }> };
  scope: 'network' | 'site';
};

const ENSURE = '/api/admin/components/builtin/seo/ensure';
const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

/**
 * The built-in SEO component (plan seo-fields): created shared on first use through the change planner,
 * returned as it is afterwards, never by a site admin, and refused when another definition holds `seo`.
 */
describe('the built-in SEO component', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let marketingAdmin: SchemaClient;
  let marketingId: string;

  const onMarketing = (client: SchemaClient, url: string, payload?: unknown) =>
    client.request({
      method: payload === undefined ? 'GET' : 'POST',
      url,
      headers: { [SITE_HEADER]: 'marketing' },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    marketingId = expectStatus(
      await network.post('/api/admin/sites', { key: 'marketing', name: 'Marketing' }),
      201,
    ).json<{
      id: string;
    }>().id;
    // The admin role, held on the marketing site only: schema.create there, not on every site.
    marketingAdmin = schemaClient(
      testApp.app,
      await createRoleToken(database.current.db, 'admin', marketingId),
    );
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('refuses a site admin while it does not exist (it would be shared with every site)', async () => {
    const response = await onMarketing(marketingAdmin, ENSURE, {});
    expect(response.statusCode).toBe(403);
  });

  it('refuses while another definition holds the API ID, naming it and its site', async () => {
    const imported = expectStatus(
      await onMarketing(marketingAdmin, '/api/admin/components', {
        definition: {
          kind: 'component',
          apiKey: 'seo',
          label: 'Imported SEO',
          fields: [{ apiKey: 'metaTitle', label: 'Meta title', type: 'string' }],
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    const refused = await network.post(ENSURE, {});
    expect(refused.statusCode).toBe(409);
    expect(codeOf(refused)).toBe('SEO_COMPONENT_CONFLICT');
    expect(refused.json<{ error: { details: unknown } }>().error.details).toMatchObject({
      definitionId: imported.definitionId,
      apiKey: 'seo',
      scope: 'site',
      siteKey: 'marketing',
    });
    const current = (
      await onMarketing(marketingAdmin, `/api/admin/components/${imported.definitionId}`)
    ).json<{ version: number }>();
    expectStatus(
      await marketingAdmin.request({
        method: 'DELETE',
        url: `/api/admin/components/${imported.definitionId}?expectedVersion=${current.version}`,
        headers: { [SITE_HEADER]: 'marketing' },
      }),
      200,
    );
  });

  it('creates it shared with the fixed IDs, then returns it unchanged (idempotent)', async () => {
    const before = (await network.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
    const created = expectStatus(await network.post(ENSURE, {}), 201).json<EnsureBody>();
    expect(created).toMatchObject({ status: 'created', definitionId: SEO_COMPONENT_ID, version: 1 });
    const after = (await network.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
    expect(after).toBe(before + 1);

    const component = expectStatus(
      await network.get(`/api/admin/components/${SEO_COMPONENT_ID}`),
      200,
    ).json<ComponentBody>();
    expect(component.scope).toBe('network');
    expect(component.definition.apiKey).toBe('seo');
    expect(component.definition.fields.map((field) => field.id)).toEqual(Object.values(SEO_FIELD_IDS));

    const again = expectStatus(await network.post(ENSURE, {}), 200).json<EnsureBody>();
    expect(again).toMatchObject({ status: 'existing', definitionId: SEO_COMPONENT_ID, version: 1 });
    expect((await network.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion).toBe(
      after,
    );
  });

  it('is there for a site admin once it exists, and a site model can hold it', async () => {
    const existing = expectStatus(await onMarketing(marketingAdmin, ENSURE, {}), 200).json<EnsureBody>();
    expect(existing.status).toBe('existing');
    const model = await onMarketing(marketingAdmin, '/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string' },
          {
            apiKey: 'seo',
            label: 'SEO',
            type: 'component',
            settings: { component: SEO_COMPONENT_ID },
            editor: { id: 'seoEditor' },
          },
        ],
      },
    });
    expect(model.statusCode, model.body).toBe(201);
  });

  it('refuses the SEO editor on another component field', async () => {
    const other = expectStatus(
      await network.post('/api/admin/components', {
        definition: {
          kind: 'component',
          apiKey: 'hero',
          label: 'Hero',
          fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
        },
        scope: 'network',
      }),
      201,
    ).json<{ definitionId: string }>();
    const refused = await network.post('/api/admin/models', {
      definition: {
        kind: 'collection',
        apiKey: 'landing',
        label: 'Landing',
        fields: [
          {
            apiKey: 'hero',
            label: 'Hero',
            type: 'component',
            settings: { component: other.definitionId },
            editor: { id: 'seoEditor' },
          },
        ],
      },
      scope: 'network',
    });
    expect(refused.statusCode).toBe(422);
  });
});
