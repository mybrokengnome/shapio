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
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryList = { data: Array<Record<string, unknown>> };
type WriteBody = { data: { id: string; version: number; status: string } & Record<string, unknown> };

/**
 * Brief §10 authorization tests extended to app users and anonymous callers (build plan §4.I3–I4): the
 * `public` and `authenticated` app roles, delivery field masks, owner-only writes through the delivery API.
 */
describe('app users and the delivery API', () => {
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
  const write = (
    method: 'POST' | 'PUT' | 'DELETE',
    url: string,
    token: string | undefined,
    payload?: unknown,
  ) =>
    deliver(url, token, {
      method,
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
  const createAsAdmin = async (data: Record<string, unknown>) =>
    expectStatus(await admin.post('/api/admin/content/post', { data }), 201).json<EntryBody>();
  const assignRoles = async (userId: string, roleIds: string[]) =>
    expectStatus(
      await admin.request({ method: 'PATCH', url: `/api/admin/app-users/${userId}`, payload: { roleIds } }),
      200,
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
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
    expect((await write('POST', '/api/content/posts', undefined, { data: { title: 'x' } })).statusCode).toBe(
      403,
    );
  });

  it('`public` cannot read unpublished content and sees only public fields it is granted', async () => {
    await setPublicGrants(database.current.db, [{ action: 'read', modelId: post.definition.id }]);
    const list = expectStatus(await deliver('/api/content/posts'), 200).json<DeliveryList>();
    expect(list.data.map((entry) => entry.title)).toEqual(['Live']);
    expect(list.data[0]).not.toHaveProperty('notes');
    expect(JSON.stringify(list)).not.toContain('internal note');
    expect(JSON.stringify(list)).not.toContain('Draft only');
    expect((await deliver(`/api/content/posts/${draftOnly.id}`)).statusCode).toBe(404);
    const hiddenFilter = await deliver('/api/content/posts?filters[notes][$eq]=internal note');
    expect(hiddenFilter.statusCode).toBe(403);
    expect(hiddenFilter.json()).toMatchObject({ error: { code: 'FORBIDDEN_FIELD' } });
    // Anonymous responses are publicly cacheable; they vary by credentials.
    expect((await deliver('/api/content/posts')).headers['cache-control']).toMatch(/^public/);

    // Only the fields it names: a grant listing `title` alone shows `title` alone.
    await setPublicGrants(database.current.db, [
      { action: 'read', modelId: post.definition.id, fieldIds: [fieldIdOf(post, 'title')] },
    ]);
    const titleOnly = expectStatus(await deliver(`/api/content/posts/${published.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(titleOnly.data).toMatchObject({ title: 'Live' });
    expect(titleOnly.data).not.toHaveProperty('notes');
  });

  it('a `public: false` field is invisible to app users unless a role grants it by ID', async () => {
    const session = await signUp(testApp.app);
    const before = expectStatus(
      await deliver(`/api/content/posts/${published.id}`, session.accessToken),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>();
    expect(before.data).toMatchObject({ title: 'Live' });
    expect(before.data).not.toHaveProperty('notes');
    expect(
      (await deliver('/api/content/posts?filters[notes][$null]=true', session.accessToken)).statusCode,
    ).toBe(403);
    expect((await deliver(`/api/content/posts/${draftOnly.id}`, session.accessToken)).statusCode).toBe(404);
    expect((await deliver('/api/content/posts', session.accessToken)).headers['cache-control']).toMatch(
      /^private/,
    );

    const reader = await createAppRole(database.current.db, [
      {
        action: 'read',
        modelId: post.definition.id,
        fieldIds: [fieldIdOf(post, 'title'), fieldIdOf(post, 'notes')],
      },
    ]);
    await assignRoles(session.user.id, [reader]);
    // The same access token: the role change bumped the permissions version, so it is re-validated.
    const after = expectStatus(
      await deliver(`/api/content/posts/${published.id}`, session.accessToken),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>();
    expect(after.data).toMatchObject({ title: 'Live', notes: 'internal note' });
  });

  describe('owner-only writes', () => {
    let writer: string;
    let alice: AppSessionBody;
    let bob: AppSessionBody;

    beforeAll(async () => {
      writer = await createAppRole(database.current.db, [
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
      expect(
        (await write('POST', '/api/content/posts', outsider.accessToken, { data: { title: 'no' } }))
          .statusCode,
      ).toBe(403);
      const masked = await write('POST', '/api/content/posts', alice.accessToken, {
        data: { title: 't', notes: 'n' },
      });
      expect(masked.statusCode).toBe(403);
      expect(masked.json()).toMatchObject({
        error: { code: 'FORBIDDEN_FIELD', details: { fields: ['notes'] } },
      });
      // Publishing needs the publish grant.
      expect(
        (
          await write('POST', '/api/content/posts', alice.accessToken, {
            data: { title: 't' },
            publish: true,
          })
        ).statusCode,
      ).toBe(403);
    });

    it('records the owner server-side; another user cannot update or delete; the owner can', async () => {
      const created = expectStatus(
        await write('POST', '/api/content/posts', alice.accessToken, { data: { title: 'Alice post' } }),
        201,
      ).json<WriteBody>();
      expect(created.data).toMatchObject({ status: 'draft', version: 1 });
      // Writes return identity and state, never values (the result is a draft).
      expect(JSON.stringify(created)).not.toContain('Alice post');
      const entry = await database.current.db
        .selectFrom('entries')
        .select(['owner_app_user_id', 'created_by_admin_id'])
        .where('id', '=', created.data.id)
        .executeTakeFirstOrThrow();
      expect(entry).toEqual({ owner_app_user_id: alice.user.id, created_by_admin_id: null });

      const url = `/api/content/posts/${created.data.id}`;
      const bobUpdate = await write('PUT', url, bob.accessToken, {
        expectedVersion: 1,
        data: { title: 'Bob' },
      });
      expect(bobUpdate.statusCode).toBe(404);
      expect((await write('DELETE', url, bob.accessToken)).statusCode).toBe(404);
      // Anonymous callers own nothing, even where `public` may update.
      await setPublicGrants(database.current.db, [
        { action: 'update', modelId: post.definition.id, condition: 'ownedByPrincipal' },
      ]);
      expect(
        (await write('PUT', url, undefined, { expectedVersion: 1, data: { title: 'anon' } })).statusCode,
      ).toBe(404);

      const updated = expectStatus(
        await write('PUT', url, alice.accessToken, { expectedVersion: 1, data: { title: 'Alice edited' } }),
        200,
      ).json<WriteBody>();
      expect(updated.data.version).toBe(2);
      expect(
        (await write('PUT', url, alice.accessToken, { expectedVersion: 1, data: { title: 'stale' } }))
          .statusCode,
      ).toBe(409);
      const adminView = (await admin.get(`/api/admin/content/post/${created.data.id}`)).json<EntryBody>();
      expect(adminView.data.title).toBe('Alice edited');
      expectStatus(await write('DELETE', url, alice.accessToken), 204);
      expect((await admin.get(`/api/admin/content/post/${created.data.id}`)).statusCode).toBe(404);
    });

    it('cannot touch entries created by an administrator', async () => {
      const url = `/api/content/posts/${published.id}`;
      expect(
        (await write('PUT', url, alice.accessToken, { expectedVersion: 1, data: { title: 'x' } })).statusCode,
      ).toBe(404);
      expect((await write('DELETE', url, alice.accessToken)).statusCode).toBe(404);
    });
  });
});
