import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
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
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  roleKeyOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type WriteBody = { data: { id: string; version: number } };
type EntryResult = { id: string; version: number };

const CREATE = 'mutation ($data: PostInput) { createPost(data: $data) { id version } }';
const UPDATE =
  'mutation ($id: ID!, $data: PostInput, $v: Int) { updatePost(id: $id, data: $data, expectedVersion: $v) { id version } }';

const expectForbiddenField = (response: LightMyRequestResponse, fields: string[]) => {
  expectStatus(response, 403);
  expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN_FIELD', details: { fields } } });
};

/**
 * Issue #80: a field granted for writing only on the caller's own entries is writable only there, even when
 * another grant lets the caller write other fields on every entry. Issue #103: a restore is checked like any
 * other write, on every field it changes.
 */
describe('write masks per row', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let post: ModelBody;
  let userOne: AppSessionBody;
  let userTwo: AppSessionBody;
  let ownOnly: AppSessionBody;
  let postOne: string;
  let postTwo: string;
  let writer: string;

  const deliver = (method: 'POST' | 'PUT', url: string, token: string | undefined, payload: unknown) =>
    testApp.app.inject({
      method,
      url,
      payload: payload as InjectOptions['payload'],
      headers: token ? bearer(token) : {},
    });
  const gql = <T = Record<string, unknown>>(
    query: string,
    token: string,
    variables: Record<string, unknown>,
  ) => graphql<T>(testApp.app, query, { variables, headers: bearer(token) });
  const assignRoles = async (userId: string, roleIds: string[]) =>
    expectStatus(
      await admin.request({ method: 'PATCH', url: `/api/admin/app-users/${userId}`, payload: { roleIds } }),
      200,
    );
  const entry = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/post/${id}`), 200).json<EntryBody>();
  const titleOf = async (id: string) => (await entry(id)).data.title;
  const versionOf = async (id: string) => (await entry(id)).version;
  const createAs = async (session: AppSessionBody, data: Record<string, unknown>) =>
    expectStatus(
      await deliver('POST', '/api/content/posts', session.accessToken, { data }),
      201,
    ).json<WriteBody>().data.id;
  const putAs = async (session: AppSessionBody, id: string, data: Record<string, unknown>) =>
    deliver('PUT', `/api/content/posts/${id}`, session.accessToken, {
      expectedVersion: await versionOf(id),
      data,
    });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'body', label: 'Body', type: 'string' },
      ],
    });
    const modelId = post.definition.id;
    const title = fieldIdOf(post, 'title');
    const body = fieldIdOf(post, 'body');
    // The issue's roles: A updates `body` on every post, B updates `title` on own posts. Creating follows the
    // same split, so a new post's `title` is allowed because the post is the creator's own.
    const roleA = await createAppRole(database.current.db, [
      { action: 'update', modelId, fieldIds: [body] },
      { action: 'create', modelId, fieldIds: [body] },
    ]);
    const roleB = await createAppRole(database.current.db, [
      { action: 'update', modelId, condition: 'ownedByPrincipal', fieldIds: [title] },
      { action: 'create', modelId, condition: 'ownedByPrincipal', fieldIds: [title] },
    ]);
    writer = roleA;
    userOne = await signUp(testApp.app);
    userTwo = await signUp(testApp.app);
    ownOnly = await signUp(testApp.app);
    await assignRoles(userOne.user.id, [roleA, roleB]);
    await assignRoles(userTwo.user.id, [roleA, roleB]);
    await assignRoles(ownOnly.user.id, [roleB]);
    postOne = await createAs(userOne, { title: 'One', body: 'one' });
    postTwo = await createAs(userTwo, { title: 'Two', body: 'two' });
  });
  afterAll(async () => {
    await testApp.app.close();
  });
  beforeEach(async () => {
    await setPublicGrants(database.current.db, []);
    await setAuthenticatedGrants(database.current.db, []);
  });

  it('refuses an own-rows field on someone else’s entry and allows it on the caller’s own (REST)', async () => {
    expectForbiddenField(await putAs(userOne, postTwo, { title: 'changed' }), ['title']);
    expect(await titleOf(postTwo)).toBe('Two');
    // The field every row allows still goes through, alone.
    expectStatus(await putAs(userOne, postTwo, { body: 'edited by one' }), 200);
    expectForbiddenField(await putAs(userOne, postTwo, { title: 'changed', body: 'x' }), ['title']);
    expect((await entry(postTwo)).data).toEqual({ title: 'Two', body: 'edited by one' });

    expectStatus(await putAs(userOne, postOne, { title: 'One, edited' }), 200);
    expect(await titleOf(postOne)).toBe('One, edited');
  });

  it('allows own-rows fields on create, since the new entry is the caller’s own', async () => {
    const created = await createAs(userOne, { title: 'Fresh', body: 'fresh' });
    expect((await entry(created)).data).toEqual({ title: 'Fresh', body: 'fresh' });
  });

  it('refuses own-rows fields on create for callers who own nothing', async () => {
    const modelId = post.definition.id;
    // One grant per (action, model) and role: the every-row half goes on every model.
    await setPublicGrants(database.current.db, [
      { action: 'create', modelId: null, fieldIds: [fieldIdOf(post, 'body')] },
      { action: 'create', modelId, condition: 'ownedByPrincipal', fieldIds: [fieldIdOf(post, 'title')] },
    ]);
    expectForbiddenField(
      await deliver('POST', '/api/content/posts', undefined, { data: { title: 'anon', body: 'anon' } }),
      ['title'],
    );
    expectStatus(await deliver('POST', '/api/content/posts', undefined, { data: { body: 'anon' } }), 201);
  });

  it('keeps entries outside every row condition a 404, never a 403', async () => {
    const missing = await putAs(ownOnly, postTwo, { title: 'changed' });
    expectStatus(missing, 404);
    expect(await titleOf(postTwo)).toBe('Two');
  });

  it('refuses an own-rows field on someone else’s entry and allows it on the caller’s own (GraphQL)', async () => {
    const refused = await gql(UPDATE, userOne.accessToken, {
      id: postTwo,
      data: { title: 'changed' },
      v: await versionOf(postTwo),
    });
    expect(errorCodes(refused)).toEqual(['FORBIDDEN_FIELD']);
    expect(await titleOf(postTwo)).toBe('Two');

    const body = await gql<{ updatePost: EntryResult }>(UPDATE, userOne.accessToken, {
      id: postTwo,
      data: { body: 'body over GraphQL' },
      v: await versionOf(postTwo),
    });
    expect(dataOf(body).updatePost.id).toBe(postTwo);

    const own = await gql<{ updatePost: EntryResult }>(UPDATE, userOne.accessToken, {
      id: postOne,
      data: { title: 'One over GraphQL' },
      v: await versionOf(postOne),
    });
    expect(dataOf(own).updatePost.id).toBe(postOne);
    expect(await titleOf(postOne)).toBe('One over GraphQL');

    const created = await gql<{ createPost: EntryResult }>(CREATE, userOne.accessToken, {
      data: { title: 'Created over GraphQL', body: 'b' },
    });
    expect(await titleOf(dataOf(created).createPost.id)).toBe('Created over GraphQL');
  });

  describe('admin audience', () => {
    let editor: TestSession;
    let editorPost: string;

    const adminPut = (session: TestSession, id: string, version: number, data: Record<string, unknown>) =>
      testApp.app.inject({
        method: 'PUT',
        url: `/api/admin/content/post/${id}`,
        headers: session.headers,
        payload: { expectedVersion: version, data },
      });

    beforeAll(async () => {
      const modelId = post.definition.id;
      const role = await createRole(database.current.db, 'admin', [
        { action: 'read', modelId },
        { action: 'create', modelId },
        // One grant per (action, model) and role: the every-row half goes on every model.
        { action: 'update', modelId: null, fieldIds: [fieldIdOf(post, 'body')] },
        { action: 'update', modelId, condition: 'ownedByPrincipal', fieldIds: [fieldIdOf(post, 'title')] },
      ]);
      const account = await createAdmin(database.current.db, {
        roleKeys: [await roleKeyOf(database.current.db, role)],
      });
      editor = await login(testApp.app, account);
      editorPost = expectStatus(
        await testApp.app.inject({
          method: 'POST',
          url: '/api/admin/content/post',
          headers: editor.headers,
          payload: { data: { title: 'Editor', body: 'e' } },
        }),
        201,
      ).json<EntryBody>().id;
    });

    it('leaves roles without row conditions unchanged', async () => {
      const ownerSession = await login(testApp.app, await createAdmin(database.current.db));
      expectStatus(
        await adminPut(ownerSession, postTwo, await versionOf(postTwo), { title: 'By owner' }),
        200,
      );
      expect(await titleOf(postTwo)).toBe('By owner');
      expectStatus(
        await admin.put(`/api/admin/content/post/${postTwo}`, {
          expectedVersion: await versionOf(postTwo),
          data: { title: 'Two' },
        }),
        200,
      );
    });

    it('applies own-rows write grants to admin roles the same way', async () => {
      expectForbiddenField(await adminPut(editor, postTwo, await versionOf(postTwo), { title: 'x' }), [
        'title',
      ]);
      expectStatus(await adminPut(editor, postTwo, await versionOf(postTwo), { body: 'by editor' }), 200);
      expectStatus(await adminPut(editor, editorPost, await versionOf(editorPost), { title: 'Mine' }), 200);
      expect(await titleOf(editorPost)).toBe('Mine');
    });
  });

  describe('restoring a revision (issue #103)', () => {
    let restorer: SchemaClient;
    let story: ModelBody;
    // The revision that created the entry (revisions saved within one millisecond list in either order).
    const createRevisionOf = async (id: string) =>
      expectStatus(await admin.get(`/api/admin/content/story/${id}/revisions`), 200)
        .json<{ items: Array<{ id: string; reason: string }> }>()
        .items.find((item) => item.reason === 'create')?.id;

    const storyOf = async (id: string) =>
      expectStatus(await admin.get(`/api/admin/content/story/${id}`), 200).json<EntryBody>();
    const storyTitleOf = async (id: string) => (await storyOf(id)).data.title;

    beforeAll(async () => {
      // Localized fields: a restore changes them in its locale only, so they never count as shared changes.
      story = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'story',
        label: 'Story',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          { apiKey: 'body', label: 'Body', type: 'string', localized: true },
        ],
      });
      const modelId = story.definition.id;
      const role = await createRole(database.current.db, 'admin', [
        { action: 'read', modelId },
        { action: 'update', modelId, fieldIds: [fieldIdOf(story, 'body')] },
      ]);
      restorer = schemaClient(testApp.app, await createTokenForRole(database.current.db, role));
    });

    it('refuses a restore that changes a field the role may not write', async () => {
      const created = expectStatus(
        await admin.post('/api/admin/content/story', { data: { title: 'Old title', body: 'b' } }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/story/${created.id}`, {
          expectedVersion: created.version,
          data: { title: 'New title' },
        }),
        200,
      );
      const oldest = await createRevisionOf(created.id);
      const refused = await restorer.post(
        `/api/admin/content/story/${created.id}/revisions/${oldest}/restore`,
        {
          expectedVersion: (await storyOf(created.id)).version,
        },
      );
      expectForbiddenField(refused, ['title']);
      expect(await storyTitleOf(created.id)).toBe('New title');
    });

    it('allows a restore that changes only fields the role may write', async () => {
      const created = expectStatus(
        await admin.post('/api/admin/content/story', { data: { title: 'Same', body: 'old body' } }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/story/${created.id}`, {
          expectedVersion: created.version,
          data: { body: 'new body' },
        }),
        200,
      );
      const oldest = await createRevisionOf(created.id);
      expectStatus(
        await restorer.post(`/api/admin/content/story/${created.id}/revisions/${oldest}/restore`, {
          expectedVersion: (await storyOf(created.id)).version,
        }),
        200,
      );
      expect((await storyOf(created.id)).data).toEqual({ title: 'Same', body: 'old body' });
    });
  });

  it('keeps the unconditioned writer role usable on its own', async () => {
    await assignRoles(userTwo.user.id, [writer]);
    expectStatus(await putAs(userTwo, postOne, { body: 'by two' }), 200);
    expectForbiddenField(await putAs(userTwo, postOne, { title: 'x' }), ['title']);
    await assignRoles(userTwo.user.id, []);
  });
});
