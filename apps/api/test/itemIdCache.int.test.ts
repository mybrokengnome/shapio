import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearItemIdCache, itemIdCacheStats, setItemIdCacheEnabled } from '../src/content/itemIdCache.js';
import { itemIdKeyOf, itemIdsDerived } from '../src/content/itemIds.js';
import { bearer } from './helpers/appUsers.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id: string; [key: string]: unknown };

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
 * The item ID cache (plan item-ids-perf, content/itemIdCache.ts): a repeated read of content stored without item
 * IDs derives nothing; every API answers byte for byte what it answers with the cache off, after every kind of
 * change to a head; and a write sending back the IDs a cached read showed continues those same items.
 */
describe('item ID cache', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let deliveryToken: string;
  let page: ModelBody;
  let lpage: ModelBody;
  const pages: string[] = [];
  let lpageId = '';

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const adminView = async (model: string, id: string, query = '') =>
    expectStatus(await admin.get(`/api/admin/content/${model}/${id}${query}`), 200).json<EntryBody>();

  /** Rewrites the heads' data in place without their IDs: no version, sequence, revision or time moves. */
  const makeLegacy = async (
    id: string,
    edit: (data: Record<string, unknown>) => unknown = (data) => data,
  ) => {
    const { db } = database.current;
    const heads = await db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
    for (const head of heads) {
      await db
        .updateTable('entry_heads')
        .set({ data: legacy(edit(head.data as Record<string, unknown>)) as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state)
        .execute();
    }
  };

  const cards = (prefix: string) => [
    { heading: `${prefix}A`, note: 'hidden', inner: [{ text: 'x' }, { text: 'x' }] },
    { heading: `${prefix}B`, note: 'hidden' },
    { heading: `${prefix}A`, note: 'hidden', inner: [{ text: 'x' }, { text: 'x' }] },
  ];

  /** Every read the cache serves: admin list and entry, delivery list and entry, snapshot, lensed, GraphQL. */
  const reads = async (): Promise<string[]> => {
    const current = expectStatus(await request('GET', '/api/snapshots/current', deliveryToken), 200).json<{
      snapshot: number;
      schemaVersionToken: string;
    }>();
    const version = encodeURIComponent(current.schemaVersionToken);
    const urls: Array<[string, string]> = [
      ['/api/admin/content/page?pageSize=100', adminToken],
      ...pages.map((id): [string, string] => [`/api/admin/content/page/${id}`, adminToken]),
      ['/api/content/pages?pageSize=100', deliveryToken],
      ...pages.map((id): [string, string] => [`/api/content/pages/${id}`, deliveryToken]),
      [`/api/content/pages?pageSize=100&snapshot=${current.snapshot}`, deliveryToken],
      [`/api/content/pages?pageSize=100&schemaVersion=${version}`, adminToken],
      ...(lpageId
        ? (['en', 'de'] as const).flatMap((locale): Array<[string, string]> => [
            [`/api/admin/content/lpage/${lpageId}?locale=${locale}`, adminToken],
            [`/api/content/lpages/${lpageId}?locale=${locale}`, deliveryToken],
          ])
        : []),
    ];
    const bodies: string[] = [];
    for (const [url, token] of urls) {
      const response = await request('GET', url, token);
      expect(response.statusCode, url).toBe(200);
      // Times move with writes, never with reads; the body is otherwise compared byte for byte.
      bodies.push(`${url} ${response.headers.etag ?? ''} ${response.body}`);
    }
    const gql = await graphql(
      testApp.app,
      `
        {
          pages(pageSize: 100) {
            nodes {
              id
              title
              hero {
                id
                heading
                inner {
                  id
                  text
                }
              }
              cards {
                id
                heading
                inner {
                  id
                  text
                }
              }
              zone {
                __typename
                ... on Card {
                  id
                  heading
                  inner {
                    id
                    text
                  }
                }
                ... on Leaf {
                  id
                  text
                }
              }
            }
          }
        }
      `,
      { headers: bearer(deliveryToken), method: 'GET' },
    );
    expect(gql.body.errors).toBeUndefined();
    bodies.push(`graphql ${gql.response.headers.etag ?? ''} ${gql.response.body}`);
    return bodies;
  };

  /**
   * Reads everything with the cache on (first read, then a repeat that must derive nothing), then with it off:
   * the same bytes. Returns how many IDs the first read derived.
   */
  const readAndCompare = async (): Promise<number> => {
    const start = itemIdsDerived();
    const first = await reads();
    const derivedFirst = itemIdsDerived() - start;
    const before = itemIdsDerived();
    const again = await reads();
    expect(itemIdsDerived() - before, 'a repeated read derives nothing').toBe(0);
    setItemIdCacheEnabled(false);
    try {
      const off = await reads();
      expect(first).toEqual(off);
      expect(again).toEqual(off);
    } finally {
      setItemIdCacheEnabled(true);
    }
    return derivedFirst;
  };

  /** A write sending back exactly what a (cached) admin read showed changes nothing: the same items and IDs. */
  const writeBackUnchanged = async (id: string) => {
    const read = (await adminView('page', id)) as EntryBody & { autosaved: boolean };
    const response = expectStatus(
      await admin.put(`/api/admin/content/page/${id}`, {
        expectedVersion: read.version,
        data: { cards: read.data.cards, hero: read.data.hero, zone: read.data.zone },
      }),
      200,
    ).json<EntryBody>();
    // Saving over autosaved work makes it a revision (a new version); otherwise nothing is written.
    expect(response.version).toBe(read.autosaved ? read.version + 1 : read.version);
    const after = await adminView('page', id);
    expect(after.data).toEqual(read.data);
  };

  /** The same through the delivery API: the IDs a cached delivery read showed continue the same items. */
  const deliveryWriteBack = async (id: string) => {
    const shown = expectStatus(await request('GET', `/api/content/pages/${id}`, adminToken), 200).json<{
      data: { cards: Item[]; version?: number };
    }>().data;
    const view = await adminView('page', id);
    expectStatus(
      await request('PUT', `/api/content/pages/${id}`, adminToken, {
        expectedVersion: view.version,
        data: { cards: shown.cards },
      }),
      200,
    );
    const after = await adminView('page', id);
    expect((after.data.cards as Item[]).map((item) => item.id)).toEqual(shown.cards.map((item) => item.id));
    // Every value stays on the item it belonged to.
    expect((after.data.cards as Item[]).map((item) => item.note)).toEqual(
      (view.data.cards as Item[]).map((item) => item.note),
    );
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '1000000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expectStatus(await admin.post('/api/admin/locales', { code: 'de', label: 'German' }), 201);
    const leaf = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'leaf',
        label: 'Leaf',
        fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
      },
      'components',
    );
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
          {
            apiKey: 'inner',
            label: 'Inner',
            type: 'component',
            settings: { component: leaf.definition.id, repeatable: true },
          },
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
          settings: { components: [card.definition.id, leaf.definition.id] },
        },
      ],
    });
    lpage = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'lpage',
      label: 'Localized page',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', localized: true },
        {
          apiKey: 'lcards',
          label: 'Localized cards',
          type: 'component',
          localized: true,
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'scards',
          label: 'Shared cards',
          type: 'component',
          localized: false,
          settings: { component: card.definition.id, repeatable: true },
        },
      ],
    });
    deliveryToken = await createDeliveryToken(database.current.db, [
      { modelId: page.definition.id },
      { modelId: lpage.definition.id },
    ]);
    for (const prefix of ['p', 'q', 'r']) {
      const entry = expectStatus(
        await admin.post('/api/admin/content/page', {
          data: {
            title: prefix,
            cards: cards(prefix),
            hero: { heading: 'H', inner: [{ text: 'h' }] },
            zone: [
              { __component: 'card', heading: 'Z' },
              { __component: 'leaf', text: 'l' },
              { __component: 'leaf', text: 'l' },
            ],
          },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
      await makeLegacy(entry.id);
      pages.push(entry.id);
    }
    const localized = expectStatus(
      await admin.post('/api/admin/content/lpage', {
        locale: 'en',
        data: { title: 'en', lcards: cards('en'), scards: cards('s') },
      }),
      201,
    ).json<EntryBody>();
    lpageId = localized.id;
    expectStatus(
      await admin.put(`/api/admin/content/lpage/${lpageId}`, {
        locale: 'de',
        expectedVersion: null,
        data: { title: 'de', lcards: cards('de') },
      }),
      200,
    );
    expectStatus(
      await admin.post(`/api/admin/content/lpage/${lpageId}/publish`, { locales: ['en', 'de'] }),
      200,
    );
    await makeLegacy(lpageId);
  });
  afterEach(async () => {
    setItemIdCacheEnabled(true);
    clearItemIdCache(await itemIdKeyOf(database.current.db));
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('derives legacy items once, and a repeated read of every API hashes nothing', async () => {
    const hits = itemIdCacheStats().hits;
    expect(await readAndCompare()).toBeGreaterThan(0);
    expect(itemIdCacheStats().hits).toBeGreaterThan(hits);
  });

  it('derives again for a value rewritten in place, though no version, sequence, revision or time moved', async () => {
    await readAndCompare();
    const id = pages[0] as string;
    const view = await adminView('page', id);
    await makeLegacy(id, (data) => {
      const cardsField = page.definition.fields.find((field) => field.apiKey === 'cards')?.id as string;
      const list = data[cardsField] as Array<Record<string, unknown>>;
      return { ...data, [cardsField]: [...list.slice(1), list[0]] };
    });
    expect(await readAndCompare()).toBeGreaterThan(0);
    expect((await adminView('page', id)).version).toBe(view.version);
  });

  it('serves the right IDs after every kind of head change, and a write back of what a read showed agrees', async () => {
    const [first, second, third] = pages as [string, string, string];
    const changes: Array<[string, () => Promise<unknown>]> = [
      [
        'a save of another field',
        async () => {
          const view = await adminView('page', first);
          expectStatus(
            await admin.put(`/api/admin/content/page/${first}`, {
              expectedVersion: view.version,
              data: { title: 'p2' },
            }),
            200,
          );
        },
      ],
      [
        'an autosave',
        async () => {
          const view = await adminView('page', first);
          expectStatus(
            await admin.put(`/api/admin/content/page/${first}`, {
              expectedVersion: view.version,
              autosave: true,
              data: { title: 'p3' },
            }),
            200,
          );
        },
      ],
      [
        'a publish of an autosaved draft (a revision of legacy items)',
        async () => {
          expectStatus(await admin.post(`/api/admin/content/page/${first}/publish`, {}), 200);
        },
      ],
      [
        'an unpublish and a publish again',
        async () => {
          expectStatus(await admin.post(`/api/admin/content/page/${second}/unpublish`, {}), 200);
          expectStatus(await admin.post(`/api/admin/content/page/${second}/publish`, {}), 200);
        },
      ],
      [
        'a restore of an earlier revision',
        async () => {
          const { items: revisions } = expectStatus(
            await admin.get(`/api/admin/content/page/${third}/revisions`),
            200,
          ).json<{ items: Array<{ id: string; reason: string }> }>();
          const created = revisions.find((revision) => revision.reason === 'create')?.id ?? '';
          expectStatus(
            await admin.put(`/api/admin/content/page/${third}`, {
              expectedVersion: (await adminView('page', third)).version,
              data: { cards: [] },
            }),
            200,
          );
          expectStatus(
            await admin.post(`/api/admin/content/page/${third}/revisions/${created}/restore`, {
              expectedVersion: (await adminView('page', third)).version,
            }),
            200,
          );
        },
      ],
      [
        'a duplicate',
        async () => {
          const copy = expectStatus(
            await admin.post(`/api/admin/content/page/${second}/duplicate`, {}),
            201,
          ).json<EntryBody>();
          expectStatus(await admin.post(`/api/admin/content/page/${copy.id}/publish`, {}), 200);
          await makeLegacy(copy.id);
          pages.push(copy.id);
        },
      ],
      [
        'a save of a shared field, fanned out to every locale',
        async () => {
          const view = await adminView('lpage', lpageId, '?locale=en');
          const scards = view.data.scards as Item[];
          expectStatus(
            await admin.put(`/api/admin/content/lpage/${lpageId}`, {
              locale: 'en',
              expectedVersion: view.version,
              data: { scards: [...scards, { heading: 'new' }] },
            }),
            200,
          );
          await makeLegacy(lpageId);
        },
      ],
      [
        'a schema change that converts content (a localized field made shared)',
        async () => {
          const current = (await admin.get(`/api/admin/models/${lpage.definition.id}`)).json<ModelBody>();
          const response = await admin.put(`/api/admin/models/${lpage.definition.id}`, {
            definition: {
              ...current.definition,
              fields: current.definition.fields.map((field) =>
                field.apiKey === 'lcards' ? { ...field, localized: false } : field,
              ),
            },
            expectedVersion: current.version,
            acknowledgeBreaking: true,
            acknowledgeDestructive: true,
          });
          expect(response.statusCode).toBe(202);
          await runContentSchemaJobs(database.current.db);
        },
      ],
    ];
    for (const [label, change] of changes) {
      // Warm: every value cached as it was.
      await readAndCompare();
      await change();
      try {
        await readAndCompare();
        await writeBackUnchanged(first);
        await deliveryWriteBack(second);
        await readAndCompare();
      } catch (error) {
        throw new Error(`after ${label}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
  });
});
