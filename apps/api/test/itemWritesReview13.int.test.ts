import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createAppRole, setPublicGrants, signUp, type AppSessionBody } from './helpers/appUsers.js';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type Data = Record<string, unknown>;
type Issue = { path: string; code: string; message: string };
type FieldBody = ModelBody['definition']['fields'][number];

/** Without item IDs (`id` in the API), at any depth. */
const withoutIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, item]) => [key, withoutIds(item)]),
        )
      : value;

const NOT_HERE =
  'is not an item of this list. If the list changed since you read it, read it again; to add an item copied from elsewhere, send it with "id": null.';

/**
 * The thirteenth review (plan item-ids). A new item a client copies, through an older schema version, from a head it
 * read stores what the same write without a version stores (the fields it cannot write there are carried from that
 * head), and sending it again changes nothing. Items copied or moved with their ids from another entry or another
 * field, where items can hold values hidden from the caller, are new when every stored item is still claimed, and
 * refused when the write would replace stored items.
 */
describe('item writes: thirteenth review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let alice: AppSessionBody;
  let pinnedToken: string;
  /** Two entries of `r13ln` holding a value in every field the version cannot write, made at the version. */
  let kindEntries: string[] = [];
  /** The schema version the old client was built against (`<schemaId>:<version>`). */
  let v: string;
  const models: Record<string, ModelBody> = {};

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string | null, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const footprint = async (id: string) => ({
    heads: await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'version', 'revision_id'])
      .where('entry_id', '=', id)
      .orderBy('locale')
      .orderBy('state')
      .execute(),
    revisions: (
      await database.current.db
        .selectFrom('content_revisions')
        .select('id')
        .where('entry_id', '=', id)
        .execute()
    ).length,
    events: (
      await database.current.db
        .selectFrom('outbox_events')
        .select('id')
        .where('aggregate_id', '=', id)
        .execute()
    ).length,
  });
  const adminView = async (model: string, id: string) =>
    expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
  const publish = async (model: string, id: string) =>
    expectStatus(await admin.post(`/api/admin/content/${model}/${id}/publish`, {}), 200);
  const issuesOf = (body: string) =>
    (JSON.parse(body) as { error: { details?: { issues?: Issue[] } } }).error.details?.issues ?? [];

  /** Changes fields of a component definition after the client's version (acknowledged, jobs run). */
  const changeComponent = async (
    componentId: string,
    change: (fields: FieldBody[]) => Array<FieldBody | Record<string, unknown>>,
  ) => {
    const current = expectStatus(
      await admin.get(`/api/admin/components/${componentId}`),
      200,
    ).json<ModelBody>();
    const changed = await admin.put(`/api/admin/components/${componentId}`, {
      definition: { ...current.definition, fields: change(current.definition.fields) },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], changed.body).toContain(changed.statusCode);
    await runContentSchemaJobs(database.current.db);
  };
  const retyped = ({ editor: _editor, ...rest }: FieldBody, type: string) => ({
    ...rest,
    type,
    settings: {},
  });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '100000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const component = (apiKey: string, fields: unknown[]) =>
      createDefinition(admin, { kind: 'component', apiKey, label: apiKey, fields }, 'components');
    const list = (apiKey: string, componentId: string) => ({
      apiKey,
      label: apiKey,
      type: 'component',
      settings: { component: componentId, repeatable: true },
    });
    // Copies and moves: `note` is private, so the `h` lists can hold values hidden from delivery callers.
    const noted = await component('r13_noted', [
      { apiKey: 'label', label: 'Label', type: 'string' },
      { apiKey: 'note', label: 'Note', type: 'string', public: false },
    ]);
    const open = await component('r13_open', [{ apiKey: 'label', label: 'Label', type: 'string' }]);
    models.r13cp = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r13cp',
      label: 'R13 copies',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        list('h1', noted.definition.id),
        list('h2', noted.definition.id),
        list('o1', open.definition.id),
        list('o2', open.definition.id),
      ],
    });
    // Writes through a version: `count` is a number there and an integer today, at the top of an item and nested.
    const chip = await component('r13_chip', [
      { apiKey: 'label', label: 'Label', type: 'string' },
      { apiKey: 'count', label: 'Count', type: 'number' },
    ]);
    const plain = await component('r13_plain', [
      { apiKey: 'heading', label: 'Heading', type: 'string' },
      { apiKey: 'count', label: 'Count', type: 'number' },
      list('chips', chip.definition.id),
    ]);
    // Every kind of field a version cannot write: retyped, removed since, made private, deprecated, added since.
    const card = await component('r13_card', [
      { apiKey: 'heading', label: 'Heading', type: 'string' },
      { apiKey: 'count', label: 'Count', type: 'number' },
      { apiKey: 'gone', label: 'Gone', type: 'string' },
      { apiKey: 'secret', label: 'Secret', type: 'string' },
      { apiKey: 'old', label: 'Old', type: 'string' },
      list('chips', chip.definition.id),
    ]);
    const lensFields = (componentId: string) => [
      { apiKey: 'title', label: 'Title', type: 'string' },
      list('cards', componentId),
      { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: componentId } },
    ];
    models.r13eq = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r13eq',
      label: 'R13 equal',
      fields: lensFields(plain.definition.id),
    });
    models.r13ln = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r13ln',
      label: 'R13 kinds',
      fields: lensFields(card.definition.id),
    });
    // Values a version reads as null: `cnt` and `kn` are integers there and numbers today, holding fractions.
    expect([201, 409]).toContain(
      (await admin.post('/api/admin/locales', { code: 'de', label: 'German' })).statusCode,
    );
    const kid = await component('r13_kid', [
      { apiKey: 'label', label: 'Label', type: 'string' },
      { apiKey: 'kn', label: 'Kn', type: 'integer' },
    ]);
    const converted = await component('r13_conv', [
      { apiKey: 'heading', label: 'Heading', type: 'string' },
      { apiKey: 'cnt', label: 'Cnt', type: 'integer' },
      { apiKey: 'pv', label: 'Private', type: 'string' },
      { apiKey: 'dep', label: 'Deprecated', type: 'string' },
      list('kids', kid.definition.id),
    ]);
    const convertedFields = (localized: boolean) => [
      { apiKey: 'title', label: 'Title', type: 'string', localized: true },
      { ...list('cards', converted.definition.id), ...(localized ? { localized: true } : {}) },
    ];
    models.r13lp = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r13lp',
      label: 'R13 published',
      localized: true,
      fields: convertedFields(false),
    });
    models.r13lo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r13lo',
      label: 'R13 locales',
      localized: true,
      draftAndPublish: false,
      fields: convertedFields(true),
    });
    v = (await request('GET', '/api/content/r13eqs', adminToken)).headers[
      'shapio-schema-version-current'
    ] as string;
    const kinds = { count: 2, gone: 'g', secret: 's', old: 'o', chips: [{ label: 'c', count: 3 }] };
    kindEntries = await Promise.all(
      [0, 1].map(
        async () =>
          expectStatus(
            await admin.post('/api/admin/content/r13ln', {
              data: { title: 't', cards: [{ heading: 'A', ...kinds }], hero: { heading: 'H', ...kinds } },
            }),
            201,
          ).json<EntryBody>().id,
      ),
    );
    for (const component of [chip, plain]) {
      await changeComponent(component.definition.id, (fields) =>
        fields.map((field) => (field.apiKey === 'count' ? retyped(field, 'integer') : field)),
      );
    }
    await changeComponent(card.definition.id, (fields) => [
      ...fields.flatMap((field) =>
        field.apiKey === 'gone'
          ? []
          : field.apiKey === 'count'
            ? [retyped(field, 'integer')]
            : field.apiKey === 'secret'
              ? [{ ...field, public: false }]
              : field.apiKey === 'old'
                ? [{ ...field, deprecated: true }]
                : [field],
      ),
      { apiKey: 'extra', label: 'Extra', type: 'string' },
    ]);

    await changeComponent(converted.definition.id, (fields) => [
      ...fields.map((field) =>
        field.apiKey === 'cnt'
          ? retyped(field, 'number')
          : field.apiKey === 'pv'
            ? { ...field, public: false }
            : field.apiKey === 'dep'
              ? { ...field, deprecated: true }
              : field,
      ),
      { apiKey: 'extra', label: 'Extra', type: 'string' },
    ]);
    await changeComponent(kid.definition.id, (fields) =>
      fields.map((field) => (field.apiKey === 'kn' ? retyped(field, 'number') : field)),
    );

    const grants = [models.r13cp.definition.id, models.r13lo.definition.id].flatMap((modelId) => [
      { action: 'read' as const, modelId },
      { action: 'update' as const, modelId },
    ]);
    alice = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${alice.user.id}`,
        payload: { roleIds: [await createAppRole(database.current.db, grants)] },
      }),
      200,
    );
    await setPublicGrants(database.current.db, grants);
    const roles = expectStatus(await admin.get('/api/admin/roles'), 200).json<
      Array<{ id: string; key: string }>
    >();
    pinnedToken = expectStatus(
      await admin.post('/api/admin/tokens', {
        name: 'Pinned admin',
        roleId: roles.find((role) => role.key === 'admin')?.id,
        network: true,
        pinnedSchemaVersion: Number(v.split(':')[1]),
      }),
      201,
    ).json<{ token: string }>().token;
  });
  afterAll(async () => {
    await setPublicGrants(database.current.db, []);
    await testApp.app.close();
  });

  describe('a new item copied through a schema version from a head the caller read', () => {
    type Via = 'version' | 'none' | 'graphql';
    const route = (model: string, id: string, via: Via) =>
      `/api/content/${model}s/${id}${via === 'version' ? `?schemaVersion=${encodeURIComponent(v)}` : ''}`;
    const tokenOf = (via: Via) => (via === 'graphql' ? pinnedToken : adminToken);

    /** A published entry whose draft an admin then changed: the list holds D instead of A, the hero is cleared. */
    const makeAhead = async (model: string, id: string) => {
      await publish(model, id);
      const published = await adminView(model, id);
      expectStatus(
        await admin.put(`/api/admin/content/${model}/${id}`, {
          expectedVersion: published.version,
          data: { cards: [{ heading: 'D' }], hero: null },
        }),
        200,
      );
      return id;
    };
    /** `makeAhead`, on a new entry whose list holds A and whose hero H, each with `values`. */
    const ahead = async (model: string, values: Data) =>
      makeAhead(
        model,
        expectStatus(
          await admin.post(`/api/admin/content/${model}`, {
            data: { title: 't', cards: [{ heading: 'A', ...values }], hero: { heading: 'H', ...values } },
          }),
          201,
        ).json<EntryBody>().id,
      );
    /** An entry made at the version (`kindEntries`), given a value in the field added since, then `makeAhead`. */
    const kindAhead = async (id: string) => {
      const current = await adminView('r13ln', id);
      const extra = (item: unknown) => ({ ...(item as Item), extra: 'e' });
      expectStatus(
        await admin.put(`/api/admin/content/r13ln/${id}`, {
          expectedVersion: current.version,
          data: { cards: (current.data.cards as Item[]).map(extra), hero: extra(current.data.hero) },
        }),
        200,
      );
      return makeAhead('r13ln', id);
    };
    const readOf = async (model: string, id: string, via: Via) => {
      const data = expectStatus(await request('GET', route(model, id, via), tokenOf(via)), 200).json<{
        data: Data;
      }>().data;
      return { cards: data.cards, hero: data.hero };
    };
    const write = async (model: string, id: string, via: Via, body: Data) => {
      const version = (await adminView(model, id)).version;
      if (via === 'graphql') {
        const name = `${model.charAt(0).toUpperCase()}${model.slice(1)}`;
        const result = await graphql(
          testApp.app,
          `mutation ($id: ID!, $v: Int, $d: ${name}Input) { update${name}(id: $id, expectedVersion: $v, data: $d) { id } }`,
          { headers: bearer(pinnedToken), variables: { id, v: version, d: body } },
        );
        return {
          ok: result.body.errors === undefined,
          detail: JSON.stringify(result.body),
          code: (result.body.errors?.[0]?.extensions as { code?: string } | undefined)?.code,
        };
      }
      const response = await request('PUT', route(model, id, via), tokenOf(via), {
        expectedVersion: version,
        data: body,
      });
      return {
        ok: response.statusCode === 200,
        detail: response.body,
        code:
          response.statusCode === 200 ? undefined : response.json<{ error: { code: string } }>().error.code,
      };
    };
    const stored = async (model: string, id: string) => {
      const { data } = await adminView(model, id);
      return withoutIds({ cards: data.cards, hero: data.hero });
    };
    /** The published read sent back: accepted; sent again twice: nothing changes. */
    const sendBackThrice = async (model: string, id: string, via: Via) => {
      const body = await readOf(model, id, via);
      const first = await write(model, id, via, body);
      expect(first.ok, first.detail).toBe(true);
      const after = await footprint(id);
      for (let round = 0; round < 2; round += 1) {
        const again = await write(model, id, via, body);
        expect(again.ok, again.detail).toBe(true);
        expect(await footprint(id)).toEqual(after);
      }
      return stored(model, id);
    };
    const values = { count: 2, chips: [{ label: 'c', count: 3 }] };

    it.each(['version', 'graphql'] as const)(
      'through %s: stores what the same write without a version stores, a resend changes nothing, publish keeps count',
      async (via) => {
        const results: unknown[] = [];
        for (const path of [via, 'none'] as const) {
          const id = await ahead('r13eq', values);
          results.push(await sendBackThrice('r13eq', id, path));
          await publish('r13eq', id);
          const published = expectStatus(
            await request('GET', `/api/content/r13eqs/${id}`, adminToken),
            200,
          ).json<{ data: Data }>().data;
          expect(withoutIds({ cards: published.cards, hero: published.hero })).toEqual(results.at(-1));
        }
        expect(results[0]).toEqual({
          cards: [{ heading: 'A', ...values }],
          hero: { heading: 'H', ...values },
        });
        expect(results[0]).toEqual(results[1]);
      },
    );

    it('every kind of field a version cannot write: an echo is carried as without a version, nothing hidden is', async () => {
      const viaVersion = await kindAhead(kindEntries[0] as string);
      const read = await readOf('r13ln', viaVersion, 'version');
      expect(withoutIds(read.cards)).toEqual([
        { heading: 'A', ...values, gone: null, secret: 's', old: null },
      ]);
      const throughVersion = await sendBackThrice('r13ln', viaVersion, 'version');
      // What the version does not know, or cannot read, is never carried to a new item.
      expect(throughVersion).toEqual({
        cards: [{ heading: 'A', ...values, secret: 's', extra: null }],
        hero: { heading: 'H', ...values, secret: 's', extra: null },
      });
      // Without a version, the client sends what today's read shows: the same, and the field added since.
      const withoutVersion = await kindAhead(kindEntries[1] as string);
      const today = await sendBackThrice('r13ln', withoutVersion, 'none');
      expect(today).toEqual({
        cards: [{ heading: 'A', ...values, secret: 's', extra: 'e' }],
        hero: { heading: 'H', ...values, secret: 's', extra: 'e' },
      });
    });

    it.each([
      ['a value that is not what the head showed', { id: 'shown', count: 5 }],
      ['an id no head shows', { id: 'QQQQQQQQQQQQ' }],
      ['"id": null', { id: null }],
    ] as const)('%s: refused as a field the version cannot write, nothing written', async (_name, change) => {
      const id = await ahead('r13eq', values);
      const read = await readOf('r13eq', id, 'version');
      const changed = (shown: Item) => ({
        ...shown,
        ...change,
        id: change.id === 'shown' ? shown.id : change.id,
      });
      const before = await footprint(id);
      for (const body of [
        { cards: [changed((read.cards as Item[])[0] as Item)] },
        { hero: changed(read.hero as Item) },
      ]) {
        const result = await write('r13eq', id, 'version', body);
        expect(result.code, result.detail).toBe('LENS_WRITE_UNSUPPORTED');
        expect(await footprint(id)).toEqual(before);
      }
    });
  });

  describe('a copied item whose fields the version reads as null', () => {
    const card = (heading: string, cnt: number, kn: number) => ({
      heading,
      cnt,
      pv: `pv-${heading}`,
      extra: `x-${heading}`,
      kids: [{ label: `k-${heading}`, kn }],
    });
    const at = (via: 'version' | 'none') =>
      via === 'version' ? `&schemaVersion=${encodeURIComponent(v)}` : '';
    const readCards = async (
      model: string,
      id: string,
      locale: string,
      token: string | null,
      via: 'version' | 'none',
    ) =>
      expectStatus(
        await request('GET', `/api/content/${model}s/${id}?locale=${locale}${at(via)}`, token),
        200,
      ).json<{
        data: { cards: Item[] };
      }>().data.cards;
    /** Writes `cards` to the `en` draft, then again: the second changes nothing. Returns what the admin reads. */
    const writeTwice = async (
      model: string,
      id: string,
      token: string | null,
      via: 'version' | 'none',
      cards: Item[],
    ) => {
      const put = async () =>
        request('PUT', `/api/content/${model}s/${id}?locale=en${at(via)}`, token, {
          locale: 'en',
          expectedVersion: (await adminView(model, `${id}?locale=en`)).version,
          data: { cards },
        });
      const first = await put();
      expect(first.statusCode, first.body).toBe(200);
      const after = await footprint(id);
      const again = await put();
      expect(again.statusCode, again.body).toBe(200);
      expect(await footprint(id)).toEqual(after);
      return withoutIds((await adminView(model, `${id}?locale=en`)).data.cards);
    };
    const stored = (heading: string, cnt: number, kn: number, rest: Data) => ({
      heading,
      cnt,
      kids: [{ label: `k-${heading}`, kn }],
      ...rest,
    });

    it('a draft-capable token copies the published items back over a draft that moved on', async () => {
      const results: unknown[] = [];
      for (const via of ['version', 'none'] as const) {
        const created = expectStatus(
          await admin.post('/api/admin/content/r13lp?locale=en', {
            locale: 'en',
            data: { title: 'en', cards: [card('P', 2.5, 3.5)] },
          }),
          201,
        ).json<EntryBody>();
        await publish('r13lp', created.id);
        const published = await adminView('r13lp', `${created.id}?locale=en`);
        expectStatus(
          await admin.put(`/api/admin/content/r13lp/${created.id}?locale=en`, {
            locale: 'en',
            expectedVersion: published.version,
            data: { cards: [{ heading: 'D' }] },
          }),
          200,
        );
        const cards = await readCards('r13lp', created.id, 'en', adminToken, via);
        if (via === 'version') {
          expect(cards[0]?.cnt).toBeNull();
        }
        results.push(await writeTwice('r13lp', created.id, adminToken, via, cards));
      }
      expect(results[0]).toEqual([stored('P', 2.5, 3.5, { pv: 'pv-P', extra: null })]);
      expect(results[1]).toEqual([stored('P', 2.5, 3.5, { pv: 'pv-P', extra: 'x-P' })]);
    });

    it("an app user copies another locale's items, nested too; what it cannot read starts empty", async () => {
      const results: unknown[] = [];
      for (const via of ['version', 'none'] as const) {
        const created = expectStatus(
          await admin.post('/api/admin/content/r13lo?locale=en', {
            locale: 'en',
            data: { title: 'en', cards: [card('P', 2.5, 3.5)] },
          }),
          201,
        ).json<EntryBody>();
        expectStatus(
          await admin.put(`/api/admin/content/r13lo/${created.id}?locale=de`, {
            locale: 'de',
            expectedVersion: null,
            data: { title: 'de', cards: [card('G', 6.5, 4.5)] },
          }),
          200,
        );
        const en = await readCards('r13lo', created.id, 'en', alice.accessToken, via);
        const de = await readCards('r13lo', created.id, 'de', alice.accessToken, via);
        if (via === 'version') {
          expect(de[0]?.cnt).toBeNull();
          expect(de[0]?.kids).toEqual([expect.objectContaining({ kn: null })]);
        }
        results.push(await writeTwice('r13lo', created.id, alice.accessToken, via, [...en, ...de]));
      }
      const kept = stored('P', 2.5, 3.5, { pv: 'pv-P', extra: 'x-P' });
      expect(results[0]).toEqual([kept, stored('G', 6.5, 4.5, { pv: null, extra: null })]);
      expect(results[1]).toEqual([kept, stored('G', 6.5, 4.5, { pv: null, extra: 'x-G' })]);
    });

    it('heads that show the item and disagree on the value the version reads as null: refused', async () => {
      const created = expectStatus(
        await admin.post('/api/admin/content/r13lp?locale=en', {
          locale: 'en',
          data: { title: 'en', cards: [card('P', 2.5, 3.5)] },
        }),
        201,
      ).json<EntryBody>();
      await adminSaveDe(created.id);
      expectStatus(
        await admin.post(`/api/admin/content/r13lp/${created.id}/publish`, { locales: ['en', 'de'] }),
        200,
      );
      // The shared list changes in `en` and is published there only: the `de` published head keeps 2.5.
      const edit = async (cards: Item[]) => {
        const current = await adminView('r13lp', `${created.id}?locale=en`);
        expectStatus(
          await admin.put(`/api/admin/content/r13lp/${created.id}?locale=en`, {
            locale: 'en',
            expectedVersion: current.version,
            data: { cards },
          }),
          200,
        );
      };
      const draft = (await adminView('r13lp', `${created.id}?locale=en`)).data.cards as Item[];
      await edit(draft.map((item) => ({ ...item, cnt: 2.7 })));
      expectStatus(
        await admin.post(`/api/admin/content/r13lp/${created.id}/publish`, { locales: ['en'] }),
        200,
      );
      await edit([{ heading: 'D' }]);
      const cards = await readCards('r13lp', created.id, 'en', adminToken, 'version');
      const before = await footprint(created.id);
      const response = await request(
        'PUT',
        `/api/content/r13lps/${created.id}?locale=en${at('version')}`,
        adminToken,
        {
          locale: 'en',
          expectedVersion: (await adminView('r13lp', `${created.id}?locale=en`)).version,
          data: { cards },
        },
      );
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('LENS_WRITE_UNSUPPORTED');
      expect(issuesOf(response.body).map((issue) => issue.path)).toEqual(['/cards/0/cnt']);
      expect(await footprint(created.id)).toEqual(before);
    });
    const adminSaveDe = async (id: string) =>
      expectStatus(
        await admin.put(`/api/admin/content/r13lp/${id}?locale=de`, {
          locale: 'de',
          expectedVersion: null,
          data: { title: 'de' },
        }),
        200,
      );
  });

  describe('items copied or moved with their ids from another entry or another field', () => {
    type Caller = 'appUser' | 'anonymous';
    const callers: Caller[] = ['appUser', 'anonymous'];
    const tokenOf = (caller: Caller) => (caller === 'appUser' ? alice.accessToken : null);
    type Lists = { first: 'h1' | 'o1'; second: 'h2' | 'o2' };
    const create = async (prefix: string, notes: readonly string[]) => {
      const created = expectStatus(
        await admin.post('/api/admin/content/r13cp', {
          data: {
            title: prefix,
            h1: [
              { label: `${prefix}a`, note: notes[0] },
              { label: `${prefix}b`, note: notes[1] },
            ],
            h2: [{ label: `${prefix}c`, note: notes[2] }],
            o1: [{ label: `${prefix}a` }, { label: `${prefix}b` }],
            o2: [{ label: `${prefix}c` }],
          },
        }),
        201,
      ).json<EntryBody>();
      await publish('r13cp', created.id);
      return created.id;
    };
    const rows = {
      a: ({ first }: Lists, one: Data, two: Data) => ({ [first]: two[first] }),
      b: ({ first }: Lists, one: Data, two: Data) => ({
        [first]: [...(one[first] as Item[]), ...(two[first] as Item[])],
      }),
      c: ({ first, second }: Lists, one: Data) => ({ [second]: one[first] }),
      d: ({ first, second }: Lists, one: Data) => ({
        [second]: [...(one[second] as Item[]), ...(one[first] as Item[])],
      }),
      e: ({ first, second }: Lists, one: Data) => ({
        [first]: [(one[first] as Item[])[1]],
        [second]: [...(one[second] as Item[]), (one[first] as Item[])[0]],
      }),
    } as const;
    type Row = keyof typeof rows;
    const shown = (data: Data) =>
      Object.fromEntries(
        ['h1', 'h2', 'o1', 'o2'].map((key) => [
          key,
          (data[key] as Array<{ label: string; note?: string | null }>).map((item) =>
            item.note ? `${item.label}/${item.note}` : item.label,
          ),
        ]),
      );
    /** One row by one caller: the answer (status, refusals) and what the admin then reads. */
    const run = async (caller: Caller, row: Row, lists: Lists, notes: readonly string[]) => {
      const one = await create('x', notes);
      const two = await create('y', ['yna', 'ynb', 'ync']);
      const read = async (id: string) =>
        expectStatus(await request('GET', `/api/content/r13cps/${id}`, tokenOf(caller)), 200).json<{
          data: Data;
        }>().data;
      const body = rows[row](lists, await read(one), await read(two));
      const before = await footprint(one);
      const response = await request('PUT', `/api/content/r13cps/${one}`, tokenOf(caller), {
        expectedVersion: (await adminView('r13cp', one)).version,
        data: body,
      });
      const issues = response.statusCode === 200 ? [] : issuesOf(response.body);
      if (response.statusCode !== 200) {
        expect(await footprint(one)).toEqual(before);
      }
      return { status: response.statusCode, issues, stored: shown((await adminView('r13cp', one)).data) };
    };
    const hidden: Lists = { first: 'h1', second: 'h2' };
    const notes = ['xna', 'xnb', 'xnc'];
    const untouched = { o1: ['xa', 'xb'], o2: ['xc'] };
    const expected: Record<Row, Data | Issue[]> = {
      a: [0, 1].map((index) => ({ path: `/h1/${index}/id`, code: 'UNKNOWN_ITEM_ID', message: NOT_HERE })),
      b: { h1: ['xa/xna', 'xb/xnb', 'ya', 'yb'], h2: ['xc/xnc'], ...untouched },
      c: [0, 1].map((index) => ({ path: `/h2/${index}/id`, code: 'UNKNOWN_ITEM_ID', message: NOT_HERE })),
      d: { h1: ['xa/xna', 'xb/xnb'], h2: ['xc/xnc', 'xa', 'xb'], ...untouched },
      e: { h1: ['xb/xnb'], h2: ['xc/xnc', 'xa'], ...untouched },
    };

    it.each(callers.flatMap((caller) => (Object.keys(rows) as Row[]).map((row) => [caller, row] as const)))(
      '%s, row %s, on lists with private values',
      async (caller, row) => {
        const result = await run(caller, row, hidden, notes);
        const want = expected[row];
        if (Array.isArray(want)) {
          expect(result.status).toBe(422);
          expect(result.issues).toEqual(want);
        } else {
          expect(result.status, JSON.stringify(result.issues)).toBe(200);
          expect(result.stored).toEqual(want);
        }
        // Twins that differ only in private values answer the same.
        const twin = await run(caller, row, hidden, ['other', 'values', 'here']);
        expect({ status: twin.status, issues: twin.issues }).toEqual({
          status: result.status,
          issues: result.issues,
        });
      },
    );

    it.each(callers.flatMap((caller) => (Object.keys(rows) as Row[]).map((row) => [caller, row] as const)))(
      '%s, row %s, on lists with nothing hidden: accepted',
      async (caller, row) => {
        const result = await run(caller, row, { first: 'o1', second: 'o2' }, notes);
        expect(result.status, JSON.stringify(result.issues)).toBe(200);
        const want = {
          a: { o1: ['ya', 'yb'], o2: ['xc'] },
          b: { o1: ['xa', 'xb', 'ya', 'yb'], o2: ['xc'] },
          c: { o1: ['xa', 'xb'], o2: ['xa', 'xb'] },
          d: { o1: ['xa', 'xb'], o2: ['xc', 'xa', 'xb'] },
          e: { o1: ['xb'], o2: ['xc', 'xa'] },
        }[row];
        expect(result.stored).toEqual({ h1: ['xa/xna', 'xb/xnb'], h2: ['xc/xnc'], ...want });
      },
    );
  });
});
