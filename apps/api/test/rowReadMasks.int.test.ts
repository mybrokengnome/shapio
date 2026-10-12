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
import { createDefinition, expectStatus, fieldIdOf, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Profile = { id: string; name: string; email?: string | null };
type DeliveryList = { data: Profile[] };
type WriteBody = { data: { id: string } };
type ProfileNodes = { profiles: { nodes: Profile[] } };

/**
 * Issue #75: a field granted only on the caller's own entries stays off every other entry, even when another
 * grant lets the caller read every entry. REST and GraphQL read through the same projection.
 */
describe('read masks per row', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let profile: ModelBody;
  let owner: AppSessionBody;
  let other: AppSessionBody;
  let ownProfileId: string;
  let otherProfileId: string;
  let ownOnly: string;

  const deliver = (url: string, token?: string, options: Partial<InjectOptions> = {}) =>
    testApp.app.inject({
      method: 'GET',
      url,
      ...options,
      headers: { ...(token ? bearer(token) : {}), ...options.headers },
    });
  const gql = <T = Record<string, unknown>>(
    query: string,
    token: string,
    variables?: Record<string, unknown>,
  ) => graphql<T>(testApp.app, query, { ...(variables ? { variables } : {}), headers: bearer(token) });
  const assignRoles = async (userId: string, roleIds: string[]) =>
    expectStatus(
      await admin.request({ method: 'PATCH', url: `/api/admin/app-users/${userId}`, payload: { roleIds } }),
      200,
    );
  const createProfile = async (session: AppSessionBody, data: Record<string, unknown>) =>
    expectStatus(
      await deliver('/api/content/profiles', session.accessToken, {
        method: 'POST',
        payload: { data, publish: true },
      }),
      201,
    ).json<WriteBody>().data.id;
  const byId = (profiles: readonly Profile[]) => new Map(profiles.map((entry) => [entry.id, entry]));

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    profile = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'profile',
      label: 'Profile',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', filterable: true },
        { apiKey: 'email', label: 'Email', type: 'string', public: false, filterable: true },
      ],
    });
    const modelId = profile.definition.id;
    const fieldIds = [fieldIdOf(profile, 'name'), fieldIdOf(profile, 'email')];
    const maker = await createAppRole(database.current.db, [
      { action: 'create', modelId, fieldIds },
      { action: 'publish', modelId, condition: 'ownedByPrincipal' },
    ]);
    ownOnly = await createAppRole(database.current.db, [
      { action: 'read', modelId, condition: 'ownedByPrincipal', fieldIds },
    ]);
    owner = await signUp(testApp.app);
    other = await signUp(testApp.app);
    await assignRoles(owner.user.id, [maker]);
    await assignRoles(other.user.id, [maker]);
    ownProfileId = await createProfile(owner, { name: 'Owner', email: 'owner@example.com' });
    otherProfileId = await createProfile(other, { name: 'Other', email: 'other@example.com' });
    await assignRoles(owner.user.id, [ownOnly]);
    await assignRoles(other.user.id, []);
  });
  afterAll(async () => {
    await testApp.app.close();
  });
  beforeEach(async () => {
    await setPublicGrants(database.current.db, []);
    // Every signed-in user reads every profile, public fields only.
    await setAuthenticatedGrants(database.current.db, [{ action: 'read', modelId: profile.definition.id }]);
  });

  it('shows a field granted on own entries only on the caller’s own entry (REST)', async () => {
    const list = expectStatus(
      await deliver('/api/content/profiles', owner.accessToken),
      200,
    ).json<DeliveryList>();
    const rows = byId(list.data);
    expect(rows.get(ownProfileId)).toMatchObject({ name: 'Owner', email: 'owner@example.com' });
    expect(rows.get(otherProfileId)).toMatchObject({ name: 'Other' });
    expect(rows.get(otherProfileId)).not.toHaveProperty('email');
    expect(JSON.stringify(list)).not.toContain('other@example.com');

    const selected = expectStatus(
      await deliver('/api/content/profiles?fields=email', owner.accessToken),
      200,
    ).json<DeliveryList>();
    expect(JSON.stringify(selected)).not.toContain('other@example.com');
    expect(byId(selected.data).get(ownProfileId)).toMatchObject({ email: 'owner@example.com' });

    const single = expectStatus(
      await deliver(`/api/content/profiles/${otherProfileId}`, owner.accessToken),
      200,
    ).json<{ data: Profile }>();
    expect(single.data).not.toHaveProperty('email');
    const own = expectStatus(
      await deliver(`/api/content/profiles/${ownProfileId}`, owner.accessToken),
      200,
    ).json<{ data: Profile }>();
    expect(own.data).toMatchObject({ email: 'owner@example.com' });

    // A user without the own-entries grant never sees the field.
    const plain = expectStatus(await deliver('/api/content/profiles', other.accessToken), 200);
    expect(plain.body).not.toContain('@example.com');
  });

  it('refuses filters, sorts and searches on a field hidden on some rows', async () => {
    const filtered = await deliver(
      '/api/content/profiles?filters[email][$eq]=other@example.com',
      owner.accessToken,
    );
    expect(filtered.statusCode).toBe(403);
    expect((await deliver('/api/content/profiles?sort=email:asc', owner.accessToken)).statusCode).toBe(403);
    expect(
      (await deliver('/api/content/profiles?filters[name][$eq]=Other', owner.accessToken)).statusCode,
    ).toBe(200);
  });

  it('keeps filtering on the field when every readable row is the caller’s own', async () => {
    await setAuthenticatedGrants(database.current.db, []);
    const list = expectStatus(
      await deliver('/api/content/profiles?filters[email][$eq]=owner@example.com', owner.accessToken),
      200,
    ).json<DeliveryList>();
    expect(list.data).toEqual([expect.objectContaining({ id: ownProfileId, email: 'owner@example.com' })]);
  });

  it('shows a field granted on own entries only on the caller’s own entry (GraphQL)', async () => {
    const result = await gql<ProfileNodes>('{ profiles { nodes { id name email } } }', owner.accessToken);
    const rows = byId(dataOf(result).profiles.nodes);
    expect(rows.get(ownProfileId)).toEqual({ id: ownProfileId, name: 'Owner', email: 'owner@example.com' });
    expect(rows.get(otherProfileId)).toEqual({ id: otherProfileId, name: 'Other', email: null });

    const single = await gql<{ profile: { email: string | null } }>(
      'query ($id: ID!) { profile(id: $id) { email } }',
      owner.accessToken,
      {
        id: otherProfileId,
      },
    );
    expect(dataOf(single).profile.email).toBeNull();

    const filtered = await gql(
      '{ profiles(filter: { email: { eq: "other@example.com" } }) { nodes { id } } }',
      owner.accessToken,
    );
    expect(errorCodes(filtered)).toEqual(['FORBIDDEN_FIELD']);
  });
});
