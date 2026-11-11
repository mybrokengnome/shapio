import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_DEPTH } from '../src/constants/requestBody.js';
import { nestsDeeperThan } from '../src/helpers/jsonDepth.js';
import { bearer } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** A json value `levels` deep (JSON_DEPTH counting). */
const nested = (levels: number): unknown => {
  let value: unknown = 1;
  for (let level = 1; level < levels; level += 1) {
    value = level % 2 === 0 ? [value] : { a: value };
  }
  return value;
};

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });
/** A bullet list nested `levels` deep, one item per level. */
const bulletList = (levels: number): unknown => ({
  type: 'bulletList',
  content: [
    {
      type: 'listItem',
      content: [paragraph(`level ${levels}`), ...(levels > 1 ? [bulletList(levels - 1)] : [])],
    },
  ],
});

/**
 * One body depth limit before any validation (`MAX_BODY_DEPTH`, plugins/textInput.ts): 422 `BODY_TOO_DEEP` on every
 * write route, never a 500 (MySQL stores JSON at most 100 levels deep; the text check walked bodies recursively).
 */
describe('request body depth', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let deepest: ModelBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    // Components nested as deep as the schema allows (5), the innermost holding rich text and json.
    let inner = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'level5',
        label: 'Level 5',
        fields: [
          { apiKey: 'body', label: 'Body', type: 'richtext' },
          { apiKey: 'doc', label: 'Doc', type: 'json' },
        ],
      },
      'components',
    );
    for (const level of [4, 3, 2]) {
      inner = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: `level${level}`,
          label: `Level ${level}`,
          fields: [
            {
              apiKey: 'items',
              label: 'Items',
              type: 'component',
              settings: { component: inner.definition.id, repeatable: true },
            },
          ],
        },
        'components',
      );
    }
    deepest = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'deep',
      label: 'Deep',
      fields: [
        { apiKey: 'doc', label: 'Doc', type: 'json' },
        {
          apiKey: 'items',
          label: 'Items',
          type: 'component',
          settings: { component: inner.definition.id, repeatable: true },
        },
      ],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  /** `data` with the innermost component holding rich text with six nested lists, and `doc`. */
  const deepestData = (doc: unknown) => {
    let item: Record<string, unknown> = {
      body: { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content: [bulletList(6)] } },
      doc,
    };
    for (let level = 0; level < 3; level += 1) {
      item = { items: [item] };
    }
    return { items: [item] };
  };

  it('stores the deepest content the schema invites, on every database, well under the limit', async () => {
    const data = deepestData('x');
    expect(nestsDeeperThan({ data }, MAX_BODY_DEPTH - 10)).toBe(false);
    expectStatus(await admin.post('/api/admin/content/deep', { data }), 201);
  });

  it('accepts a body exactly at the limit and stores it, and refuses one level more with 422', async () => {
    // `{ data: { doc: … } }` adds two levels to the json value.
    const atLimit = { data: { doc: nested(MAX_BODY_DEPTH - 2) } };
    expect(nestsDeeperThan(atLimit, MAX_BODY_DEPTH)).toBe(false);
    const created = expectStatus(await admin.post('/api/admin/content/deep', atLimit), 201).json<EntryBody>();
    const over = { data: { doc: nested(MAX_BODY_DEPTH - 1) } };
    for (const response of [
      await admin.post('/api/admin/content/deep', over),
      await admin.put(`/api/admin/content/deep/${created.id}`, { expectedVersion: created.version, ...over }),
      await testApp.app.inject({
        method: 'PUT',
        url: `/api/content/deeps/${created.id}`,
        headers: bearer(adminToken),
        payload: { expectedVersion: created.version, ...over },
      }),
    ]) {
      expect([response.statusCode, response.json<{ error: { code: string } }>().error.code]).toEqual([
        422,
        'BODY_TOO_DEEP',
      ]);
    }
  });

  it('refuses GraphQL variables past the limit the same way, and any depth never answers 5xx', async () => {
    const result = await graphql(
      testApp.app,
      'mutation ($data: DeepInput) { createDeep(data: $data) { id } }',
      {
        headers: bearer(adminToken),
        variables: { data: { doc: nested(MAX_BODY_DEPTH) } },
      },
    );
    expect(result.statusCode).toBe(422);
    // Sent as text: building these as objects would take the client's own serializer past its stack.
    for (const levels of [200, 5_000, 100_000]) {
      const response = await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/content/deep',
        headers: { ...bearer(adminToken), 'content-type': 'application/json' },
        payload: `{"data":{"doc":${'['.repeat(levels)}${']'.repeat(levels)}}}`,
      });
      expect([response.statusCode, response.json<{ error: { code: string } }>().error.code]).toEqual([
        422,
        'BODY_TOO_DEEP',
      ]);
    }
    expect(deepest.definition.apiKey).toBe('deep');
  });
});
