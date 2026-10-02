import type { InjectOptions } from 'fastify';
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
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** The admin content API enforces the evaluator's policy: actions, field masks and row filters (ADR 0005). */
describe('content permissions', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let doc: ModelBody;

  const as = (session: TestSession) => (options: InjectOptions) =>
    testApp.app.inject({ ...options, headers: { ...session.headers, ...options.headers } });
  const sessionWith = async (grants: Parameters<typeof createRole>[2]) => {
    const roleId = await createRole(database.current.db, 'admin', grants);
    const user = await createAdmin(database.current.db, {
      roleKeys: [await roleKeyOf(database.current.db, roleId)],
    });
    return as(await login(testApp.app, user));
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
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

  it('a read-only role reads but cannot write', async () => {
    const reader = as(
      await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['read-only'] })),
    );
    expect((await reader({ method: 'GET', url: '/api/admin/content/doc' })).statusCode).toBe(200);
    const denied = await reader({
      method: 'POST',
      url: '/api/admin/content/doc',
      payload: { data: { title: 'x' } },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('field masks limit what a role reads and writes', async () => {
    const titleOnly = [fieldIdOf(doc, 'title')];
    const editor = await sessionWith([
      { action: 'read', modelId: doc.definition.id, fieldIds: titleOnly },
      { action: 'create', modelId: doc.definition.id, fieldIds: titleOnly },
      { action: 'update', modelId: doc.definition.id, fieldIds: titleOnly },
    ]);
    const masked = await editor({
      method: 'POST',
      url: '/api/admin/content/doc',
      payload: { data: { title: 't', notes: 'n' } },
    });
    expect(masked.statusCode).toBe(403);
    expect(masked.json()).toMatchObject({
      error: { code: 'FORBIDDEN_FIELD', details: { fields: ['notes'] } },
    });
    const created = expectStatus(
      await editor({ method: 'POST', url: '/api/admin/content/doc', payload: { data: { title: 't' } } }),
      201,
    ).json<EntryBody>();
    expect(created.data).toEqual({ title: 't' });
    expect(
      (await editor({ method: 'GET', url: '/api/admin/content/doc?filters[notes][$null]=true' })).statusCode,
    ).toBe(403);
  });

  it('ownedByPrincipal lets a role change only its own entries', async () => {
    const grants = [
      { action: 'read' as const, modelId: doc.definition.id },
      { action: 'create' as const, modelId: doc.definition.id },
      { action: 'update' as const, modelId: doc.definition.id, condition: 'ownedByPrincipal' as const },
    ];
    const alice = await sessionWith(grants);
    const bob = await sessionWith(grants);
    const mine = expectStatus(
      await alice({ method: 'POST', url: '/api/admin/content/doc', payload: { data: { title: 'alice' } } }),
      201,
    ).json<EntryBody>();
    const theirs = await bob({
      method: 'PUT',
      url: `/api/admin/content/doc/${mine.id}`,
      payload: { expectedVersion: 1, data: { title: 'bob' } },
    });
    expect(theirs.statusCode).toBe(404);
    expectStatus(
      await alice({
        method: 'PUT',
        url: `/api/admin/content/doc/${mine.id}`,
        payload: { expectedVersion: 1, data: { title: 'still alice' } },
      }),
      200,
    );
  });

  it('cookie-authenticated writes need the CSRF header', async () => {
    const owner = await login(testApp.app, await createAdmin(database.current.db));
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/api/admin/content/doc',
      headers: { cookie: owner.headers.cookie as string },
      payload: { data: { title: 'x' } },
    });
    expect(response.statusCode).toBe(403);
  });
});
