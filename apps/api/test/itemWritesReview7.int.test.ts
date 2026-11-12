import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type GrantSpec,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type ErrorBody = { error: { code: string; details?: { issues?: Array<{ path: string; code: string }> } } };

/** Status, code and issue codes: what an answer tells a caller. */
const answer = (response: { statusCode: number; json: <T>() => T }) => {
  const body = response.statusCode >= 400 ? response.json<ErrorBody>() : undefined;
  return [
    response.statusCode,
    body?.error.code,
    (body?.error.details?.issues ?? []).map((issue) => `${issue.path} ${issue.code}`),
  ];
};

/** The seventh review's findings (plan item-ids), each at the HTTP level. */
describe('item writes: seventh review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let thing: ModelBody;
  let secret: ModelBody;
  let page: ModelBody;
  let reader: AppSessionBody;
  let updater: AppSessionBody;
  let v0: string;

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const at = (url: string) => `${url}?schemaVersion=${encodeURIComponent(v0)}`;
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/page/${id}`), 200).json<EntryBody>();
  const entryOf = async (model: string, data: Record<string, unknown>, publish = true) => {
    const entry = expectStatus(
      await admin.post(`/api/admin/content/${model}`, { data }),
      201,
    ).json<EntryBody>();
    if (publish) {
      expectStatus(await admin.post(`/api/admin/content/${model}/${entry.id}/publish`, {}), 200);
    }
    return entry.id;
  };
  const put = async (id: string, token: string, data: Record<string, unknown>, version = false) =>
    request('PUT', (version ? at : (url: string) => url)(`/api/content/pages/${id}`), token, {
      expectedVersion: (await adminView(id)).version,
      data,
    });
  const fieldIdOf = (model: ModelBody, apiKey: string) =>
    model.definition.fields.find((field) => field.apiKey === apiKey)?.id as string;
  /** Rewrites every head of an entry in storage (values no write would store: hand-edited data). */
  const inStorage = async (
    id: string,
    change: (data: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
    for (const head of heads) {
      await database.current.db
        .updateTable('entry_heads')
        .set({ data: change(head.data as Record<string, unknown>) as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state as never)
        .execute();
    }
  };
  const user = async (grants: GrantSpec[]) => {
    const session = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${session.user.id}`,
        payload: { roleIds: [await createAppRole(database.current.db, grants)] },
      }),
      200,
    );
    return session;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const named = (apiKey: string) =>
      createDefinition(admin, {
        kind: 'collection',
        apiKey,
        label: apiKey,
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
    thing = await named('thing');
    secret = await named('secret');
    const relation = (apiKey: string, target: ModelBody, extra: Record<string, unknown> = {}) => ({
      apiKey,
      label: apiKey,
      type: 'relation',
      settings: { target: target.definition.id, cardinality: 'one' },
      ...extra,
    });
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          relation('rel', thing),
          relation('vault', secret, { public: false }),
        ],
      },
      'components',
    );
    const link = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'link',
        label: 'Link',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    const tag = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'tag',
        label: 'Tag',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      },
      'components',
    );
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        relation('rel', thing),
        { ...relation('rels', thing), settings: { target: thing.definition.id, cardinality: 'many' } },
        relation('srel', secret),
        relation('reviewer', secret, { public: false }),
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'links',
          label: 'Links',
          type: 'component',
          settings: { component: link.definition.id, repeatable: true },
        },
        {
          apiKey: 'zone',
          label: 'Zone',
          type: 'dynamiczone',
          settings: { components: [link.definition.id] },
        },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: link.definition.id } },
        {
          apiKey: 'shelf',
          label: 'Shelf',
          type: 'component',
          settings: { component: link.definition.id, repeatable: true },
        },
      ],
    });
    reader = await user([
      { action: 'read', modelId: null },
      { action: 'update', modelId: page.definition.id },
    ]);
    updater = await user([{ action: 'update', modelId: page.definition.id }]);
    v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // Since v0, the zone also takes `tag`: a field the version cannot write, only send back as read.
    const current = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    const changed = await admin.put(`/api/admin/models/${page.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map((field) =>
          field.apiKey === 'zone'
            ? { ...field, settings: { components: [link.definition.id, tag.definition.id] } }
            : field.apiKey === 'hero'
              ? { ...field, settings: { component: link.definition.id, repeatable: true } }
              : field.apiKey === 'shelf'
                ? { ...field, settings: { component: tag.definition.id, repeatable: true } }
                : field,
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    // Applied at once or by the conversion job (202) that runs below.
    expect([200, 202]).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  describe('N1: a relation value the body names is checked in full, whatever the entry holds elsewhere', () => {
    it.each([false, true])(
      'no oracle: the answer is the same whether a hidden field holds the ID (version: %s)',
      async (version) => {
        const candidate = await entryOf('secret', { name: 'candidate' });
        const deleted = await entryOf('thing', { name: 'deleted' });
        await database.current.db
          .updateTable('entries')
          .set({ deleted_at: new Date() as never })
          .where('id', '=', deleted)
          .execute();
        const answers: unknown[][] = [];
        for (const holds of [false, true]) {
          const id = await entryOf('page', {
            title: 't',
            cards: [{ heading: 'A', ...(holds ? { vault: candidate } : {}) }],
            ...(holds ? { reviewer: candidate } : {}),
          });
          const cardId = ((await adminView(id)).data.cards as Item[])[0]?.id;
          answers.push([
            answer(await put(id, reader.accessToken, { rel: candidate }, version)),
            answer(
              await put(
                id,
                reader.accessToken,
                { cards: [{ id: cardId, heading: 'A', rel: candidate }] },
                version,
              ),
            ),
            answer(await put(id, reader.accessToken, { rel: deleted }, version)),
          ]);
        }
        expect(answers[0]).toEqual(answers[1]);
        expect(answers[0]).toEqual([
          [422, 'CONTENT_INVALID', ['/rel RELATION_TARGET_MISSING']],
          [422, 'CONTENT_INVALID', ['/cards/0/rel RELATION_TARGET_MISSING']],
          [422, 'CONTENT_INVALID', ['/rel RELATION_TARGET_MISSING']],
        ]);
      },
    );

    it('T5: an ID stored in one relation is refused in a relation to another content type, so the entry stays publishable', async () => {
      const pub = await entryOf('thing', { name: 'pub' });
      const id = await entryOf('page', { title: 't', rel: pub });
      expect(answer(await put(id, reader.accessToken, { srel: pub }))).toEqual([
        422,
        'CONTENT_INVALID',
        ['/srel RELATION_TARGET_MISSING'],
      ]);
      const view = await adminView(id);
      expect(
        answer(
          await admin.put(`/api/admin/content/page/${id}`, {
            expectedVersion: view.version,
            data: { srel: pub },
          }),
        ),
      ).toEqual([422, 'CONTENT_INVALID', ['/srel RELATION_TARGET_MISSING']]);
      expectStatus(await admin.post(`/api/admin/content/page/${id}/publish`, {}), 200);
    });
  });

  describe('N9b: hand-edited relation values never answer 5xx', () => {
    it('an ID with no entry at all: a save that keeps it is refused (422), never a 500; cleared, it saves', async () => {
      const id = await entryOf('page', { title: 't' });
      await inStorage(id, (data) => ({
        ...data,
        [fieldIdOf(page, 'rel')]: '00000000-0000-4000-8000-0000000000aa',
      }));
      const view = await adminView(id);
      const kept = await admin.put(`/api/admin/content/page/${id}`, {
        expectedVersion: view.version,
        data: { title: 't2' },
      });
      expect(answer(kept)).toEqual([422, 'CONTENT_INVALID', ['/rel RELATION_TARGET_MISSING']]);
      // The admin read shows it; sent back as read, nothing changes and nothing is written (a no-op, as on main).
      expect(view.data.rel).toBe('00000000-0000-4000-8000-0000000000aa');
      expectStatus(
        await admin.put(`/api/admin/content/page/${id}`, { expectedVersion: view.version, data: view.data }),
        200,
      );
      expect((await adminView(id)).version).toBe(view.version);
      // Cleared, the save goes through.
      expectStatus(
        await admin.put(`/api/admin/content/page/${id}`, {
          expectedVersion: view.version,
          data: { rel: null },
        }),
        200,
      );
    });

    it('a many-relation stored as one ID reads and saves', async () => {
      const pub = await entryOf('thing', { name: 'pub' });
      const id = await entryOf('page', { title: 't' });
      await inStorage(id, (data) => ({ ...data, [fieldIdOf(page, 'rels')]: pub }));
      for (const token of [reader.accessToken, adminToken]) {
        const read = expectStatus(await request('GET', `/api/content/pages/${id}`, token), 200).json<{
          data: Record<string, unknown>;
        }>().data;
        const saved = await put(id, token, { title: 't2', rels: read.rels });
        expect(saved.statusCode, saved.body).toBeLessThan(500);
      }
    });
  });

  describe('N2: a caller that cannot see the items, re-saving a list it writes in full', () => {
    it('sent exactly as stored: nothing is written; items found once on each side keep their IDs; others are new', async () => {
      const id = await entryOf('page', { title: 't', links: [{ label: 'x' }, { label: 'y' }] });
      const before = await adminView(id);
      const ids = (before.data.links as Item[]).map((link) => link.id);
      expectStatus(await put(id, updater.accessToken, { links: [{ label: 'x' }, { label: 'y' }] }), 200);
      const same = await adminView(id);
      expect(same.version).toBe(before.version);
      expect((same.data.links as Item[]).map((link) => link.id)).toEqual(ids);
      // Reordered: each item found once on each side continues (whole items compared), so the IDs move with them.
      expectStatus(await put(id, updater.accessToken, { links: [{ label: 'y' }, { label: 'x' }] }), 200);
      const changed = await adminView(id);
      expect(changed.version).toBe(before.version + 1);
      expect((changed.data.links as Item[]).map((link) => link.id)).toEqual([ids[1], ids[0]]);
      // An edited item matches nothing stored: it is new.
      expectStatus(await put(id, updater.accessToken, { links: [{ label: 'y' }, { label: 'z' }] }), 200);
      const edited = (await adminView(id)).data.links as Item[];
      expect(edited[0]?.id).toBe(ids[1]);
      expect(ids).not.toContain(edited[1]?.id);
    });

    it('a list that can hold what it cannot write is still refused, never compared', async () => {
      const id = await entryOf('page', { title: 't', cards: [{ heading: 'A' }] });
      const refused = await put(id, updater.accessToken, { cards: [{ heading: 'A' }] });
      expect(answer(refused)).toEqual([422, 'CONTENT_INVALID', ['/cards AMBIGUOUS_ITEMS']]);
    });
  });

  describe('N3: through a version, a field it cannot write, sent back exactly as read', () => {
    // Since v0: the zone also takes `tag`; `hero` went from one item to a list; `shelf` holds another component.
    it.each([
      [
        'a zone',
        {
          zone: [
            { __component: 'link', label: 'A' },
            { __component: 'tag', name: 'T' },
          ],
        },
      ],
      ['a single component made a list', { hero: [{ label: 'H' }] }],
      ['a list of another component', { shelf: [{ name: 'S' }] }],
    ])('%s: accepted, nothing written, with and without the IDs read', async (_name, data) => {
      for (const ids of [true, false]) {
        const id = await entryOf('page', { title: 't', ...data });
        const before = await adminView(id);
        const read = expectStatus(
          await request('GET', at(`/api/content/pages/${id}`), reader.accessToken),
          200,
        ).json<{
          data: Record<string, unknown>;
        }>().data;
        const strip = (value: unknown): unknown =>
          Array.isArray(value)
            ? value.map(strip)
            : typeof value === 'object' && value !== null
              ? Object.fromEntries(
                  Object.entries(value)
                    .filter(([key]) => ids || key !== 'id')
                    .map(([key, item]) => [key, strip(item)]),
                )
              : value;
        const key = Object.keys(data)[0] as string;
        const response = await put(id, reader.accessToken, { [key]: strip(read[key]) }, true);
        expect(response.statusCode, response.body).toBe(200);
        expect((await adminView(id)).version).toBe(before.version);
      }
    });
  });

  describe('N7 and M1: an admin token on a delivery route reads drafts, so draft targets are shown to it', () => {
    it('what it sends is what is written: its null clears, a list without the draft target drops it (as on main)', async () => {
      const draft = await entryOf('thing', { name: 'draft' }, false);
      const pub = await entryOf('thing', { name: 'pub' });
      const id = await entryOf('page', { title: 't', rel: draft, rels: [draft, pub] });
      expectStatus(await put(id, adminToken, { rel: null, rels: [pub] }), 200);
      const after = await adminView(id);
      expect([after.data.rel, after.data.rels]).toEqual([null, [pub]]);
    });
  });

  describe('N2 for a reader whose write puts the draft ahead of what it can read', () => {
    it('the write answers the item IDs; sent back with them, the next write is accepted (without, refused)', async () => {
      const id = await entryOf('page', { title: 't', cards: [{ heading: 'A' }] });
      const first = await put(id, reader.accessToken, { cards: [{ heading: 'A' }, { heading: 'B' }] });
      expect(first.statusCode, first.body).toBe(200);
      const itemIds = first.json<{ data: { itemIds: { cards: Array<{ id: string }> } } }>().data.itemIds
        .cards;
      expect(itemIds).toHaveLength(2);
      // The draft is now ahead of the published version this reader reads: without IDs, nothing is guessed.
      expect(
        answer(await put(id, reader.accessToken, { cards: [{ heading: 'A' }, { heading: 'B' }] })),
      ).toEqual([422, 'CONTENT_INVALID', ['/cards AMBIGUOUS_ITEMS']]);
      const second = await put(id, reader.accessToken, {
        cards: [
          { id: itemIds[0]?.id, heading: 'A' },
          { id: itemIds[1]?.id, heading: 'B2' },
        ],
      });
      expect(second.statusCode, second.body).toBe(200);
      const stored = (await adminView(id)).data.cards as Item[];
      expect(stored.map((card) => [card.id, card.heading])).toEqual([
        [itemIds[0]?.id, 'A'],
        [itemIds[1]?.id, 'B2'],
      ]);
    });
  });
});
