import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createAppRole, setPublicGrants, signUp, type AppSessionBody } from './helpers/appUsers.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const CREATE = 'mutation ($data: PostInput) { createPost(data: $data) { id } }';

const expectForbidden = (response: LightMyRequestResponse) => {
  expectStatus(response, 403);
  expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
};

/**
 * Issue #105: a create granted only on the caller's own entries is refused, before any write, for callers
 * that own nothing they create (anonymous callers and tokens). App users with the same grant still create.
 */
describe('create grants limited to own entries', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let post: ModelBody;
  let appUser: AppSessionBody;
  let deliveryToken: string;
  let adminToken: string;

  const createPost = (token: string | undefined, title: string) =>
    testApp.app.inject({
      method: 'POST',
      url: '/api/content/posts',
      payload: { data: { title } },
      headers: token ? bearer(token) : {},
    });
  const titles = async () =>
    expectStatus(await admin.get('/api/admin/content/post'), 200)
      .json<{ items: Array<{ data: { title?: string } }> }>()
      .items.map((item) => item.data.title);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const ownCreate = [
      { action: 'create', modelId: post.definition.id, condition: 'ownedByPrincipal' },
    ] as const;
    appUser = await signUp(testApp.app);
    const appRole = await createAppRole(database.current.db, ownCreate);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${appUser.user.id}`,
        payload: { roleIds: [appRole] },
      }),
      200,
    );
    deliveryToken = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', ownCreate),
    );
    adminToken = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'admin', ownCreate),
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });
  beforeEach(async () => {
    // The issue's setup: the site's `public` role may create posts, own entries only.
    await setPublicGrants(database.current.db, [
      { action: 'create', modelId: post.definition.id, condition: 'ownedByPrincipal' },
    ]);
  });

  it('refuses anonymous callers and writes nothing', async () => {
    expectForbidden(await createPost(undefined, 'anonymous'));
    const result = await graphql(testApp.app, CREATE, { variables: { data: { title: 'anonymous gql' } } });
    expect(errorCodes(result)).toContain('FORBIDDEN');
    expect(await titles()).not.toContain('anonymous');
    expect(await titles()).not.toContain('anonymous gql');
  });

  it('refuses API tokens holding the same grant', async () => {
    // Delivery tokens never create (their roles read only); admin-role tokens own nothing they create.
    expectForbidden(await createPost(deliveryToken, 'delivery token'));
    expectForbidden(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/content/post',
        payload: { data: { title: 'admin token' } },
        headers: bearer(adminToken),
      }),
    );
    expect(await titles()).not.toContain('delivery token');
    expect(await titles()).not.toContain('admin token');
  });

  it('lets an app user with the same grant create', async () => {
    expectStatus(await createPost(appUser.accessToken, 'mine'), 201);
    expect(await titles()).toContain('mine');
  });
});
