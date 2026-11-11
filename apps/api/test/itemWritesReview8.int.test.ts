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
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type FieldBody = ModelBody['definition']['fields'][number];

/** Without item IDs (`id` in the API, `__id` in storage), at any depth. */
const withoutIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id' && key !== '__id')
            .map(([key, item]) => [key, withoutIds(item)]),
        )
      : value;

/** The eighth review's findings (plan item-ids), each at the HTTP level. */
describe('item writes: eighth review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const user = async (grants: GrantSpec[]): Promise<AppSessionBody> => {
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
  const heads = (id: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
  /** Rewrites every head of an entry in storage (what an entry saved by an earlier release holds). */
  const inStorage = async (
    id: string,
    change: (data: Record<string, unknown>, locale: string) => unknown,
  ) => {
    for (const head of await heads(id)) {
      await database.current.db
        .updateTable('entry_heads')
        .set({ data: change(head.data as Record<string, unknown>, head.locale) as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state as never)
        .execute();
    }
  };
  /** What a write leaves behind: the version, revisions, events, and status of an entry. */
  const footprint = async (model: string, id: string) => {
    const view = expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
    const revisions = await database.current.db
      .selectFrom('content_revisions')
      .select('id')
      .where('entry_id', '=', id)
      .execute();
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select('type')
      .where('aggregate_id', '=', id)
      .execute();
    return {
      version: view.version,
      status: (view as unknown as { status: string }).status,
      revisions: revisions.length,
      events: events.map((event) => event.type).sort(),
    };
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  describe('B1: a save that changes nothing is a no-op on entries saved before item IDs', () => {
    let link: ModelBody;
    const fieldsOf = () => [
      { apiKey: 'title', label: 'Title', type: 'string' },
      {
        apiKey: 'links',
        label: 'Links',
        type: 'component',
        settings: { component: link.definition.id, repeatable: true },
      },
      { apiKey: 'cta', label: 'Cta', type: 'component', settings: { component: link.definition.id } },
    ];
    beforeAll(async () => {
      link = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'link',
          label: 'Link',
          fields: [
            { apiKey: 'label', label: 'Label', type: 'string' },
            { apiKey: 'url', label: 'Url', type: 'string' },
          ],
        },
        'components',
      );
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'article',
        label: 'Article',
        fields: fieldsOf(),
      });
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'news',
        pluralApiKey: 'newsItems',
        label: 'News',
        draftAndPublish: false,
        fields: fieldsOf(),
      });
    });
    /** An entry as an earlier release stored it: no item IDs in any head. */
    const legacyEntry = async (model: 'article' | 'news') => {
      const entry = expectStatus(
        await admin.post(`/api/admin/content/${model}`, {
          data: {
            title: 't',
            links: [
              { label: 'a', url: '/a' },
              { label: 'a', url: '/a' },
            ],
            cta: { label: 'go', url: '/go' },
          },
        }),
        201,
      ).json<EntryBody>();
      if (model === 'article') {
        expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
      }
      await inStorage(entry.id, (data) => withoutIds(data));
      return entry.id;
    };

    it.each(['article', 'news'] as const)('%s: every body shape, on every route', async (model) => {
      const id = await legacyEntry(model);
      const route = model === 'article' ? 'articles' : 'newsItems';
      const version = async () =>
        expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>().version;
      const read = async () =>
        expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>().data;
      const typeName = model === 'article' ? 'Article' : 'News';
      const bodies: Array<[string, () => Promise<Record<string, unknown>>]> = [
        ['no fields', async () => ({})],
        ['a scalar, unchanged', async () => ({ title: 't' })],
        ['a list as read, with its derived IDs', async () => ({ links: (await read()).links })],
        ['a list as read, without IDs', async () => ({ links: withoutIds((await read()).links) })],
        ['one component field sent, the other left out', async () => ({ cta: (await read()).cta })],
        ['the whole entry as read', async () => await read()],
      ];
      const start = await footprint(model, id);
      for (const [name, body] of bodies) {
        for (const via of ['admin', 'delivery', 'graphql'] as const) {
          const data = await body();
          const expectedVersion = await version();
          let status: number;
          if (via === 'admin') {
            status = (await admin.put(`/api/admin/content/${model}/${id}`, { expectedVersion, data }))
              .statusCode;
          } else if (via === 'delivery') {
            status = (
              await request('PUT', `/api/content/${route}/${id}`, adminToken, { expectedVersion, data })
            ).statusCode;
          } else {
            const result = await graphql(
              testApp.app,
              `mutation ($id: ID!, $v: Int, $d: ${typeName}Input) { update${typeName}(id: $id, expectedVersion: $v, data: $d) { id } }`,
              {
                headers: bearer(adminToken),
                variables: { id, v: expectedVersion, d: withoutIds(data) },
              },
            );
            status = result.body.errors ? 422 : result.statusCode;
          }
          expect([name, via, status]).toEqual([name, via, 200]);
          expect([name, via, await footprint(model, id)]).toEqual([name, via, start]);
        }
      }
      // A real change is recorded; the save after it, the same again, is not.
      expectStatus(
        await admin.put(`/api/admin/content/${model}/${id}`, {
          expectedVersion: await version(),
          data: { title: 't2' },
        }),
        200,
      );
      const changed = await footprint(model, id);
      expect(changed.version).toBe(start.version + 1);
      expectStatus(
        await admin.put(`/api/admin/content/${model}/${id}`, {
          expectedVersion: await version(),
          data: { title: 't2' },
        }),
        200,
      );
      expect(await footprint(model, id)).toEqual(changed);
    });

    it('LOOKSWAP: swapping two identical items by their IDs is still a change', async () => {
      const id = await legacyEntry('article');
      const before = await footprint('article', id);
      const links = (
        expectStatus(await admin.get(`/api/admin/content/article/${id}`), 200).json<EntryBody>().data
          .links as Item[]
      ).slice();
      expectStatus(
        await admin.put(`/api/admin/content/article/${id}`, {
          expectedVersion: before.version,
          data: { links: [links[1], links[0]] },
        }),
        200,
      );
      expect((await footprint('article', id)).version).toBe(before.version + 1);
      const after = expectStatus(await admin.get(`/api/admin/content/article/${id}`), 200).json<EntryBody>()
        .data.links as Item[];
      expect(after.map((item) => item.id)).toEqual([links[1]?.id, links[0]?.id]);
    });
  });

  describe('H1: through a version, read then write back is never refused, whatever changed since', () => {
    let memo: ModelBody;
    let box: ModelBody;
    let v0: string;
    let reader: AppSessionBody;
    const ids: Record<string, string> = {};
    const field = (definition: ModelBody['definition'], apiKey: string) =>
      definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
    const retype = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({
      ...rest,
      type,
      settings: {},
    });
    /** Since v0, each field kind: made private, deprecated, removed, retyped, and a field added. */
    const sinceV0 = (definition: ModelBody['definition'], prefix: string) => ({
      ...definition,
      fields: [
        ...definition.fields.flatMap((candidate) => {
          switch (candidate.apiKey) {
            case `${prefix}pvt`:
              return [{ ...candidate, public: false }];
            case `${prefix}dep`:
              return [{ ...candidate, deprecated: true }];
            case `${prefix}gone`:
              return [];
            case `${prefix}num`:
              return [retype(field(definition, `${prefix}num`), 'string')];
            default:
              return [candidate];
          }
        }),
        { apiKey: `${prefix}added`, label: 'Added', type: 'string' },
      ],
    });
    const fieldsFor = (prefix: string) => [
      { apiKey: `${prefix}title`, label: 'Title', type: 'string' },
      { apiKey: `${prefix}pvt`, label: 'Pvt', type: 'string' },
      { apiKey: `${prefix}dep`, label: 'Dep', type: 'string' },
      { apiKey: `${prefix}gone`, label: 'Gone', type: 'string' },
      { apiKey: `${prefix}num`, label: 'Num', type: 'integer' },
    ];
    const valuesFor = (prefix: string) => ({
      [`${prefix}title`]: 't',
      [`${prefix}pvt`]: 'p',
      [`${prefix}dep`]: 'd',
      [`${prefix}gone`]: 'g',
      [`${prefix}num`]: 3,
    });
    const change = async (model: ModelBody, kind: 'models' | 'components', prefix: string) => {
      const current = (await admin.get(`/api/admin/${kind}/${model.definition.id}`)).json<ModelBody>();
      const response = await admin.put(`/api/admin/${kind}/${current.definition.id}`, {
        definition: sinceV0(current.definition, prefix),
        expectedVersion: current.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      });
      expect([200, 202]).toContain(response.statusCode);
      await runContentSchemaJobs(database.current.db);
    };
    const callers = ['reader', 'adminToken'] as const;
    const modes = ['unchanged', 'title edited'] as const;

    beforeAll(async () => {
      box = await createDefinition(
        admin,
        { kind: 'component', apiKey: 'box', label: 'Box', fields: fieldsFor('b') },
        'components',
      );
      memo = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'memo',
        label: 'Memo',
        fields: [
          ...fieldsFor(''),
          { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: box.definition.id } },
          {
            apiKey: 'boxes',
            label: 'Boxes',
            type: 'component',
            settings: { component: box.definition.id, repeatable: true },
          },
        ],
      });
      reader = await user([
        { action: 'read', modelId: memo.definition.id },
        { action: 'update', modelId: memo.definition.id },
      ]);
      for (const caller of callers) {
        for (const mode of modes) {
          const entry = expectStatus(
            await admin.post('/api/admin/content/memo', {
              data: { ...valuesFor(''), hero: valuesFor('b'), boxes: [valuesFor('b'), valuesFor('b')] },
            }),
            201,
          ).json<EntryBody>();
          expectStatus(await admin.post(`/api/admin/content/memo/${entry.id}/publish`, {}), 200);
          ids[`${caller} ${mode}`] = entry.id;
        }
      }
      v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
        schemaVersionToken: string;
      }>().schemaVersionToken;
      await change(box, 'components', 'b');
      await change(memo, 'models', '');
    });

    it.each(callers.flatMap((caller) => modes.map((mode) => [caller, mode] as const)))(
      '%s, sent back %s',
      async (caller, mode) => {
        const token = caller === 'reader' ? reader.accessToken : adminToken;
        const id = ids[`${caller} ${mode}`] as string;
        const at = `/api/content/memos/${id}?schemaVersion=${encodeURIComponent(v0)}`;
        const read = expectStatus(await request('GET', at, token), 200).json<{
          data: Record<string, unknown>;
        }>().data;
        // The read's system attributes (`id`, `locale`, timestamps, `__model`, `__kinds`) are not fields.
        const system = new Set(['id', 'locale', 'createdAt', 'updatedAt', 'publishedAt']);
        const body = Object.fromEntries(
          Object.entries(read).filter(([key]) => !system.has(key) && !key.startsWith('__')),
        );
        const before = await footprint('memo', id);
        const response = await request('PUT', at, token, {
          expectedVersion: before.version,
          data: mode === 'unchanged' ? body : { ...body, title: 'edited' },
        });
        expect(response.statusCode, response.body).toBe(200);
        expect((await footprint('memo', id)).version).toBe(before.version + (mode === 'unchanged' ? 0 : 1));
      },
    );
  });

  describe('M1: a caller that reads drafts sees draft relation targets, on reads and writes alike', () => {
    it('removing a draft target its draft read showed removes it; a published read sent back keeps it for others', async () => {
      const thing = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'part',
        label: 'Part',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
      const kit = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'kit',
        label: 'Kit',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string' },
          {
            apiKey: 'parts',
            label: 'Parts',
            type: 'relation',
            settings: { target: thing.definition.id, cardinality: 'many' },
          },
        ],
      });
      const make = async (name: string, publish: boolean) => {
        const entry = expectStatus(
          await admin.post('/api/admin/content/part', { data: { name } }),
          201,
        ).json<EntryBody>();
        if (publish) {
          expectStatus(await admin.post(`/api/admin/content/part/${entry.id}/publish`, {}), 200);
        }
        return entry.id;
      };
      const draft = await make('draft', false);
      const pub = await make('pub', true);
      const create = async () => {
        const entry = expectStatus(
          await admin.post('/api/admin/content/kit', { data: { title: 't', parts: [draft, pub] } }),
          201,
        ).json<EntryBody>();
        expectStatus(await admin.post(`/api/admin/content/kit/${entry.id}/publish`, {}), 200);
        return entry.id;
      };
      const version = async (id: string) =>
        expectStatus(await admin.get(`/api/admin/content/kit/${id}`), 200).json<EntryBody>().version;
      // The admin token reads drafts: what it removes is removed.
      const id = await create();
      expectStatus(
        await request('PUT', `/api/content/kits/${id}`, adminToken, {
          expectedVersion: await version(id),
          data: { parts: [pub] },
        }),
        200,
      );
      expect((await admin.get(`/api/admin/content/kit/${id}`)).json<EntryBody>().data.parts).toEqual([pub]);
      // A reader of published entries only: the draft target it never saw stays.
      const reader = await user([
        { action: 'read', modelId: null },
        { action: 'update', modelId: kit.definition.id },
      ]);
      const other = await create();
      const read = expectStatus(
        await request('GET', `/api/content/kits/${other}`, reader.accessToken),
        200,
      ).json<{
        data: { parts: string[] };
      }>().data;
      expect(read.parts).toEqual([pub]);
      expectStatus(
        await request('PUT', `/api/content/kits/${other}`, reader.accessToken, {
          expectedVersion: await version(other),
          data: { parts: read.parts },
        }),
        200,
      );
      expect((await admin.get(`/api/admin/content/kit/${other}`)).json<EntryBody>().data.parts).toEqual([
        draft,
        pub,
      ]);
    });
  });

  describe('M2 and fan-out: a new locale', () => {
    let doc: ModelBody;
    let alice: AppSessionBody;
    beforeAll(async () => {
      expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'note_card',
          label: 'Note card',
          fields: [
            { apiKey: 'heading', label: 'Heading', type: 'string' },
            { apiKey: 'note', label: 'Note', type: 'string', public: false },
          ],
        },
        'components',
      );
      const list = { type: 'component', settings: { component: card.definition.id, repeatable: true } };
      doc = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'doc',
        label: 'Doc',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          { apiKey: 'cards', label: 'Cards', ...list },
          { apiKey: 'lcards', label: 'LCards', localized: true, ...list },
          {
            apiKey: 'lhero',
            label: 'LHero',
            localized: true,
            type: 'component',
            settings: { component: card.definition.id },
          },
        ],
      });
      alice = await user([
        { action: 'read', modelId: doc.definition.id },
        { action: 'update', modelId: doc.definition.id },
      ]);
    });
    const createEn = async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/doc?locale=en', {
          locale: 'en',
          data: { title: 'en', cards: [{ heading: 'S', note: 'nS' }], lcards: [{ heading: 'a', note: 'n' }] },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/doc/${entry.id}/publish`, { locales: ['en'] }), 200);
      return entry.id;
    };

    it.each([
      ['a hidden localized list, one new item', { title: 'fr', lcards: [{ heading: 'fr-a' }] }, 200],
      [
        'a hidden localized list, two items',
        { title: 'fr', lcards: [{ heading: 'fr-a' }, { heading: 'fr-b' }] },
        200,
      ],
      ['a localized single component', { title: 'fr', lhero: { heading: 'fr-h' } }, 200],
      // Shared values come from a locale whose draft this caller may not see: the usual rule.
      ['a hidden shared list, edited', { title: 'fr', cards: [{ heading: 'S2' }] }, 422],
    ] as const)('%s: %s', async (_name, data, status) => {
      const id = await createEn();
      const response = await request('PUT', `/api/content/docs/${id}?locale=fr`, alice.accessToken, {
        locale: 'fr',
        expectedVersion: null,
        data,
      });
      expect(response.statusCode, response.body).toBe(status);
    });

    it.each(['with IDs', 'without IDs'])(
      'legacy items in both locales, read and sent back %s, through each route: nothing is written',
      async (mode) => {
        const id = await createEn();
        expectStatus(
          await admin.put(`/api/admin/content/doc/${id}?locale=fr`, {
            locale: 'fr',
            expectedVersion: null,
            data: { title: 'fr', lcards: [{ heading: 'fa', note: 'fn' }] },
          }),
          200,
        );
        expectStatus(
          await admin.post(`/api/admin/content/doc/${id}/publish`, { locales: ['en', 'fr'] }),
          200,
        );
        await inStorage(id, (data) => withoutIds(data));
        const start = await footprint('doc', id);
        for (const locale of ['en', 'fr']) {
          const read = expectStatus(
            await request('GET', `/api/content/docs/${id}?locale=${locale}`, adminToken),
            200,
          ).json<{ data: Record<string, unknown> }>().data;
          const pick = (key: string) => (mode === 'with IDs' ? read[key] : withoutIds(read[key]));
          const view = (await admin.get(`/api/admin/content/doc/${id}?locale=${locale}`)).json<EntryBody>();
          const response = await request('PUT', `/api/content/docs/${id}?locale=${locale}`, adminToken, {
            locale,
            expectedVersion: view.version,
            data: { cards: pick('cards'), lcards: pick('lcards') },
          });
          expect(response.statusCode, response.body).toBe(200);
          expect([locale, await footprint('doc', id)]).toEqual([locale, start]);
        }
      },
    );

    it('a shared list fanned out to another locale never repeats an ID there', async () => {
      const id = await createEn();
      expectStatus(
        await admin.put(`/api/admin/content/doc/${id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr', lcards: [{ heading: 'frL', note: 'nfrL' }] },
        }),
        200,
      );
      const enView = (await admin.get(`/api/admin/content/doc/${id}?locale=en`)).json<EntryBody>();
      const sharedId = (enView.data.cards as Item[])[0]?.id as string;
      const lcardsId = doc.definition.fields.find((candidate) => candidate.apiKey === 'lcards')?.id as string;
      // fr's localized item holds the shared card's ID (as hand-edited or older data can).
      await inStorage(id, (data, locale) =>
        locale === 'fr'
          ? {
              ...data,
              [lcardsId]: (data[lcardsId] as Array<Record<string, unknown>>).map((item) => ({
                ...item,
                __id: sharedId,
              })),
            }
          : data,
      );
      expectStatus(
        await admin.put(`/api/admin/content/doc/${id}?locale=en`, {
          locale: 'en',
          expectedVersion: enView.version,
          data: { cards: [{ id: sharedId, heading: 'S+', note: 'nS' }] },
        }),
        200,
      );
      const fr = (await heads(id)).find((head) => head.locale === 'fr' && head.state === 'draft');
      const stored = JSON.stringify(fr?.data);
      const found = [...stored.matchAll(/"__id":"([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(found).size).toBe(found.length);
    });
  });

  describe('imp2: a stored ID equal to a legacy item derivation in the same list', () => {
    it('the legacy item reads with another ID, the same in draft and published; writes by ID name one item each', async () => {
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'imp_card',
          label: 'Imp card',
          fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
        },
        'components',
      );
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'board',
        label: 'Board',
        fields: [
          {
            apiKey: 'cards',
            label: 'Cards',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
          },
        ],
      });
      const entry = expectStatus(
        await admin.post('/api/admin/content/board', {
          data: { cards: [{ heading: 'A' }, { heading: 'X' }] },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/board/${entry.id}/publish`, {}), 200);
      // A is stored without an ID; X stores the ID A's derivation gives.
      await inStorage(entry.id, (data) => {
        const [key] = Object.keys(data);
        const cards = data[key as string] as Array<Record<string, unknown>>;
        return { ...data, [key as string]: [withoutIds(cards[0]), cards[1]] };
      });
      const derived = (
        expectStatus(await admin.get(`/api/admin/content/board/${entry.id}`), 200).json<EntryBody>().data
          .cards as Item[]
      )[0]?.id as string;
      await inStorage(entry.id, (data) => {
        const [key] = Object.keys(data);
        const cards = data[key as string] as Array<Record<string, unknown>>;
        return { ...data, [key as string]: [cards[0], { ...cards[1], __id: derived }] };
      });
      const read = expectStatus(
        await request('GET', `/api/content/boards/${entry.id}`, adminToken),
        200,
      ).json<{
        data: { cards: Item[] };
      }>().data.cards;
      const draft = expectStatus(
        await admin.get(`/api/admin/content/board/${entry.id}`),
        200,
      ).json<EntryBody>().data.cards as Item[];
      expect(new Set(read.map((item) => item.id)).size).toBe(2);
      expect(draft.map((item) => item.id)).toEqual(read.map((item) => item.id));
      expect(read[1]?.id).toBe(derived);
    });
  });

  describe('ninth round: echoes through a version, and bundles with bad item IDs', () => {
    let doc: ModelBody;
    let v0: string;
    let limited: AppSessionBody;
    const field = (definition: ModelBody['definition'], apiKey: string) =>
      definition.fields.find((candidate) => candidate.apiKey === apiKey) as FieldBody;
    beforeAll(async () => {
      const locale = await admin.post('/api/admin/locales', { code: 'fr', label: 'French' });
      expect([201, 409]).toContain(locale.statusCode);
      const chip = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'r9_chip',
          label: 'R9 chip',
          fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
        },
        'components',
      );
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'r9_card',
          label: 'R9 card',
          fields: [
            { apiKey: 'heading', label: 'Heading', type: 'string' },
            { apiKey: 'rmv', label: 'Rmv', type: 'string' },
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
      doc = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r9doc',
        label: 'R9 doc',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          {
            apiKey: 'cards',
            label: 'Cards',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
          },
        ],
      });
      // An app user whose write grant names fields.
      limited = await user([
        { action: 'read', modelId: doc.definition.id },
        {
          action: 'update',
          modelId: doc.definition.id,
          fieldIds: [field(doc.definition, 'title').id, field(doc.definition, 'cards').id],
        },
      ]);
      v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
        schemaVersionToken: string;
      }>().schemaVersionToken;
      // Since v0, the card's `rmv` is removed.
      const current = (await admin.get(`/api/admin/components/${card.definition.id}`)).json<ModelBody>();
      const changed = await admin.put(`/api/admin/components/${card.definition.id}`, {
        definition: {
          ...current.definition,
          fields: current.definition.fields.filter((candidate) => candidate.apiKey !== 'rmv'),
        },
        expectedVersion: current.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      });
      expect([200, 202]).toContain(changed.statusCode);
      await runContentSchemaJobs(database.current.db);
    });
    /** An entry in `en` and `fr`, published; the first card and its chips stored as before item IDs. */
    const entry = async () => {
      const created = expectStatus(
        await admin.post('/api/admin/content/r9doc?locale=en', {
          locale: 'en',
          data: {
            title: 'en',
            cards: [
              { heading: 'A', chips: [{ label: 'x' }, { label: 'y' }] },
              { heading: 'B', chips: [{ label: 'z' }] },
            ],
          },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/r9doc/${created.id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr' },
        }),
        200,
      );
      expectStatus(
        await admin.post(`/api/admin/content/r9doc/${created.id}/publish`, { locales: ['en', 'fr'] }),
        200,
      );
      const cardsId = field(doc.definition, 'cards').id;
      await inStorage(created.id, (data) => {
        const cards = data[cardsId] as Array<Record<string, unknown>>;
        return { ...data, [cardsId]: [withoutIds(cards[0]), cards[1]] };
      });
      return created.id;
    };
    /** What a read through `version` shows, without the read's system attributes. */
    const readBack = async (id: string, token: string, version: string | null) => {
      const at = `/api/content/r9docs/${id}?locale=en${version ? `&schemaVersion=${encodeURIComponent(version)}` : ''}`;
      const read = expectStatus(await request('GET', at, token), 200).json<{
        data: Record<string, unknown>;
      }>().data;
      return { at, body: { title: read.title, cards: read.cards } };
    };

    it.each([
      ['an admin token, through the version', 'adminToken', true],
      ['an admin token, without a version', 'adminToken', false],
      ['a field-limited app user, through the version', 'limited', true],
    ] as const)('legacy nested items sent back as read by %s: a no-op', async (_name, caller, versioned) => {
      const id = await entry();
      const token = caller === 'adminToken' ? adminToken : limited.accessToken;
      const { at, body } = await readBack(id, token, versioned ? v0 : null);
      const before = await footprint('r9doc', id);
      const response = await request('PUT', at, token, {
        locale: 'en',
        expectedVersion: before.version,
        data: body,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(await footprint('r9doc', id)).toEqual(before);
    });

    it('a field-limited app user sends back a field removed since its version, with another field edited', async () => {
      const id = await entry();
      const { at, body } = await readBack(id, limited.accessToken, v0);
      expect((body.cards as Item[])[0]).toHaveProperty('rmv', null);
      const before = await footprint('r9doc', id);
      const response = await request('PUT', at, limited.accessToken, {
        locale: 'en',
        expectedVersion: before.version,
        data: { ...body, title: 'edited' },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect((await footprint('r9doc', id)).version).toBe(before.version + 1);
      // A value for it is still refused: only the empty value the read showed is that read sent back.
      const valued = await request('PUT', at, limited.accessToken, {
        locale: 'en',
        expectedVersion: before.version + 1,
        data: { cards: (body.cards as Item[]).map((card) => ({ ...card, rmv: 'v' })) },
      });
      expect(valued.statusCode).toBe(422);
    });

    it.each([
      [
        'a repeated ID',
        (cards: Array<Record<string, unknown>>) => cards.map((card) => ({ ...card, __id: cards[1]?.__id })),
      ],
      ['a number', (cards: Array<Record<string, unknown>>) => cards.map((card) => ({ ...card, __id: 5 }))],
      [
        'an empty string',
        (cards: Array<Record<string, unknown>>) => cards.map((card) => ({ ...card, __id: '' })),
      ],
      [
        '80 characters',
        (cards: Array<Record<string, unknown>>) => cards.map((card) => ({ ...card, __id: 'x'.repeat(80) })),
      ],
    ])(
      'an import bundle with %s as an item ID is refused before anything is applied',
      async (_name, edit) => {
        const id = await entry();
        const cardsId = field(doc.definition, 'cards').id;
        const bundle = (
          await testApp.app.inject({
            method: 'GET',
            url: '/api/admin/transfer/export',
            headers: bearer(adminToken),
          })
        ).body
          .split('\n')
          .map((line) => {
            if (!line.includes('"type":"entry"') || !line.includes(id)) {
              return line;
            }
            const record = JSON.parse(line) as {
              id: string;
              heads: Array<{ data: Record<string, unknown> }>;
            };
            if (record.id !== id) {
              return line;
            }
            for (const head of record.heads) {
              head.data = {
                ...head.data,
                [cardsId]: edit(head.data[cardsId] as Array<Record<string, unknown>>),
              };
            }
            return JSON.stringify(record);
          })
          .join('\n');
        for (const dryRun of [true, false]) {
          const response = await testApp.app.inject({
            method: 'POST',
            url: `/api/admin/transfer/import${dryRun ? '?dryRun=true' : ''}`,
            headers: { ...bearer(adminToken), 'content-type': 'application/x-ndjson' },
            payload: bundle,
          });
          expect(response.statusCode, response.body).toBe(400);
          const error = response.json<{
            error: { code: string; details: { entryId: string; path: string } };
          }>().error;
          expect(error.code).toBe('BUNDLE_INVALID');
          expect(error.details.entryId).toBe(id);
          expect(error.details.path).toMatch(new RegExp(`/${cardsId}/\\d+/__id$`));
        }
      },
    );
  });
});
