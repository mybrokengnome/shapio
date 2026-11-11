import type { RequestFn } from '@shapio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../src/constants/version.js';
import {
  createDeliveryRuntime,
  createInProcessRequest,
  type DeliveryRuntime,
} from '../src/delivery/index.js';
import { publishServerRelease } from '../src/services/deliveryDescriptor.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { isSqliteRun } from './helpers/dialect.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id: string; [key: string]: unknown };
type Delivered = { data: { cards: Item[]; hero: Item | null; zone: Item[] } };

/** Items without their IDs, for content comparisons. */
const content = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(content)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, item]) => [key, content(item)]),
        )
      : value;

/** Storage data without item IDs, as content stored before item IDs existed. */
const legacy = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(legacy)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([key, item]) => [key, legacy(item)]),
        )
      : value;

/**
 * Item IDs (plan item-ids) end to end: every API shows the same `id` for the same stored item; items stored
 * without one read with a derived ID that a write persists; writes answer the IDs they wrote; conversions,
 * restores and copies keep (or renew) them.
 */
describe('component item IDs', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let page: ModelBody;
  let card: ModelBody;
  let alice: AppSessionBody;

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/page/${id}`), 200).json<EntryBody>();
  const create = async (data: Record<string, unknown>) => {
    const entry = expectStatus(await admin.post('/api/admin/content/page', { data }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
    return entry;
  };
  const delivered = async (id: string, query = '') =>
    expectStatus(
      await request('GET', `/api/content/pages/${id}${query}`, alice.accessToken),
      200,
    ).json<Delivered>();
  /** Strips the item IDs from an entry's stored heads: content saved before item IDs existed. */
  const makeLegacy = async (id: string) => {
    const { db } = database.current;
    const heads = await db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
    for (const head of heads) {
      await db
        .updateTable('entry_heads')
        .set({ data: legacy(head.data) as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state)
        .execute();
    }
    // Revisions are immutable: the heads alone are enough for reads and writes.
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
          { apiKey: 'count', label: 'Count', type: 'integer' },
        ],
      },
      'components',
    );
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: card.definition.id } },
        {
          apiKey: 'zone',
          label: 'Zone',
          type: 'dynamiczone',
          settings: { components: [card.definition.id] },
        },
      ],
    });
    alice = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${alice.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [
              { action: 'read', modelId: page.definition.id },
              { action: 'create', modelId: page.definition.id },
              { action: 'update', modelId: page.definition.id },
            ]),
          ],
        },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const twoCards = [
    { heading: 'A', note: 'nA', count: 1 },
    { heading: 'B', note: 'nB', count: 2 },
  ];

  it('shows the same id for the same item in the admin API, REST delivery and GraphQL', async () => {
    const entry = await create({
      cards: twoCards,
      hero: { heading: 'H' },
      zone: [{ __component: 'card', heading: 'Z' }],
    });
    const stored = (await adminView(entry.id)).data as Delivered['data'];
    const read = (await delivered(entry.id)).data;
    expect(read.cards.map((item) => item.id)).toEqual(stored.cards.map((item) => item.id));
    expect(read.hero?.id).toBe(stored.hero?.id);
    expect(read.zone.map((item) => item.id)).toEqual(stored.zone.map((item) => item.id));
    expect(new Set([...stored.cards, stored.hero, ...stored.zone].map((item) => item?.id)).size).toBe(4);
    const gql = dataOf(
      await graphql<{ page: { cards: Array<{ id: string }>; hero: { id: string } } }>(
        testApp.app,
        'query ($id: ID!) { page(id: $id) { cards { id } hero { id } } }',
        { headers: bearer(alice.accessToken), variables: { id: entry.id } },
      ),
    );
    expect(gql.page.cards.map((item) => item.id)).toEqual(stored.cards.map((item) => item.id));
    expect(gql.page.hero.id).toBe(stored.hero?.id);
  });

  it('derives stable IDs for items stored without one, the same in the draft and the published version', async () => {
    const entry = await create({ cards: twoCards });
    await makeLegacy(entry.id);
    const draft = ((await adminView(entry.id)).data as Delivered['data']).cards;
    const published = (await delivered(entry.id)).data.cards;
    expect(draft.map((item) => item.id)).toEqual(published.map((item) => item.id));
    expect(((await adminView(entry.id)).data as Delivered['data']).cards).toEqual(draft);
    // A write that sends them back persists them: after it, the stored items hold the same IDs.
    const response = expectStatus(
      await request('PUT', `/api/content/pages/${entry.id}`, alice.accessToken, {
        expectedVersion: (await adminView(entry.id)).version,
        data: {
          cards: [
            { id: published[1]?.id, heading: 'B2', count: 2 },
            { id: published[0]?.id, heading: 'A', count: 1 },
          ],
        },
      }),
      200,
    );
    const after = ((await adminView(entry.id)).data as Delivered['data']).cards;
    expect(after.map((item) => item.id)).toEqual([published[1]?.id, published[0]?.id]);
    expect(content(after)).toEqual([
      { heading: 'B2', note: 'nB', count: 2 },
      { heading: 'A', note: 'nA', count: 1 },
    ]);
    const { db } = database.current;
    const head = await db
      .selectFrom('entry_heads')
      .select('data')
      .where('entry_id', '=', entry.id)
      .where('state', '=', 'draft')
      .executeTakeFirstOrThrow();
    const field = page.definition.fields.find((candidate) => candidate.apiKey === 'cards')?.id as string;
    expect(
      ((head.data as Record<string, unknown>)[field] as Array<{ __id: string }>).map((item) => item.__id),
    ).toEqual(after.map((item) => item.id));
    expect(response.json<{ data: { itemIds: unknown } }>().data.itemIds).toEqual({
      cards: after.map((item) => ({ id: item.id })),
    });
  });

  it('answers the IDs a create wrote, in the caller’s names, and ignores the IDs a create sends', async () => {
    const created = expectStatus(
      await request('POST', '/api/content/pages', alice.accessToken, {
        data: {
          cards: [{ id: 'mine', heading: 'A' }],
          hero: { heading: 'H' },
          zone: [{ __component: 'card', heading: 'Z' }],
        },
      }),
      201,
    ).json<{ data: { id: string; itemIds: Record<string, unknown> } }>().data;
    const stored = (await adminView(created.id)).data as Delivered['data'];
    expect(stored.cards[0]?.id).not.toBe('mine');
    expect(created.itemIds).toEqual({
      cards: [{ id: stored.cards[0]?.id }],
      hero: { id: stored.hero?.id },
      zone: [{ id: stored.zone[0]?.id, __component: 'card' }],
    });
  });

  it('a GraphQL item sent with `id: null` is a new item', async () => {
    const entry = await create({ cards: twoCards });
    const result = await graphql(
      testApp.app,
      `
        mutation ($id: ID!, $v: Int, $data: PageInput) {
          updatePage(id: $id, expectedVersion: $v, data: $data) {
            id
          }
        }
      `,
      {
        headers: bearer(alice.accessToken),
        variables: {
          id: entry.id,
          v: (await adminView(entry.id)).version,
          data: { cards: [{ id: null, heading: 'A' }] },
        },
      },
    );
    dataOf(result);
    const after = ((await adminView(entry.id)).data as Delivered['data']).cards;
    expect(content(after)).toEqual([{ heading: 'A', note: null, count: null }]);
  });

  it('keeps IDs through a restore, renews them in a copy, and persists them through a conversion', async () => {
    const entry = await create({ cards: twoCards });
    const ids = ((await adminView(entry.id)).data as Delivered['data']).cards.map((item) => item.id);
    // A restore brings back the revision's items with their IDs.
    const { items: revisions } = expectStatus(
      await admin.get(`/api/admin/content/page/${entry.id}/revisions`),
      200,
    ).json<{ items: Array<{ id: string; reason: string }> }>();
    const createdRevision = revisions.find((revision) => revision.reason === 'create')?.id;
    expectStatus(
      await admin.put(`/api/admin/content/page/${entry.id}`, {
        expectedVersion: (await adminView(entry.id)).version,
        data: { cards: [] },
      }),
      200,
    );
    expectStatus(
      await admin.post(`/api/admin/content/page/${entry.id}/revisions/${createdRevision}/restore`, {
        expectedVersion: (await adminView(entry.id)).version,
      }),
      200,
    );
    expect(((await adminView(entry.id)).data as Delivered['data']).cards.map((item) => item.id)).toEqual(ids);
    // A copy renews every ID.
    const copy = expectStatus(
      await admin.post(`/api/admin/content/page/${entry.id}/duplicate`, {}),
      201,
    ).json<EntryBody>();
    const copied = ((await adminView(copy.id)).data as Delivered['data']).cards;
    expect(content(copied)).toEqual(content(twoCards.map((item) => ({ ...item }))));
    expect(copied.some((item) => ids.includes(item.id))).toBe(false);
    // A conversion of a field inside the items persists the IDs they read with (stored without any here).
    await makeLegacy(entry.id);
    const before = ((await adminView(entry.id)).data as Delivered['data']).cards.map((item) => item.id);
    const current = (await admin.get(`/api/admin/components/${card.definition.id}`)).json<ModelBody>();
    const changed = await admin.put(`/api/admin/components/${card.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map(({ editor, ...field }) =>
          field.apiKey === 'count' ? { ...field, type: 'string', settings: {} } : { ...field, editor },
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], changed.body).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
    const converted = ((await adminView(entry.id)).data as Delivered['data']).cards;
    expect(converted.map((item) => item.count)).toEqual(['1', '2']);
    expect(converted.map((item) => item.id)).toEqual(before);
    const head = await database.current.db
      .selectFrom('entry_heads')
      .select('data')
      .where('entry_id', '=', entry.id)
      .where('state', '=', 'draft')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(head.data)).toContain(before[0] as string);
  });

  describe.skipIf(isSqliteRun())('in-process delivery', () => {
    let runtime: DeliveryRuntime;
    let local: RequestFn;
    let token: string;
    beforeAll(async () => {
      await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
      runtime = createDeliveryRuntime({ databaseUrl: database.current.url, poolMax: 2 });
      token = await createDeliveryToken(database.current.db, [{ modelId: page.definition.id }]);
      local = createInProcessRequest(runtime, { token });
    });
    afterAll(async () => {
      await runtime?.close();
    });

    it('shows the same IDs as the HTTP API, for items stored with and without one', async () => {
      const cards = [{ heading: 'A', note: 'nA' }, { heading: 'B' }];
      const entry = await create({ cards });
      const legacyEntry = await create({ cards });
      await makeLegacy(legacyEntry.id);
      for (const id of [entry.id, legacyEntry.id]) {
        const read = await local<Delivered>(`/api/content/pages/${id}`);
        const http = expectStatus(
          await request('GET', `/api/content/pages/${id}`, token),
          200,
        ).json<Delivered>();
        expect(read.data.cards.map((item) => item.id)).toEqual(http.data.cards.map((item) => item.id));
        expect(read.data.cards.map((item) => item.id)).toEqual(
          (await delivered(id)).data.cards.map((item) => item.id),
        );
      }
    });
  });
});
