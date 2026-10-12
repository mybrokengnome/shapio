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
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Issue #104: duplicating an entry copies only the values the caller may read on the source row. Fields
 * hidden by the per-row read masks of #75 are left empty on the copy, like unique fields.
 */
describe('duplicating under read masks per row', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let fullAdmin: SchemaClient;
  let profile: ModelBody;
  let userOne: TestSession;
  let userTwo: TestSession;

  const post = (session: TestSession, url: string, payload: unknown = {}) =>
    testApp.app.inject({ method: 'POST', url, headers: session.headers, payload: payload as object });
  const getAs = (session: TestSession, id: string) =>
    testApp.app.inject({ method: 'GET', url: `/api/admin/content/profile/${id}`, headers: session.headers });
  const createProfile = async (session: TestSession, data: Record<string, unknown>) =>
    expectStatus(await post(session, '/api/admin/content/profile', { data }), 201).json<EntryBody>().id;
  const duplicate = async (session: TestSession, id: string) =>
    expectStatus(await post(session, `/api/admin/content/profile/${id}/duplicate`), 201).json<EntryBody>();
  const storedData = async (id: string) =>
    expectStatus(await fullAdmin.get(`/api/admin/content/profile/${id}`), 200).json<EntryBody>().data;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    fullAdmin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    profile = await createDefinition(fullAdmin, {
      kind: 'collection',
      apiKey: 'profile',
      label: 'Profile',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', required: true },
        { apiKey: 'email', label: 'Email', type: 'string', required: true },
      ],
    });
    const modelId = profile.definition.id;
    const name = fieldIdOf(profile, 'name');
    const email = fieldIdOf(profile, 'email');
    // The issue's roles: read every profile with `name`, read own profiles with `name` and `email`.
    const everyRow = await createRole(database.current.db, 'admin', [
      { action: 'read', modelId, fieldIds: [name] },
      { action: 'create', modelId },
      { action: 'update', modelId },
    ]);
    const ownRows = await createRole(database.current.db, 'admin', [
      { action: 'read', modelId, condition: 'ownedByPrincipal', fieldIds: [name, email] },
    ]);
    const roleKeys = [
      await roleKeyOf(database.current.db, everyRow),
      await roleKeyOf(database.current.db, ownRows),
    ];
    userOne = await login(testApp.app, await createAdmin(database.current.db, { roleKeys }));
    userTwo = await login(testApp.app, await createAdmin(database.current.db, { roleKeys }));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('leaves out values the caller cannot read on someone else’s entry', async () => {
    const source = await createProfile(userTwo, { name: 'Two', email: 'two@example.com' });
    const copy = await duplicate(userOne, source);
    expect(copy.data.name).toBe('Two');
    expect(JSON.stringify(copy)).not.toContain('two@example.com');
    // The copy is the caller's own, so the own-entries grant would show a copied email: none is stored.
    const own = expectStatus(await getAs(userOne, copy.id), 200).json<EntryBody>();
    expect(own.data.name).toBe('Two');
    expect(own.data.email ?? null).toBeNull();
    const stored = await storedData(copy.id);
    expect(stored.name).toBe('Two');
    expect(stored.email ?? null).toBeNull();
  });

  it('copies every readable value from the caller’s own entry', async () => {
    const source = await createProfile(userOne, { name: 'One', email: 'one@example.com' });
    const copy = await duplicate(userOne, source);
    expect(copy.data).toMatchObject({ name: 'One', email: 'one@example.com' });
    expect(await storedData(copy.id)).toMatchObject({ name: 'One', email: 'one@example.com' });
  });

  it('copies every value for an admin with a full mask', async () => {
    const source = await createProfile(userTwo, { name: 'Full', email: 'full@example.com' });
    const copy = expectStatus(
      await fullAdmin.request({ method: 'POST', url: `/api/admin/content/profile/${source}/duplicate` }),
      201,
    ).json<EntryBody>();
    expect(await storedData(copy.id)).toMatchObject({ name: 'Full', email: 'full@example.com' });
  });
});
