import type { RequestFn } from '@shapio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { bearer, setAuthenticatedGrants, setPublicGrants, signUp } from './helpers/appUsers.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { dataOf, errorCodes, graphql } from './helpers/graphql.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Delivered = { data: Record<string, unknown> };

/** One stored address: `hidden` and the nested box's `secret` are `public: false`. */
const ADDRESS = { city: 'Paris', hidden: 'h1', inner: { open: 'o', secret: 's3cret' } };
/** What delivery audiences see of it. */
const SHOWN = { city: 'Paris', inner: { open: 'o' } };
const HIDDEN_VALUES = ['h1', 's3cret'];

const ZONE_SELECTION = '__typename ... on Address { city inner { open } }';
const GRAPHQL_ENTRY = `query ($id: ID!) { thing(id: $id) {
  addr { city inner { open } }
  addrs { city inner { open } }
  zone { ${ZONE_SELECTION} }
} }`;
const GRAPHQL_SHOWN = { city: 'Paris', inner: { open: 'o' } };

/**
 * A component's `public: false` fields (issue #9): delivery audiences (delivery tokens, app users, anonymous
 * callers, previews) never see them, in single, repeatable and dynamic-zone components nested to any depth,
 * through REST, GraphQL and in-process delivery. Grants name model fields only, so no grant shows them to a
 * delivery audience. Admin audiences see everything.
 */
describe('component fields with public: false', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let thing: ModelBody;
  let entry: EntryBody;
  let token: string;
  let session: TestSession;

  const get = (url: string, credential?: string) =>
    testApp.app.inject({ method: 'GET', url, headers: credential ? bearer(credential) : {} });
  const expectHidden = (data: Record<string, unknown>) => {
    expect(data).toMatchObject({
      addr: SHOWN,
      addrs: [SHOWN, SHOWN],
      zone: [{ __component: 'address', ...SHOWN }],
    });
    expect(JSON.stringify(data)).not.toMatch(new RegExp(HIDDEN_VALUES.join('|')));
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const box = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'box',
        label: 'Box',
        fields: [
          { apiKey: 'open', label: 'Open', type: 'string' },
          { apiKey: 'secret', label: 'Secret', type: 'string', public: false, required: true },
        ],
      },
      'components',
    );
    const address = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'address',
        label: 'Address',
        fields: [
          { apiKey: 'city', label: 'City', type: 'string' },
          { apiKey: 'hidden', label: 'Hidden', type: 'string', public: false },
          { apiKey: 'inner', label: 'Inner', type: 'component', settings: { component: box.definition.id } },
        ],
      },
      'components',
    );
    thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'thing',
      label: 'Thing',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'addr',
          label: 'Address',
          type: 'component',
          settings: { component: address.definition.id },
        },
        {
          apiKey: 'addrs',
          label: 'Addresses',
          type: 'component',
          settings: { component: address.definition.id, repeatable: true },
        },
        {
          apiKey: 'zone',
          label: 'Zone',
          type: 'dynamiczone',
          settings: { components: [address.definition.id] },
        },
      ],
    });
    entry = expectStatus(
      await admin.post('/api/admin/content/thing', {
        data: {
          title: 'One',
          addr: ADDRESS,
          addrs: [ADDRESS, ADDRESS],
          zone: [{ __component: 'address', ...ADDRESS }],
        },
        publish: true,
      }),
      201,
    ).json<EntryBody>();
    token = await createDeliveryToken(database.current.db, [{ modelId: thing.definition.id }]);
    session = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['editor'] }));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('REST delivery leaves them out for a delivery token, an anonymous caller and an app user', async () => {
    expectHidden(
      expectStatus(await get(`/api/content/things/${entry.id}`, token), 200).json<Delivered>().data,
    );
    const list = expectStatus(await get('/api/content/things', token), 200).json<{
      data: Delivered['data'][];
    }>();
    expectHidden(list.data[0] ?? {});

    await setPublicGrants(database.current.db, [{ action: 'read', modelId: thing.definition.id }]);
    expectHidden(expectStatus(await get(`/api/content/things/${entry.id}`), 200).json<Delivered>().data);
    await setPublicGrants(database.current.db, []);

    const appUser = await signUp(testApp.app);
    await setAuthenticatedGrants(database.current.db, [{ action: 'read', modelId: thing.definition.id }]);
    expectHidden(
      expectStatus(await get(`/api/content/things/${entry.id}`, appUser.accessToken), 200).json<Delivered>()
        .data,
    );
  });

  it('a grant that names every model field still does not show them to a delivery token', async () => {
    const named = await createDeliveryToken(database.current.db, [
      { modelId: thing.definition.id, fieldIds: thing.definition.fields.map((field) => field.id) },
    ]);
    expectHidden(
      expectStatus(await get(`/api/content/things/${entry.id}`, named), 200).json<Delivered>().data,
    );
  });

  it('filters into a component stay refused', async () => {
    for (const url of [
      '/api/content/things?filters[addr.hidden][$eq]=h1',
      '/api/content/things?filters[addr][hidden][$eq]=h1',
      '/api/content/things?sort=addr.hidden:asc',
      '/api/content/things?fields=addr.hidden',
    ]) {
      const refused = await get(url, token);
      expect(refused.statusCode, url).toBe(400);
      expect(refused.body, url).not.toMatch(/h1/);
    }
  });

  it("GraphQL leaves them out of a delivery caller's schema", async () => {
    const result = await graphql(testApp.app, GRAPHQL_ENTRY, {
      variables: { id: entry.id },
      headers: bearer(token),
    });
    expect(dataOf(result)).toEqual({
      thing: {
        addr: GRAPHQL_SHOWN,
        addrs: [GRAPHQL_SHOWN, GRAPHQL_SHOWN],
        zone: [{ __typename: 'Address', ...GRAPHQL_SHOWN }],
      },
    });
    for (const query of [
      'query ($id: ID!) { thing(id: $id) { addr { hidden } } }',
      'query ($id: ID!) { thing(id: $id) { addr { inner { secret } } } }',
      'query ($id: ID!) { thing(id: $id) { zone { ... on Address { hidden } } } }',
    ]) {
      const refused = await graphql(testApp.app, query, {
        variables: { id: entry.id },
        headers: bearer(token),
      });
      expect(refused.statusCode, query).toBe(400);
      expect(errorCodes(refused), query).toEqual(['GRAPHQL_VALIDATION_FAILED']);
      expect(JSON.stringify(refused.body)).not.toMatch(new RegExp(HIDDEN_VALUES.join('|')));
    }
    const types = dataOf<Record<'address' | 'box' | 'input', { fields?: Array<{ name: string }> } | null>>(
      await graphql(
        testApp.app,
        '{ address: __type(name: "Address") { fields { name } } box: __type(name: "Box") { fields { name } } input: __type(name: "AddressInput") { name } }',
        { headers: bearer(token) },
      ),
    );
    expect(types.address?.fields?.map((field) => field.name)).toEqual(['city', 'inner']);
    expect(types.box?.fields?.map((field) => field.name)).toEqual(['open']);
    // A delivery token writes nothing, so its schema has no inputs to name them either.
    expect(types.input).toBeNull();
  });

  it('admin audiences still see every component field (REST delivery, admin API and GraphQL)', async () => {
    const full = { city: 'Paris', hidden: 'h1', inner: { open: 'o', secret: 's3cret' } };
    const delivered = expectStatus(
      await get(`/api/content/things/${entry.id}`, adminToken),
      200,
    ).json<Delivered>();
    expect(delivered.data).toMatchObject({
      addr: full,
      addrs: [full, full],
      zone: [{ __component: 'address', ...full }],
    });
    const adminView = expectStatus(
      await admin.get(`/api/admin/content/thing/${entry.id}`),
      200,
    ).json<EntryBody>();
    expect(adminView.data).toMatchObject({ addr: full, addrs: [full, full] });
    const result = await graphql(
      testApp.app,
      'query ($id: ID!) { thing(id: $id) { addr { hidden inner { secret } } } }',
      {
        variables: { id: entry.id },
        headers: bearer(adminToken),
      },
    );
    expect(dataOf(result)).toEqual({ thing: { addr: { hidden: 'h1', inner: { secret: 's3cret' } } } });
  });

  it('preview tokens show what the site would see', async () => {
    const { token: previewToken } = expectStatus(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/preview/tokens',
        headers: session.headers,
        payload: { modelKey: 'thing', entryId: entry.id },
      }),
      201,
    ).json<{ token: string }>();
    const preview = expectStatus(
      await get(`/api/preview/content/things/${entry.id}`, previewToken),
      200,
    ).json<Delivered>();
    expectHidden(preview.data);
  });

  const inProcessSkip = dialectSkipReason(import.meta.url, 'in-process delivery');
  describe.skipIf(inProcessSkip !== undefined)(withSkipReason('in-process delivery', inProcessSkip), () => {
    let runtime: DeliveryRuntime;
    let local: RequestFn;

    beforeAll(async () => {
      await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
      runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
      local = createInProcessRequest(runtime, { token });
    });
    afterAll(async () => {
      await runtime?.close();
    });

    it('leaves them out exactly as the HTTP API does', async () => {
      const read = await local<Delivered>(`/api/content/things/${entry.id}`);
      expectHidden(read.data);
      expect(read).toStrictEqual(
        expectStatus(await get(`/api/content/things/${entry.id}`, token), 200).json(),
      );
    });
  });
});
