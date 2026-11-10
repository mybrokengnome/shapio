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

/**
 * A caller that cannot read a field inside a component never wipes it, and never moves it to another item:
 * items it sends are matched to stored items by what it sees of them, then in place, else they are new (plan
 * schema-lenses, review hardening). The same with and without a schema version.
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
  const create = async (data: Record<string, unknown>) =>
    expectStatus(await admin.post('/api/admin/content/deck', { data }), 201).json<EntryBody>();

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
          settings: { components: [card.definition.id, tag.definition.id] },
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
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const base: Item[] = [
    { label: 'A', note: 'nA' },
    { label: 'B', note: 'nB' },
  ];
  const cases: Array<{ name: string; start?: Item[]; sent: Item[]; expected: Item[] }> = [
    { name: 'delete first', sent: [{ label: 'B' }], expected: [{ label: 'B', note: 'nB' }] },
    {
      name: 'reorder',
      sent: [{ label: 'B' }, { label: 'A' }],
      expected: [
        { label: 'B', note: 'nB' },
        { label: 'A', note: 'nA' },
      ],
    },
    {
      name: 'insert at front',
      sent: [{ label: 'X' }, { label: 'A' }, { label: 'B' }],
      expected: [
        { label: 'X', note: null },
        { label: 'A', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
    },
    {
      name: 'edit in place',
      sent: [{ label: 'A2' }, { label: 'B' }],
      expected: [
        { label: 'A2', note: 'nA' },
        { label: 'B', note: 'nB' },
      ],
    },
    {
      name: 'edit and move (the hidden value is dropped, never moved)',
      sent: [{ label: 'B' }, { label: 'A2' }, { label: 'C' }],
      expected: [
        { label: 'B', note: 'nB' },
        { label: 'A2', note: null },
        { label: 'C', note: null },
      ],
    },
    {
      name: 'duplicates, taken in order',
      start: [
        { label: 'A', note: 'n1' },
        { label: 'A', note: 'n2' },
      ],
      sent: [{ label: 'A' }],
      expected: [{ label: 'A', note: 'n1' }],
    },
  ];

  for (const suffix of ['', 'version'] as const) {
    describe(suffix ? 'through a schema version' : 'without a schema version', () => {
      const url = (id: string) =>
        `/api/content/decks/${id}${suffix ? `?schemaVersion=${encodeURIComponent(v)}` : ''}`;
      const write = async (id: string, credential: string, data: Record<string, unknown>) => {
        const version = expectStatus(await admin.get(`/api/admin/content/deck/${id}`), 200).json<EntryBody>()
          .version;
        return expectStatus(
          await request('PUT', url(id), credential, { expectedVersion: version, data }),
          200,
        );
      };

      for (const { name, start, sent, expected } of cases) {
        it(`repeatable: ${name}`, async () => {
          const entry = await create({ title: 't', cards: start ?? base });
          await write(entry.id, reader.accessToken, { cards: sent });
          expect((await stored(entry.id)).cards).toEqual(expected);
        });
      }

      it('zone: items of different components are matched by content and component', async () => {
        const entry = await create({
          zone: [
            { __component: 'card', label: 'C', note: 'nC' },
            { __component: 'tag', name: 'T', secret: 'sT' },
          ],
        });
        await write(entry.id, reader.accessToken, {
          zone: [
            { __component: 'tag', name: 'T' },
            { __component: 'card', label: 'C' },
          ],
        });
        expect((await stored(entry.id)).zone).toEqual([
          { __component: 'tag', name: 'T', secret: 'sT' },
          { __component: 'card', label: 'C', note: 'nC' },
        ]);
      });

      it('answers an invalid body (422) and a forbidden field (403) before a stale version (409), as always', async () => {
        const entry = await create({ title: 't', cards: base });
        const stale = { expectedVersion: 999 };
        const invalid = await request('PUT', url(entry.id), reader.accessToken, {
          ...stale,
          data: { nope: 1, cards: [{ label: 'A' }] },
        });
        // A key the client's version does not know is the lens's refusal; without a version, today's validator's.
        expect([invalid.statusCode, invalid.json<{ error: { code: string } }>().error.code]).toEqual([
          422,
          suffix ? 'LENS_WRITE_UNSUPPORTED' : 'CONTENT_INVALID',
        ]);
        const forbidden = await request('PUT', url(entry.id), titleOnly.accessToken, {
          ...stale,
          data: { cards: [{ label: 'A' }] },
        });
        expect([forbidden.statusCode, forbidden.json<{ error: { code: string } }>().error.code]).toEqual([
          403,
          'FORBIDDEN_FIELD',
        ]);
        const conflict = await request('PUT', url(entry.id), reader.accessToken, {
          ...stale,
          data: { cards: [{ label: 'A' }] },
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

      it('a caller that may not read: an explicit null clears a field, one left out is kept', async () => {
        const entry = await create({ cards: base });
        await write(entry.id, writerOnly.accessToken, {
          cards: [{ label: 'A', note: null }, { label: 'B' }],
        });
        expect((await stored(entry.id)).cards).toEqual([
          { label: 'A', note: null },
          { label: 'B', note: 'nB' },
        ]);
      });
    });
  }
});
