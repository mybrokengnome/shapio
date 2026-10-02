import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Role = {
  id: string;
  version: number;
  permissions: Array<{
    action: string;
    modelId: string | null;
    condition: null;
    fieldIds: string[] | null;
  }>;
};
type Delivered = { data: Record<string, unknown> };
type DeliveredList = { data: Array<Record<string, unknown>> };

/**
 * Brief §10 (Fields): a `public: false` field added live to a model that is already serving content is hidden
 * from delivery at once (reads, filters, sorts, field selection, GraphQL), and granting it to a delivery role
 * by field ID exposes it on the very next request, with no restart. A field added as explicitly public is
 * readable at once.
 */
describe('field visibility of fields added live', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let article: ModelBody;
  let role: Role;
  let token: string;
  let entry: EntryBody;

  const deliver = (url: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const deliverGraphql = (query: string, variables: Record<string, unknown> = {}) =>
    graphql(testApp.app, query, { variables, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    // The app listens for schema changes like a production instance.
    testApp = await createTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    role = expectStatus(
      await admin.post('/api/admin/roles', {
        key: 'site-reader',
        name: 'Site reader',
        kind: 'delivery',
        permissions: [{ action: 'read', modelId: article.definition.id, condition: null, fieldIds: null }],
      }),
      201,
    ).json<Role>();
    token = expectStatus(
      await admin.post('/api/admin/tokens', { name: 'Website', roleId: role.id }),
      201,
    ).json<{ token: string }>().token;
    entry = expectStatus(
      await admin.post('/api/admin/content/article', { data: { title: 'Live' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    // The site is already reading the model when the fields are added.
    expect(
      expectStatus(await deliver(`/api/content/articles/${entry.id}`), 200).json<Delivered>().data,
    ).toMatchObject({ title: 'Live' });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a field added with public: false is hidden from delivery immediately; public: true is readable at once', async () => {
    const response = await admin.put(`/api/admin/models/${article.definition.id}`, {
      definition: {
        ...article.definition,
        fields: [
          ...article.definition.fields,
          { apiKey: 'internalNotes', label: 'Internal notes', type: 'string', public: false },
          { apiKey: 'teaser', label: 'Teaser', type: 'string', public: true },
        ],
      },
      expectedVersion: article.version,
    });
    if (response.statusCode === 202) {
      await runContentSchemaJobs(database.current.db);
    } else {
      expectStatus(response, 200);
    }
    article = expectStatus(
      await admin.get(`/api/admin/models/${article.definition.id}`),
      200,
    ).json<ModelBody>();
    const current = expectStatus(
      await admin.get(`/api/admin/content/article/${entry.id}`),
      200,
    ).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/article/${entry.id}`, {
        expectedVersion: current.version,
        data: { title: 'Live', internalNotes: 'classified', teaser: 'Read me' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);

    const delivered = expectStatus(await deliver(`/api/content/articles/${entry.id}`), 200).json<Delivered>();
    expect(delivered.data).toMatchObject({ title: 'Live', teaser: 'Read me' });
    expect(delivered.data).not.toHaveProperty('internalNotes');
    expect(JSON.stringify(delivered)).not.toContain('classified');
    const listed = expectStatus(await deliver('/api/content/articles'), 200).json<DeliveredList>();
    expect(JSON.stringify(listed)).not.toContain('classified');

    for (const url of [
      '/api/content/articles?filters[internalNotes][$eq]=classified',
      '/api/content/articles?filters[internalNotes][$null]=false',
      '/api/content/articles?sort=internalNotes:asc',
      '/api/content/articles?fields=internalNotes',
    ]) {
      const refused = await deliver(url);
      expect(refused.statusCode, url).toBe(403);
      expect(refused.json(), url).toMatchObject({ error: { code: 'FORBIDDEN_FIELD' } });
    }
    const viaGraphql = await deliverGraphql(
      'query ($id: ID!) { article(id: $id) { title teaser internalNotes } }',
      {
        id: entry.id,
      },
    );
    expect(viaGraphql.body).toEqual({
      data: { article: { title: 'Live', teaser: 'Read me', internalNotes: null } },
    });
  });

  it('granting the field to the role by field ID exposes it on the next request, without a restart', async () => {
    const internalNotesId = fieldIdOf(article, 'internalNotes');
    const granted = expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/roles/${role.id}`,
        payload: {
          expectedVersion: role.version,
          // One read grant per model: the wildcard becomes an explicit list that names the private field.
          permissions: [
            {
              action: 'read',
              modelId: article.definition.id,
              condition: null,
              fieldIds: [fieldIdOf(article, 'title'), fieldIdOf(article, 'teaser'), internalNotesId],
            },
          ],
        },
      }),
      200,
    ).json<Role>();
    expect(granted.permissions[0]?.fieldIds).toContain(internalNotesId);

    const delivered = expectStatus(await deliver(`/api/content/articles/${entry.id}`), 200).json<Delivered>();
    expect(delivered.data).toMatchObject({ title: 'Live', teaser: 'Read me', internalNotes: 'classified' });
    const filtered = expectStatus(
      await deliver('/api/content/articles?filters[internalNotes][$eq]=classified'),
      200,
    ).json<DeliveredList>();
    expect(filtered.data.map((item) => item.id)).toEqual([entry.id]);
    const viaGraphql = await deliverGraphql('query ($id: ID!) { article(id: $id) { internalNotes } }', {
      id: entry.id,
    });
    expect(viaGraphql.body).toEqual({ data: { article: { internalNotes: 'classified' } } });

    // Other delivery roles still cannot see it.
    const other = expectStatus(
      await admin.post('/api/admin/roles', {
        key: 'other-reader',
        name: 'Other reader',
        kind: 'delivery',
        permissions: [{ action: 'read', modelId: article.definition.id, condition: null, fieldIds: null }],
      }),
      201,
    ).json<Role>();
    const otherToken = expectStatus(
      await admin.post('/api/admin/tokens', { name: 'Other site', roleId: other.id }),
      201,
    ).json<{ token: string }>().token;
    const hidden = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/articles/${entry.id}`,
        headers: { authorization: `Bearer ${otherToken}` },
      }),
      200,
    ).json<Delivered>();
    expect(hidden.data).not.toHaveProperty('internalNotes');
  });
});
