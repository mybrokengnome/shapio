import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  createAppRole,
  setAuthenticatedGrants,
  setPublicGrants,
  signUp,
  type AppSessionBody,
} from './helpers/appUsers.js';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, expectSameEntries, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryList = { data: Array<Record<string, unknown>> };
type EntryResult = { id: string; version: number; status: string; locale: string };

const LIST = '{ posts { nodes { id locale createdAt updatedAt publishedAt title } } }';
const CREATE =
  'mutation ($data: PostInput, $publish: Boolean) { createPost(data: $data, publish: $publish) { id version status locale } }';
const UPDATE =
  'mutation ($id: ID!, $data: PostInput, $v: Int) { updatePost(id: $id, data: $data, expectedVersion: $v) { id version status } }';
const DELETE = 'mutation ($id: ID!) { deletePost(id: $id) }';

/** GraphQL twins of appUserContent.int.test.ts: app users and anonymous callers under their roles. */
describe('GraphQL for app users (twins of the REST app-user tests)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let post: ModelBody;
  let published: EntryBody;
  let draftOnly: EntryBody;

  const deliver = (url: string, token?: string, options: Partial<InjectOptions> = {}) =>
    testApp.app.inject({
      method: 'GET',
      url,
      ...options,
      headers: { ...(token ? bearer(token) : {}), ...options.headers },
    });
  const gql = (query: string, variables?: Record<string, unknown>, token?: string) =>
    graphql(testApp.app, query, { ...(variables ? { variables } : {}), headers: token ? bearer(token) : {} });
  const one = (id: string, token?: string, fields = 'id locale createdAt updatedAt publishedAt title') =>
    gql(`query ($id: ID!) { post(id: $id) { ${fields} } }`, { id }, token);
  const createAsAdmin = async (data: Record<string, unknown>) =>
    expectStatus(await admin.post('/api/admin/content/post', { data }), 201).json<EntryBody>();
  const assignRoles = async (userId: string, roleIds: string[]) =>
    expectStatus(
      await admin.request({ method: 'PATCH', url: `/api/admin/app-users/${userId}`, payload: { roleIds } }),
      200,
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        { apiKey: 'notes', label: 'Notes', type: 'string', public: false, filterable: true },
      ],
    });
    published = await createAsAdmin({ title: 'Live', notes: 'internal note' });
    expectStatus(await admin.post(`/api/admin/content/post/${published.id}/publish`, {}), 200);
    draftOnly = await createAsAdmin({ title: 'Draft only', notes: 'draft note' });
  });
  afterAll(async () => {
    await testApp.app.close();
  });
  beforeEach(async () => {
    await setPublicGrants(database.current.db, []);
    await setAuthenticatedGrants(database.current.db, [{ action: 'read', modelId: null }]);
  });

  it('anonymous callers get nothing until `public` grants it', async () => {
    expect((await deliver('/api/content/posts')).statusCode).toBe(401);
    expect(errorCodes(await gql(LIST))).toEqual(['UNAUTHENTICATED']);
    expect(
      (await deliver('/api/content/posts', undefined, { method: 'POST', payload: { data: { title: 'x' } } }))
        .statusCode,
    ).toBe(403);
    expect(errorCodes(await gql(CREATE, { data: { title: 'x' } }))).toEqual(['FORBIDDEN']);
  });

  it('`public` cannot read unpublished content and sees only public fields it is granted', async () => {
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: post.definition.id }]);
    const rest = expectStatus(await deliver('/api/content/posts'), 200).json<DeliveryList>();
    const viaGraphql = dataOf(await gql(LIST)) as { posts: { nodes: unknown[] } };
    expectSameEntries(viaGraphql.posts.nodes, rest.data);
    expect(JSON.stringify(viaGraphql)).not.toContain('Draft only');
    expect(dataOf(await one(published.id, undefined, 'title notes'))).toEqual({
      post: { title: 'Live', notes: null },
    });
    expect(dataOf(await one(draftOnly.id))).toEqual({ post: null });
    expect((await deliver('/api/content/posts?filters[notes][$eq]=internal note')).statusCode).toBe(403);
    expect(
      errorCodes(await gql('{ posts(filter: { notes: { eq: "internal note" } }) { totalCount } }')),
    ).toEqual(['FORBIDDEN_FIELD']);

    await setPublicGrants(database.current.db, [
      { action: 'read', modelId: post.definition.id, fieldIds: [fieldIdOf(post, 'title')] },
    ]);
    const titleOnly = expectStatus(await deliver(`/api/content/posts/${published.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(dataOf(await one(published.id))).toEqual({ post: titleOnly.data });
  });

  it('a `public: false` field is invisible to app users unless a role grants it by ID', async () => {
    const session = await signUp(testApp.app);
    expect(dataOf(await one(published.id, session.accessToken, 'title notes'))).toEqual({
      post: { title: 'Live', notes: null },
    });
    expect(
      errorCodes(
        await gql(
          '{ posts(filter: { notes: { null: true } }) { totalCount } }',
          undefined,
          session.accessToken,
        ),
      ),
    ).toEqual(['FORBIDDEN_FIELD']);
    expect(dataOf(await one(draftOnly.id, session.accessToken))).toEqual({ post: null });

    const reader = await createAppRole(database.current.db, [
      {
        action: 'read',
        modelId: post.definition.id,
        fieldIds: [fieldIdOf(post, 'title'), fieldIdOf(post, 'notes')],
      },
    ]);
    await assignRoles(session.user.id, [reader]);
    const rest = expectStatus(
      await deliver(`/api/content/posts/${published.id}`, session.accessToken),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>();
    expect(
      dataOf(
        await one(published.id, session.accessToken, 'id locale createdAt updatedAt publishedAt title notes'),
      ),
    ).toEqual({
      post: rest.data,
    });
    expect(rest.data).toMatchObject({ notes: 'internal note' });
  });

  describe('owner-only writes', () => {
    let alice: AppSessionBody;
    let bob: AppSessionBody;

    beforeAll(async () => {
      const writer = await createAppRole(database.current.db, [
        { action: 'create', modelId: post.definition.id, fieldIds: [fieldIdOf(post, 'title')] },
        { action: 'update', modelId: post.definition.id, condition: 'ownedByPrincipal' },
        { action: 'delete', modelId: post.definition.id, condition: 'ownedByPrincipal' },
      ]);
      alice = await signUp(testApp.app);
      bob = await signUp(testApp.app);
      await assignRoles(alice.user.id, [writer]);
      await assignRoles(bob.user.id, [writer]);
    });

    it('needs a grant to create, and never writes masked fields', async () => {
      const outsider = await signUp(testApp.app);
      expect(errorCodes(await gql(CREATE, { data: { title: 'no' } }, outsider.accessToken))).toEqual([
        'FORBIDDEN',
      ]);
      const masked = await gql(CREATE, { data: { title: 't', notes: 'n' } }, alice.accessToken);
      expect(masked.body.errors?.[0]?.extensions).toMatchObject({
        code: 'FORBIDDEN_FIELD',
        details: { fields: ['notes'] },
      });
      expect(
        errorCodes(await gql(CREATE, { data: { title: 't' }, publish: true }, alice.accessToken)),
      ).toEqual(['FORBIDDEN']);
    });

    it('records the owner server-side; another user cannot update or delete; the owner can', async () => {
      const created = (
        dataOf(await gql(CREATE, { data: { title: 'Alice post' } }, alice.accessToken)) as {
          createPost: EntryResult;
        }
      ).createPost;
      expect(created).toMatchObject({ status: 'draft', version: 1 });
      const entry = await database.current.db
        .selectFrom('entries')
        .select(['owner_app_user_id', 'created_by_admin_id'])
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(entry).toEqual({ owner_app_user_id: alice.user.id, created_by_admin_id: null });

      expect(
        errorCodes(await gql(UPDATE, { id: created.id, data: { title: 'Bob' }, v: 1 }, bob.accessToken)),
      ).toEqual(['ENTRY_NOT_FOUND']);
      expect(errorCodes(await gql(DELETE, { id: created.id }, bob.accessToken))).toEqual(['ENTRY_NOT_FOUND']);
      await setPublicGrants(database.current.db, [
        { action: 'update', modelId: post.definition.id, condition: 'ownedByPrincipal' },
      ]);
      expect(errorCodes(await gql(UPDATE, { id: created.id, data: { title: 'anon' }, v: 1 }))).toEqual([
        'ENTRY_NOT_FOUND',
      ]);

      const updated = (
        dataOf(
          await gql(UPDATE, { id: created.id, data: { title: 'Alice edited' }, v: 1 }, alice.accessToken),
        ) as { updatePost: EntryResult }
      ).updatePost;
      expect(updated.version).toBe(2);
      expect(
        errorCodes(await gql(UPDATE, { id: created.id, data: { title: 'stale' }, v: 1 }, alice.accessToken)),
      ).toEqual(['CONTENT_VERSION_CONFLICT']);
      expect(
        errorCodes(
          await gql(
            'mutation ($id: ID!) { updatePost(id: $id, data: { title: "x" }) { id } }',
            { id: created.id },
            alice.accessToken,
          ),
        ),
      ).toEqual(['INVALID_INPUT']);
      const adminView = (await admin.get(`/api/admin/content/post/${created.id}`)).json<EntryBody>();
      expect(adminView.data.title).toBe('Alice edited');
      expect(dataOf(await gql(DELETE, { id: created.id }, alice.accessToken))).toEqual({
        deletePost: created.id,
      });
      expect((await admin.get(`/api/admin/content/post/${created.id}`)).statusCode).toBe(404);
    });

    it('cannot touch entries created by an administrator', async () => {
      expect(
        errorCodes(await gql(UPDATE, { id: published.id, data: { title: 'x' }, v: 1 }, alice.accessToken)),
      ).toEqual(['ENTRY_NOT_FOUND']);
      expect(errorCodes(await gql(DELETE, { id: published.id }, alice.accessToken))).toEqual([
        'ENTRY_NOT_FOUND',
      ]);
    });

    it('cannot read drafts through publicationState', async () => {
      const result = await gql(
        '{ posts(publicationState: DRAFT) { totalCount } }',
        undefined,
        alice.accessToken,
      );
      expect(errorCodes(result)).toEqual(['FORBIDDEN']);
    });
  });
});
