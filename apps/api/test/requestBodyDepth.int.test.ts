import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_DEPTH, MAX_CONTENT_DEPTH } from '../src/constants/requestBody.js';
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

const link = { type: 'link', attrs: { href: 'https://example.com' } };
/**
 * Rich text as deep as the validator allows (`MAX_RICHTEXT_DEPTH` 40 node levels below the doc), the deepest
 * text carrying a link: 86 JSON levels.
 */
const deepestRichText = () => {
  let node: Record<string, unknown> = {
    type: 'paragraph',
    content: [{ type: 'text', text: 'deepest', marks: [link] }],
  };
  // doc (0) > 38 blockquotes (1-38) > paragraph (39) > text (40)
  for (let level = 0; level < 38; level += 1) {
    node = { type: 'blockquote', content: [node] };
  }
  return { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content: [node] } };
};

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
    for (const level of [4, 3, 2, 1]) {
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

  /** `data` with the innermost of five component lists holding `body` (rich text) and `doc`. */
  const deepestData = (body: unknown, doc: unknown) => {
    let item: Record<string, unknown> = { body, doc };
    for (let level = 0; level < 4; level += 1) {
      item = { items: [item] };
    }
    return { items: [item] };
  };

  it('stores the deepest content the validator accepts, on every database, within the limit', async () => {
    // Five component lists (10 levels) around rich text 86 levels deep, in the data object: 97.
    const data = deepestData(deepestRichText(), 'x');
    expect(nestsDeeperThan(data, 97)).toBe(false);
    expect(nestsDeeperThan(data, 96)).toBe(true);
    const created = expectStatus(
      await admin.post('/api/admin/content/deep', { data }),
      201,
    ).json<EntryBody>();
    const read = expectStatus(
      await admin.get(`/api/admin/content/deep/${created.id}`),
      200,
    ).json<EntryBody>();
    // Saved back exactly as read (item IDs included), and published: every write path takes it.
    expectStatus(
      await admin.put(`/api/admin/content/deep/${created.id}`, {
        expectedVersion: read.version,
        data: read.data,
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/deep/${created.id}/publish`, {}), 200);
    const variables = await graphql(
      testApp.app,
      'mutation ($data: DeepInput) { createDeep(data: $data) { id } }',
      { headers: bearer(adminToken), variables: { data: deepestData(deepestRichText(), 'x') } },
    );
    expect(variables.statusCode).toBe(200);
  });

  it('accepts a body exactly at the limit and stores it, and refuses one level more with 422', async () => {
    // `{ data: { doc: … } }` adds two levels to the json value: the data is `MAX_CONTENT_DEPTH` deep, as much
    // as MySQL stores.
    expect(MAX_BODY_DEPTH).toBe(MAX_CONTENT_DEPTH + 1);
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

  it('takes GraphQL variables and literals exactly as deep as a REST body, and refuses one level more', async () => {
    const create = (doc: unknown) =>
      graphql(testApp.app, 'mutation ($data: DeepInput) { createDeep(data: $data) { id } }', {
        headers: bearer(adminToken),
        variables: { data: { doc } },
      });
    expect((await create(nested(MAX_CONTENT_DEPTH - 1))).statusCode).toBe(200);
    expect((await create(nested(MAX_CONTENT_DEPTH))).statusCode).toBe(422);
    /** A GraphQL literal `levels` deep: `{a: [ ... ]}` alternating, as `nested` builds it. */
    const literal = (levels: number): string => {
      let text = '1';
      for (let level = 1; level < levels; level += 1) {
        text = level % 2 === 0 ? `[${text}]` : `{a: ${text}}`;
      }
      return text;
    };
    const inline = (levels: number) =>
      graphql(testApp.app, `mutation { createDeep(data: { doc: ${literal(levels)} }) { id } }`, {
        headers: bearer(adminToken),
      });
    expect((await inline(MAX_CONTENT_DEPTH - 1)).statusCode).toBe(200);
    expect((await inline(MAX_CONTENT_DEPTH)).statusCode).toBe(422);
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
