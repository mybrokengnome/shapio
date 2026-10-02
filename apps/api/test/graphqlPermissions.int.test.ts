import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createRole,
  expectStatus,
  fieldIdOf,
  roleKeyOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Actor = {
  rest: (options: InjectOptions) => Promise<LightMyRequestResponse>;
  gql: (query: string, variables?: Record<string, unknown>) => ReturnType<typeof graphql>;
};

/** GraphQL twins of contentPermissions.int.test.ts: the same evaluator, masks, row filters and CSRF rules. */
describe('GraphQL content permissions (twins of the REST permission tests)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let doc: ModelBody;

  const as = (session: TestSession): Actor => ({
    rest: (options) =>
      testApp.app.inject({ ...options, headers: { ...session.headers, ...options.headers } }),
    gql: (query, variables) =>
      graphql(testApp.app, query, { ...(variables ? { variables } : {}), headers: session.headers }),
  });
  const sessionWith = async (grants: Parameters<typeof createRole>[2]) => {
    const roleId = await createRole(database.current.db, 'admin', grants);
    const user = await createAdmin(database.current.db, {
      roleKeys: [await roleKeyOf(database.current.db, roleId)],
    });
    return as(await login(testApp.app, user));
  };
  const DRAFTS =
    '{ docs(publicationState: DRAFT, sort: [{ createdAt: ASC }]) { nodes { id title notes } totalCount } }';
  const CREATE = 'mutation ($data: DocInput) { createDoc(data: $data) { id version status } }';
  const UPDATE =
    'mutation ($id: ID!, $data: DocInput, $v: Int) { updateDoc(id: $id, data: $data, expectedVersion: $v) { id version } }';

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    doc = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'doc',
      label: 'Doc',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'notes', label: 'Notes', type: 'string' },
      ],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a read-only role reads (drafts too) but cannot write', async () => {
    const reader = as(
      await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['read-only'] })),
    );
    const rest = expectStatus(await reader.rest({ method: 'GET', url: '/api/admin/content/doc' }), 200).json<{
      items: Array<{ id: string; data: Record<string, unknown> }>;
    }>();
    const drafts = dataOf(await reader.gql(DRAFTS)) as { docs: { totalCount: number } };
    expect(drafts.docs.totalCount).toBe(rest.items.length);
    expect(
      (
        await reader.rest({
          method: 'POST',
          url: '/api/admin/content/doc',
          payload: { data: { title: 'x' } },
        })
      ).statusCode,
    ).toBe(403);
    const denied = await reader.gql(CREATE, { data: { title: 'x' } });
    expect(errorCodes(denied)).toEqual(['FORBIDDEN']);
    expect(denied.body.data).toEqual({ createDoc: null });
  });

  it('field masks limit what a role reads and writes', async () => {
    const titleOnly = [fieldIdOf(doc, 'title')];
    const editor = await sessionWith([
      { action: 'read', modelId: doc.definition.id, fieldIds: titleOnly },
      { action: 'create', modelId: doc.definition.id, fieldIds: titleOnly },
      { action: 'update', modelId: doc.definition.id, fieldIds: titleOnly },
    ]);
    const restMasked = await editor.rest({
      method: 'POST',
      url: '/api/admin/content/doc',
      payload: { data: { title: 't', notes: 'n' } },
    });
    expect(restMasked.json()).toMatchObject({
      error: { code: 'FORBIDDEN_FIELD', details: { fields: ['notes'] } },
    });
    const masked = await editor.gql(CREATE, { data: { title: 't', notes: 'n' } });
    expect(masked.body.errors?.[0]?.extensions).toMatchObject({
      code: 'FORBIDDEN_FIELD',
      details: { fields: ['notes'] },
    });

    const created = dataOf(await editor.gql(CREATE, { data: { title: 'via graphql' } })) as {
      createDoc: { id: string; status: string };
    };
    expect(created.createDoc.status).toBe('draft');
    const restView = expectStatus(
      await editor.rest({ method: 'GET', url: `/api/admin/content/doc/${created.createDoc.id}` }),
      200,
    ).json<EntryBody>();
    expect(restView.data).toEqual({ title: 'via graphql' });
    const draft = dataOf(
      await editor.gql('query ($id: ID!) { doc(id: $id, publicationState: DRAFT) { title notes } }', {
        id: created.createDoc.id,
      }),
    );
    expect(draft).toEqual({ doc: { title: 'via graphql', notes: null } });

    expect(
      (await editor.rest({ method: 'GET', url: '/api/admin/content/doc?filters[notes][$null]=true' }))
        .statusCode,
    ).toBe(403);
    expect(
      errorCodes(
        await editor.gql(
          '{ docs(publicationState: DRAFT, filter: { notes: { null: true } }) { totalCount } }',
        ),
      ),
    ).toEqual(['FORBIDDEN_FIELD']);
  });

  it('ownedByPrincipal lets a role change only its own entries', async () => {
    const grants = [
      { action: 'read' as const, modelId: doc.definition.id },
      { action: 'create' as const, modelId: doc.definition.id },
      { action: 'update' as const, modelId: doc.definition.id, condition: 'ownedByPrincipal' as const },
    ];
    const alice = await sessionWith(grants);
    const bob = await sessionWith(grants);
    const mine = (
      dataOf(await alice.gql(CREATE, { data: { title: 'alice' } })) as { createDoc: { id: string } }
    ).createDoc;
    const restTheirs = await bob.rest({
      method: 'PUT',
      url: `/api/admin/content/doc/${mine.id}`,
      payload: { expectedVersion: 1, data: { title: 'bob' } },
    });
    expect(restTheirs.statusCode).toBe(404);
    expect(errorCodes(await bob.gql(UPDATE, { id: mine.id, data: { title: 'bob' }, v: 1 }))).toEqual([
      'ENTRY_NOT_FOUND',
    ]);
    const updated = dataOf(
      await alice.gql(UPDATE, { id: mine.id, data: { title: 'still alice' }, v: 1 }),
    ) as {
      updateDoc: { version: number };
    };
    expect(updated.updateDoc.version).toBe(2);
  });

  it('cookie-authenticated requests need the CSRF header, for queries and mutations', async () => {
    const owner = await login(testApp.app, await createAdmin(database.current.db));
    const cookieOnly = { cookie: owner.headers.cookie as string };
    const rest = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/content/doc',
      headers: cookieOnly,
      payload: { data: { title: 'x' } },
    });
    expect(rest.statusCode).toBe(403);
    for (const method of ['POST', 'GET'] as const) {
      const result = await graphql(testApp.app, '{ docs { totalCount } }', {
        headers: cookieOnly,
        method,
      });
      expect(result.statusCode, method).toBe(403);
      expect(errorCodes(result), method).toEqual(['CSRF_INVALID']);
    }
    const mutation = await graphql(testApp.app, CREATE, {
      variables: { data: { title: 'x' } },
      headers: cookieOnly,
    });
    expect(mutation.statusCode).toBe(403);
    // With the header, the same session works over both methods.
    for (const method of ['POST', 'GET'] as const) {
      const ok = await graphql(testApp.app, '{ docs(publicationState: DRAFT) { totalCount } }', {
        headers: owner.headers,
        method,
      });
      expect(ok.statusCode, method).toBe(200);
      expect(ok.body.errors, method).toBeUndefined();
    }
  });

  it('refuses a mutation sent over GET, even with a valid session and CSRF header', async () => {
    const owner = await login(testApp.app, await createAdmin(database.current.db));
    const countDocs = async () =>
      dataOf(
        await graphql<{ docs: { totalCount: number } }>(
          testApp.app,
          '{ docs(publicationState: DRAFT) { totalCount } }',
          { headers: owner.headers },
        ),
      ).docs.totalCount;
    const before = await countDocs();
    const viaGet = await graphql(testApp.app, CREATE, {
      variables: { data: { title: 'over GET' } },
      headers: owner.headers,
      method: 'GET',
    });
    expect(viaGet.statusCode).toBe(405);
    expect(viaGet.body.data ?? null).toBeNull();
    expect(await countDocs()).toBe(before);
  });
});
