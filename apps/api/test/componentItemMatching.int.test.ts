import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = Record<string, unknown>;

/** Items without their IDs: what the content tests compare. */
const content = (items: unknown): unknown =>
  Array.isArray(items)
    ? items.map(content)
    : typeof items === 'object' && items !== null
      ? Object.fromEntries(
          Object.entries(items)
            .filter(([key]) => key !== 'id')
            .map(([key, value]) => [key, content(value)]),
        )
      : items;

/**
 * A caller that cannot read a field inside a component never wipes it, and never moves it to another item
 * (plan item-ids): items it sends continue the stored items by the IDs it sends back, else by what it sees of
 * them when that is certain; when it is not, and the items can hold values the caller cannot see, the write is
 * refused (`AMBIGUOUS_ITEMS`). The same with and without a schema version.
 */
describe('component items written by a caller that cannot see all of them', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let deck: ModelBody;
  let reader: AppSessionBody;
  let writerOnly: AppSessionBody;
  let titleOnly: AppSessionBody;
  let v: string;

  const request = (method: string, url: string, credential: string, payload?: unknown) =>
    testApp.app.inject({
      method: method as InjectOptions['method'],
      url,
      headers: bearer(credential),
      ...(payload === undefined ? {} : { payload: payload as InjectOptions['payload'] }),
    });
  const stored = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/deck/${id}`), 200).json<EntryBody>().data;
  /** A new entry, published: an app user (no draft access) sees the draft it writes, the published version. */
  const create = async (data: Record<string, unknown>) => {
    const entry = expectStatus(await admin.post('/api/admin/content/deck', { data }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/deck/${entry.id}/publish`, {}), 200);
    return entry;
  };
  /** The IDs of a list's stored items, in order. */
  const idsOf = async (entryId: string, field: string) =>
    ((await stored(entryId))[field] as Array<{ id: string }>).map((item) => item.id);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
        ],
      },
      'components',
    );
    const tag = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'tag',
        label: 'Tag',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          { apiKey: 'secret', label: 'Secret', type: 'string', public: false },
        ],
      },
      'components',
    );
    // `size` is an integer at the client's version and text today: the client reads it but cannot write it.
    const chip = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'chip',
        label: 'Chip',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'size', label: 'Size', type: 'integer' },
        ],
      },
      'components',
    );
    const box = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'box',
        label: 'Box',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          {
            apiKey: 'chips',
            label: 'Chips',
            type: 'component',
            settings: { component: chip.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    deck = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'deck',
      label: 'Deck',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'zone',
          label: 'Zone',
          type: 'dynamiczone',
          settings: { components: [card.definition.id, tag.definition.id, chip.definition.id] },
        },
        {
          apiKey: 'chips',
          label: 'Chips',
          type: 'component',
          settings: { component: chip.definition.id, repeatable: true, max: 5 },
        },
        {
          apiKey: 'boxes',
          label: 'Boxes',
          type: 'component',
          settings: { component: box.definition.id, repeatable: true },
        },
      ],
    });
    await setPublicGrants(database.current.db, []);
    await setAuthenticatedGrants(database.current.db, []);
    reader = await signUp(testApp.app);
    writerOnly = await signUp(testApp.app);
    titleOnly = await signUp(testApp.app);
    const titleField = deck.definition.fields.find((field) => field.apiKey === 'title')?.id as string;
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${titleOnly.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [
              { action: 'read', modelId: deck.definition.id },
              { action: 'update', modelId: deck.definition.id, fieldIds: [titleField] },
            ]),
          ],
        },
      }),
      200,
    );
    const roleOf = async (actions: Array<'read' | 'update'>) =>
      createAppRole(
        database.current.db,
        actions.map((action) => ({ action, modelId: deck.definition.id })),
      );
    for (const [user, actions] of [
      [reader, ['read', 'update']],
      [writerOnly, ['update']],
    ] as const) {
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${user.user.id}`,
          payload: { roleIds: [await roleOf([...actions])] },
        }),
        200,
      );
    }
    v = expectStatus(await admin.get('/api/snapshots/current'), 200).json<{ schemaVersionToken: string }>()
      .schemaVersionToken;
    // Something changes after V, so a client naming V reads and writes through a lens.
    const current = (await admin.get(`/api/admin/models/${deck.definition.id}`)).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${deck.definition.id}`, {
        definition: { ...current.definition, label: 'Deck (renamed)' },
        expectedVersion: current.version,
      }),
      200,
    );
    const chipNow = (await admin.get(`/api/admin/components/${chip.definition.id}`)).json<ModelBody>();
    const changed = await admin.put(`/api/admin/components/${chip.definition.id}`, {
      definition: {
        ...chipNow.definition,
        fields: chipNow.definition.fields.map(({ editor: _editor, ...field }) =>
          field.apiKey === 'size'
            ? { ...field, type: 'string', settings: {} }
            : { ...field, editor: _editor },
        ),
      },
      expectedVersion: chipNow.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202]).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const base: Item[] = [
    { label: 'A', note: 'nA' },
    { label: 'B', note: 'nB' },
  ];
  const AMBIGUOUS = 'AMBIGUOUS_ITEMS';
  type Sent = { label: string; from?: number };
  /**
   * The never-guess table (plan item-ids, section 4): `start` stored, `sent` written by a reader who sees the
   * draft (it is the published version) but not `note` (private). Without IDs the outcome is `withoutIds`
   * (`AMBIGUOUS_ITEMS` when not certain); with the IDs it read (`from`: the stored item it continues), always
   * `withIds`.
   */
  const table: Array<{
    name: string;
    start: Item[];
    sent: Sent[];
    withoutIds: Item[] | typeof AMBIGUOUS;
    withIds: Item[];
  }> = [
    {
      name: 'delete the first',
      start: base,
      sent: [{ label: 'B', from: 1 }],
      withoutIds: [{ label: 'B', note: 'nB' }],
      withIds: [{ label: 'B', note: 'nB' }],
    },
    {
      name: 'reorder unique items',
      start: base,
      sent: [
        { label: 'B', from: 1 },
        { label: 'A', from: 0 },
      ],
      withoutIds: [
        { label: 'B', note: 'nB' },
        { label: 'A', note: 'nA' },
      ],
      withIds: [
        { label: 'B', note: 'nB' },
        { label: 'A', note: 'nA' },
      ],
    },
    {
      name: 'insert at front',
      start: base,
      sent: [{ label: 'X' }, { label: 'A', from: 0 }, { label: 'B', from: 1 }],
      withoutIds: [
        { label: 'X', note: null },
        { label: 'A', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
      withIds: [
        { label: 'X', note: null },
        { label: 'A', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
    },
    {
      name: 'edit in place',
      start: base,
      sent: [
        { label: 'A2', from: 0 },
        { label: 'B', from: 1 },
      ],
      withoutIds: [
        { label: 'A2', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
      withIds: [
        { label: 'A2', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
    },
    {
      name: 'U: edit an item in place into a copy of the next one',
      start: [{ label: 'p', note: 'h0' }, { label: 'q' }],
      sent: [
        { label: 'q', from: 0 },
        { label: 'q', from: 1 },
      ],
      withoutIds: [
        { label: 'q', note: 'h0' },
        { label: 'q', note: null },
      ],
      withIds: [
        { label: 'q', note: 'h0' },
        { label: 'q', note: null },
      ],
    },
    {
      name: '12b: move and edit an item',
      start: base,
      sent: [
        { label: 'B2', from: 1 },
        { label: 'A', from: 0 },
      ],
      // Least edits: B deleted and B2 new (an edited item is never taken for a moved one), so B2 carries nothing.
      withoutIds: [
        { label: 'B2', note: null },
        { label: 'A', note: 'nA' },
      ],
      withIds: [
        { label: 'B2', note: 'nB' },
        { label: 'A', note: 'nA' },
      ],
    },
    {
      name: 'P: replace the only item with a new one (an edit in place without IDs)',
      start: [{ label: 'p', note: 'h' }],
      sent: [{ label: 'new item' }],
      withoutIds: [{ label: 'new item', note: 'h' }],
      withIds: [{ label: 'new item', note: null }],
    },
    {
      name: 'delete one of two items that look the same',
      start: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
      ],
      sent: [{ label: 'A', from: 1 }],
      withoutIds: AMBIGUOUS,
      withIds: [{ label: 'A', note: 'n2' }],
    },
    {
      name: 'reorder with duplicates',
      start: [
        { label: 'A', note: 'n1' },
        { label: 'B', note: 'n3' },
        { label: 'A', note: 'n2' },
      ],
      sent: [
        { label: 'A', from: 0 },
        { label: 'A', from: 2 },
        { label: 'B', from: 1 },
      ],
      // Which A moved across B cannot be told: their notes could swap.
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
        { label: 'B', note: 'n3' },
      ],
    },
    {
      name: 'duplicate an item',
      start: [{ label: 'A', note: 'n1' }],
      sent: [{ label: 'A', from: 0 }, { label: 'A' }],
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: null },
      ],
    },
    {
      name: 'edit an item and delete its neighbor',
      start: [...base, { label: 'C', note: 'nC' }],
      sent: [
        { label: 'A2', from: 0 },
        { label: 'C', from: 2 },
      ],
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'A2', note: 'nA' },
        { label: 'C', note: 'nC' },
      ],
    },
    {
      name: 'edit an item and delete one further away',
      start: [...base, { label: 'C', note: 'nC' }],
      sent: [
        { label: 'A2', from: 0 },
        { label: 'B', from: 1 },
      ],
      // The edited item could be either stored one: refused (plan item-ids, never guess).
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'A2', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
    },
    {
      name: 'delete the first and append a new one',
      start: [
        { label: 'p', note: 'n1' },
        { label: 'q', note: 'n2' },
      ],
      sent: [{ label: 'q', from: 1 }, { label: 'x' }],
      withoutIds: [
        { label: 'q', note: 'n2' },
        { label: 'x', note: null },
      ],
      withIds: [
        { label: 'q', note: 'n2' },
        { label: 'x', note: null },
      ],
    },
    {
      name: 'insert next to an edited item',
      start: [{ label: 'A', note: 'n1' }],
      sent: [{ label: 'X' }, { label: 'A2', from: 0 }],
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'X', note: null },
        { label: 'A2', note: 'n1' },
      ],
    },
    {
      name: 'W: edit, keep, and add, with a stored item left over beside the new one',
      start: [{ label: 'p' }, { label: 'q', note: 'B-private' }],
      sent: [{ label: 'q2' }, { label: 'p', from: 0 }, { label: 'n' }],
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'q2', note: null },
        { label: 'p', note: null },
        { label: 'n', note: null },
      ],
    },
    {
      name: 'Y: an old value sent at another place is a move, not an edit in place',
      start: [
        { label: 'p', note: 'A-private' },
        { label: 'q', note: 'B-private' },
        { label: 'q', note: 'C-private' },
      ],
      sent: [{ label: 'e' }, { label: 'r' }, { label: 'p', from: 0 }],
      withoutIds: [
        { label: 'e', note: null },
        { label: 'r', note: null },
        { label: 'p', note: 'A-private' },
      ],
      withIds: [
        { label: 'e', note: null },
        { label: 'r', note: null },
        { label: 'p', note: 'A-private' },
      ],
    },
    {
      name: 'one echoed item among look-alikes (seed 742367977)',
      start: [
        { label: 'p', note: 'h0' },
        { label: 'q', note: 'h1' },
        { label: 'q', note: 'h2' },
      ],
      sent: [{ label: 'q', from: 1 }, { label: 'p', from: 0 }, { label: 'p' }, { label: 'p' }],
      withoutIds: AMBIGUOUS,
      withIds: [
        { label: 'q', note: 'h1' },
        { label: 'p', note: 'h0' },
        { label: 'p', note: null },
        { label: 'p', note: null },
      ],
    },
    {
      name: 'send the list back unchanged, duplicates included',
      start: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
      ],
      sent: [
        { label: 'A', from: 0 },
        { label: 'A', from: 1 },
      ],
      withoutIds: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
      ],
      withIds: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
      ],
    },
  ];

  const errorOf = (response: { json: <T>() => T }) =>
    response.json<{ error: { code: string; details?: { issues?: Array<{ path: string; code: string }> } } }>()
      .error;

  for (const suffix of ['', 'version'] as const) {
    describe(suffix ? 'through a schema version' : 'without a schema version', () => {
      const url = (id: string) =>
        `/api/content/decks/${id}${suffix ? `?schemaVersion=${encodeURIComponent(v)}` : ''}`;
      const put = async (id: string, credential: string, data: Record<string, unknown>) => {
        const version = expectStatus(await admin.get(`/api/admin/content/deck/${id}`), 200).json<EntryBody>()
          .version;
        return request('PUT', url(id), credential, { expectedVersion: version, data });
      };
      const write = async (id: string, credential: string, data: Record<string, unknown>) =>
        expectStatus(await put(id, credential, data), 200);

      for (const { name, start, sent, withoutIds, withIds } of table) {
        it(`without item IDs: ${name}`, async () => {
          const entry = await create({ title: 't', cards: start });
          const response = await put(entry.id, reader.accessToken, {
            cards: sent.map(({ label }) => ({ label })),
          });
          if (withoutIds === AMBIGUOUS) {
            expect(response.statusCode, response.body).toBe(422);
            expect(errorOf(response).details?.issues).toEqual([
              expect.objectContaining({ path: '/cards', code: AMBIGUOUS }),
            ]);
            expect(content((await stored(entry.id)).cards)).toEqual(
              content(start.map((item) => ({ note: null, ...item }))),
            );
          } else {
            expect(response.statusCode, response.body).toBe(200);
            expect(content((await stored(entry.id)).cards)).toEqual(withoutIds);
          }
        });

        it(`with item IDs: ${name}`, async () => {
          const entry = await create({ title: 't', cards: start });
          const ids = await idsOf(entry.id, 'cards');
          const response = await write(entry.id, reader.accessToken, {
            // A new item is sent with `id: null`: the client names its items by ID.
            cards: sent.map(({ label, from }) => ({ id: from === undefined ? null : ids[from], label })),
          });
          const after = (await stored(entry.id)).cards as Array<{ id: string }>;
          expect(content(after)).toEqual(withIds);
          // Items keep the IDs they were sent with; new items get new ones; the response names them all.
          sent.forEach(({ from }, index) => {
            if (from !== undefined) {
              expect(after[index]?.id).toBe(ids[from]);
            } else {
              expect(ids).not.toContain(after[index]?.id);
            }
          });
          expect(
            response.json<{ data: { itemIds: { cards: Array<{ id: string }> } } }>().data.itemIds,
          ).toEqual({
            cards: after.map((item) => ({ id: item.id })),
          });
        });
      }

      it('zone: items of different components are matched by content and component, or by ID', async () => {
        const zone = [
          { __component: 'card', label: 'C', note: 'nC' },
          { __component: 'tag', name: 'T', secret: 'sT' },
        ];
        const entry = await create({ zone });
        await write(entry.id, reader.accessToken, {
          zone: [
            { __component: 'tag', name: 'T' },
            { __component: 'card', label: 'C' },
          ],
        });
        expect(content((await stored(entry.id)).zone)).toEqual([
          { __component: 'tag', name: 'T', secret: 'sT' },
          { __component: 'card', label: 'C', note: 'nC' },
        ]);
        const [tagId, cardId] = await idsOf(entry.id, 'zone');
        await write(entry.id, reader.accessToken, {
          zone: [
            { __component: 'card', id: cardId, label: 'C2' },
            { __component: 'tag', id: tagId, name: 'T2' },
          ],
        });
        expect(content((await stored(entry.id)).zone)).toEqual([
          { __component: 'card', label: 'C2', note: 'nC' },
          { __component: 'tag', name: 'T2', secret: 'sT' },
        ]);
        // An ID sent with another component: refused, the item is not replaced silently.
        const changed = await put(entry.id, reader.accessToken, {
          zone: [{ __component: 'tag', id: cardId, name: 'T3' }],
        });
        expect([changed.statusCode, errorOf(changed).details?.issues]).toEqual([
          422,
          [expect.objectContaining({ path: '/zone/0/id', code: 'ITEM_COMPONENT_CHANGED' })],
        ]);
      });

      it('refuses an unknown or repeated ID, and an ID from another list or parent', async () => {
        const entry = await create({ cards: base, zone: [{ __component: 'card', label: 'Z', note: 'nZ' }] });
        const [a] = await idsOf(entry.id, 'cards');
        const [zoneItem] = await idsOf(entry.id, 'zone');
        const unknown = await put(entry.id, reader.accessToken, { cards: [{ id: 'nope', label: 'A' }] });
        expect(errorOf(unknown).details?.issues).toEqual([
          expect.objectContaining({ path: '/cards/0/id', code: 'UNKNOWN_ITEM_ID' }),
        ]);
        const repeated = await put(entry.id, reader.accessToken, {
          cards: [
            { id: a, label: 'A' },
            { id: a, label: 'A' },
          ],
        });
        expect(errorOf(repeated).details?.issues).toEqual([
          expect.objectContaining({ path: '/cards/0/id', code: 'DUPLICATE_ITEM_ID' }),
          expect.objectContaining({ path: '/cards/1/id', code: 'DUPLICATE_ITEM_ID' }),
        ]);
        const moved = await put(entry.id, reader.accessToken, { cards: [{ id: zoneItem, label: 'Z' }] });
        expect(errorOf(moved).details?.issues).toEqual([
          expect.objectContaining({ path: '/cards/0/id', code: 'UNKNOWN_ITEM_ID' }),
        ]);
        // Nothing was written.
        expect(content((await stored(entry.id)).cards)).toEqual(base);
      });

      it('takes `id: null` as a new item', async () => {
        const entry = await create({ cards: base });
        const ids = await idsOf(entry.id, 'cards');
        await write(entry.id, reader.accessToken, {
          cards: [
            { id: null, label: 'B' },
            { id: null, label: 'A' },
          ],
        });
        const after = (await stored(entry.id)).cards as Array<{ id: string }>;
        expect(content(after)).toEqual([
          { label: 'B', note: null },
          { label: 'A', note: null },
        ]);
        expect(after.map((item) => ids.includes(item.id))).toEqual([false, false]);
      });

      it('answers an invalid body (422), then the items (422), then a forbidden field (403), then a stale version (409)', async () => {
        const entry = await create({ title: 't', cards: base });
        const stale = { expectedVersion: 999 };
        const invalid = await request('PUT', url(entry.id), reader.accessToken, {
          ...stale,
          data: { nope: 1, cards: [{ label: 'A' }] },
        });
        // A key the client's version does not know is the version's refusal; without one, today's validator's.
        expect([invalid.statusCode, errorOf(invalid).code]).toEqual([
          422,
          suffix ? 'LENS_WRITE_UNSUPPORTED' : 'CONTENT_INVALID',
        ]);
        const unknownId = await request('PUT', url(entry.id), reader.accessToken, {
          ...stale,
          data: { cards: [{ id: 'gone', label: 'A' }] },
        });
        expect([unknownId.statusCode, errorOf(unknownId).details?.issues?.[0]?.code]).toEqual([
          422,
          'UNKNOWN_ITEM_ID',
        ]);
        const forbidden = await request('PUT', url(entry.id), titleOnly.accessToken, {
          ...stale,
          data: { cards: [{ label: 'A' }] },
        });
        expect([forbidden.statusCode, errorOf(forbidden).code]).toEqual([403, 'FORBIDDEN_FIELD']);
        const conflict = await request('PUT', url(entry.id), reader.accessToken, {
          ...stale,
          data: { cards: [{ label: 'A' }, { label: 'B' }] },
        });
        expect(conflict.statusCode).toBe(409);
      });

      it('a caller that may not read clears a field with null and a list with []: never a success that keeps it', async () => {
        const entry = await create({ title: 'keep me?', cards: base });
        await write(entry.id, writerOnly.accessToken, { title: null, cards: [] });
        const after = await stored(entry.id);
        expect(after.title).toBeNull();
        expect(after.cards).toEqual([]);
      });

      it('a caller that may not read clears what it leaves out of a field it may write, as on any type', async () => {
        const entry = await create({ cards: base });
        const ids = await idsOf(entry.id, 'cards');
        await write(entry.id, writerOnly.accessToken, {
          cards: [
            { id: ids[0], label: 'A', note: null },
            { id: ids[1], label: 'B' },
          ],
        });
        // `note` is private, but the caller sees nothing, so nothing is kept for it: the same as on a content type
        // whose components hold no private field.
        expect(content((await stored(entry.id)).cards)).toEqual([
          { label: 'A', note: null },
          { label: 'B', note: null },
        ]);
      });

      it('with unpublished changes it may not read: a list sent without IDs is refused, with IDs it is certain', async () => {
        const entry = await create({ cards: base });
        const draft = expectStatus(
          await admin.get(`/api/admin/content/deck/${entry.id}`),
          200,
        ).json<EntryBody>();
        expectStatus(
          await admin.put(`/api/admin/content/deck/${entry.id}`, {
            expectedVersion: draft.version,
            data: { title: 'changed in the draft' },
          }),
          200,
        );
        const refused = await put(entry.id, reader.accessToken, { cards: [{ label: 'B' }] });
        expect([refused.statusCode, errorOf(refused).details?.issues]).toEqual([
          422,
          [
            expect.objectContaining({
              path: '/cards',
              code: AMBIGUOUS,
              message: expect.stringContaining('replaces items this caller cannot read') as unknown,
            }),
          ],
        ]);
        // An empty list, or none, is always allowed; with the IDs it read, the write is certain.
        const ids = await idsOf(entry.id, 'cards');
        await write(entry.id, reader.accessToken, { cards: [{ id: ids[1], label: 'B' }] });
        expect(content((await stored(entry.id)).cards)).toEqual([{ label: 'B', note: 'nB' }]);
        await write(entry.id, reader.accessToken, { cards: [] });
        expect((await stored(entry.id)).cards).toEqual([]);
      });

      it('refuses a list longer than the field allows (422 TOO_MANY) before a stale version (409)', async () => {
        const entry = await create({ title: 't' });
        const tooMany = await request('PUT', url(entry.id), reader.accessToken, {
          expectedVersion: 999,
          data: { chips: Array.from({ length: 6 }, (_, index) => ({ label: `c${index}` })) },
        });
        expect(tooMany.statusCode).toBe(422);
        expect(errorOf(tooMany).details?.issues).toEqual([
          { path: '/chips', code: 'TOO_MANY', message: 'allows at most 5 item(s)' },
        ]);
      });
    });
  }

  describe('through a schema version: items holding a field the client reads but cannot write', () => {
    const url = (id: string) => `/api/content/decks/${id}?schemaVersion=${encodeURIComponent(v)}`;
    const published = create;
    const put = async (id: string, data: Record<string, unknown>, credential = reader.accessToken) => {
      const version = expectStatus(await admin.get(`/api/admin/content/deck/${id}`), 200).json<EntryBody>()
        .version;
      return request('PUT', url(id), credential, { expectedVersion: version, data });
    };
    const twoAs = [
      { label: 'A', size: '1' },
      { label: 'A', size: '2' },
    ];

    it('reads the field in the shape of the version', async () => {
      const entry = await published({ chips: twoAs });
      const read = expectStatus(await request('GET', url(entry.id), reader.accessToken), 200).json<{
        data: { chips: Item[] };
      }>();
      expect(content(read.data.chips)).toEqual([
        { label: 'A', size: 1 },
        { label: 'A', size: 2 },
      ]);
    });

    it('keeps the value of the item the client kept, never of another equal-looking one', async () => {
      const entry = await published({ chips: twoAs });
      expectStatus(await put(entry.id, { chips: [{ label: 'A', size: 2 }] }), 200);
      expect(content((await stored(entry.id)).chips)).toEqual([{ label: 'A', size: '2' }]);
    });

    it('applies a swap of two items that differ only in that field', async () => {
      const entry = await published({ chips: twoAs });
      expectStatus(
        await put(entry.id, {
          chips: [
            { label: 'A', size: 2 },
            { label: 'A', size: 1 },
          ],
        }),
        200,
      );
      expect(content((await stored(entry.id)).chips)).toEqual([
        { label: 'A', size: '2' },
        { label: 'A', size: '1' },
      ]);
    });

    it('pairs a nested list under the item its parent continues', async () => {
      const entry = await published({
        boxes: [
          { name: 'x', chips: [{ label: 'B', size: '9' }] },
          { name: 'y', chips: twoAs },
        ],
      });
      expectStatus(
        await put(entry.id, {
          boxes: [
            { name: 'x', chips: [{ label: 'B', size: 9 }] },
            { name: 'y', chips: [{ label: 'A', size: 2 }] },
          ],
        }),
        200,
      );
      expect(content((await stored(entry.id)).boxes)).toEqual([
        { name: 'x', chips: [{ label: 'B', size: '9' }] },
        { name: 'y', chips: [{ label: 'A', size: '2' }] },
      ]);
    });

    it('pairs dynamic-zone items the same way', async () => {
      const entry = await published({ zone: twoAs.map((item) => ({ __component: 'chip', ...item })) });
      expectStatus(await put(entry.id, { zone: [{ __component: 'chip', label: 'A', size: 2 }] }), 200);
      expect(content((await stored(entry.id)).zone)).toEqual([
        { __component: 'chip', label: 'A', size: '2' },
      ]);
    });

    it('with unpublished changes it may not read: without IDs refused, with IDs nothing inside is sent back', async () => {
      const entry = await published({
        chips: [
          { label: 'A', size: '1' },
          { label: 'B', size: '2' },
        ],
      });
      // An editor changes the draft; the reader (no draft access) still reads the published version.
      const draft = expectStatus(
        await admin.get(`/api/admin/content/deck/${entry.id}`),
        200,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/deck/${entry.id}`, {
          expectedVersion: draft.version,
          data: {
            chips: [
              { label: 'A', size: '1' },
              { label: 'B', size: '3' },
            ],
          },
        }),
        200,
      );
      const refused = await put(entry.id, { chips: [{ label: 'B' }, { label: 'A' }] });
      expect(refused.statusCode).toBe(422);
      expect(refused.json<{ error: { details: { issues: Item[] } } }>().error.details.issues).toEqual([
        expect.objectContaining({ path: '/chips', code: 'AMBIGUOUS_ITEMS' }),
      ]);
      // The IDs it read from the published version name the draft's items.
      const read = expectStatus(await request('GET', url(entry.id), reader.accessToken), 200).json<{
        data: { chips: Array<{ id: string }> };
      }>();
      const [a, b] = read.data.chips.map((chip) => chip.id);
      // Sending back what it read, whatever the draft holds, is refused alike: no guess of the draft is tested.
      for (const size of [2, 3]) {
        const sentBack = await put(entry.id, {
          chips: [
            { id: b, label: 'B', size },
            { id: a, label: 'A', size: 1 },
          ],
        });
        expect(sentBack.statusCode).toBe(422);
        expect(sentBack.json<{ error: { code: string; details: { issues: Item[] } } }>().error).toMatchObject(
          {
            code: 'LENS_WRITE_UNSUPPORTED',
            details: { issues: [{ path: '/chips/0/size' }, { path: '/chips/1/size' }] },
          },
        );
      }
      // Left out, each item keeps its own value from the draft, the reorder applied.
      expectStatus(
        await put(entry.id, {
          chips: [
            { id: b, label: 'B' },
            { id: a, label: 'A' },
          ],
        }),
        200,
      );
      expect(content((await stored(entry.id)).chips)).toEqual([
        { label: 'B', size: '3' },
        { label: 'A', size: '1' },
      ]);
    });

    it('AB: two items swapped and edited, each sending back what it read, is ambiguous without IDs', async () => {
      const start = [
        { label: 'p', size: '100' },
        { label: 'q', size: '101' },
      ];
      const entry = await published({ chips: start });
      const refused = await put(entry.id, {
        chips: [
          { label: 'q2', size: 101 },
          { label: 'p2', size: 100 },
        ],
      });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json<{ error: { code: string; details: { issues: Item[] } } }>().error).toMatchObject({
        code: 'CONTENT_INVALID',
        details: { issues: [{ path: '/chips', code: 'AMBIGUOUS_ITEMS' }] },
      });
      expect(content((await stored(entry.id)).chips)).toEqual(start);
      const ids = await idsOf(entry.id, 'chips');
      expectStatus(
        await put(entry.id, {
          chips: [
            { id: ids[1], label: 'q2', size: 101 },
            { id: ids[0], label: 'p2', size: 100 },
          ],
        }),
        200,
      );
      expect(content((await stored(entry.id)).chips)).toEqual([
        { label: 'q2', size: '101' },
        { label: 'p2', size: '100' },
      ]);
    });

    it('V and V2: a caller that may only update is refused without IDs, and certain with them', async () => {
      const start = [
        { label: 'p', size: '0' },
        { label: 'q', size: '1' },
      ];
      for (const sent of [[{ label: 'q' }], [{ label: 'q' }, { label: 'p' }]]) {
        const entry = await published({ chips: start });
        const refused = await put(entry.id, { chips: sent }, writerOnly.accessToken);
        expect(refused.statusCode, refused.body).toBe(422);
        expect(refused.json<{ error: { details: { issues: Item[] } } }>().error.details.issues).toEqual([
          expect.objectContaining({ path: '/chips', code: 'AMBIGUOUS_ITEMS' }),
        ]);
        const ids = Object.fromEntries(
          ((await stored(entry.id)).chips as Array<{ id: string; label: string }>).map((chip) => [
            chip.label,
            chip.id,
          ]),
        );
        expectStatus(
          await put(
            entry.id,
            { chips: sent.map((chip) => ({ ...chip, id: ids[chip.label] })) },
            writerOnly.accessToken,
          ),
          200,
        );
        expect(content((await stored(entry.id)).chips)).toEqual(
          sent.map((chip) => start.find((item) => item.label === chip.label)),
        );
      }
    });
  });
});
