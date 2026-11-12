import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type Data = Record<string, unknown>;

/** Without item IDs (`__id` in storage), at any depth: what an entry saved by 0.8.2 holds. */
const withoutStoredIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutStoredIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([key, item]) => [key, withoutStoredIds(item)]),
        )
      : value;

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

/** A list as read without its IDs, one item replaced (an admin save without IDs). */
const replaceAt = (items: unknown, index: number, item: Item): Item[] =>
  (withoutIds(items) as Item[]).map((current, at) => (at === index ? item : current));

const SYSTEM = new Set(['id', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'status', 'version']);

/**
 * The ninth review (plan item-ids): a delivery client reads the published entry while its draft is ahead, and
 * sends back what it read. The IDs that read gave it are never unknown to it.
 */
describe('item writes: ninth review, IDs a published read gave while the draft is ahead', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let alice: AppSessionBody;
  let v0: string;

  const request = (method: 'GET' | 'PUT', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const heads = (id: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
  /** Every head of an entry as 0.8.2 stored it: no item IDs. */
  const makeLegacy = async (id: string) => {
    for (const head of await heads(id)) {
      await database.current.db
        .updateTable('entry_heads')
        .set({ data: withoutStoredIds(head.data) as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state as never)
        .execute();
    }
  };
  const footprint = async (id: string) => {
    const view = expectStatus(await admin.get(`/api/admin/content/p9page/${id}`), 200).json<EntryBody>();
    const revisions = await database.current.db
      .selectFrom('content_revisions')
      .select('id')
      .where('entry_id', '=', id)
      .execute();
    return { version: view.version, revisions: revisions.length, data: view.data };
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const plain = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'p9_plain',
        label: 'P9 plain',
        fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
      },
      'components',
    );
    const secret = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'p9_secret',
        label: 'P9 secret',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string', public: false },
        ],
      },
      'components',
    );
    const box = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'p9_box',
        label: 'P9 box',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          {
            apiKey: 'plains',
            label: 'Plains',
            type: 'component',
            settings: { component: plain.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const list = (component: ModelBody) => ({
      type: 'component',
      settings: { component: component.definition.id, repeatable: true },
    });
    const page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'p9page',
      label: 'P9 page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'plains', label: 'Plains', ...list(plain) },
        { apiKey: 'secrets', label: 'Secrets', ...list(secret) },
        { apiKey: 'boxes', label: 'Boxes', ...list(box) },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: box.definition.id } },
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
              { action: 'update', modelId: page.definition.id },
            ]),
          ],
        },
      }),
      200,
    );
    v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // A field added since v0, so a write through v0 goes through a version that differs from today's.
    const current = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    expect(
      (
        await admin.put(`/api/admin/models/${page.definition.id}`, {
          definition: {
            ...current.definition,
            fields: [...current.definition.fields, { apiKey: 'extra', label: 'Extra', type: 'string' }],
          },
          expectedVersion: current.version,
        })
      ).statusCode,
    ).toBeLessThan(300);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  /** A published entry whose draft the admin then edits (`edit`), stored as 0.8.2 stored it when `legacy`. */
  const draftAhead = async (data: Data, edit: (draft: Data) => Data, legacy: boolean) => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/p9page', { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/p9page/${entry.id}/publish`, {}), 200);
    const draft = expectStatus(
      await admin.get(`/api/admin/content/p9page/${entry.id}`),
      200,
    ).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/p9page/${entry.id}`, {
        expectedVersion: draft.version,
        data: edit(draft.data),
      }),
      200,
    );
    if (legacy) {
      await makeLegacy(entry.id);
    }
    return entry.id;
  };
  /** The published read (the delivery default) of a caller, as a body to send back. */
  const publishedRead = async (id: string, token: string, version: boolean) => {
    const at = `/api/content/p9pages/${id}${version ? `?schemaVersion=${encodeURIComponent(v0)}` : ''}`;
    const read = expectStatus(await request('GET', at, token), 200).json<{ data: Data }>().data;
    return {
      at,
      body: Object.fromEntries(
        Object.entries(read).filter(([key]) => !SYSTEM.has(key) && !key.startsWith('__')),
      ),
    };
  };
  const tokenOf = (caller: 'adminToken' | 'appUser') =>
    caller === 'adminToken' ? adminToken : alice.accessToken;
  const headings = (items: unknown) => (items as Item[]).map((item) => item.heading);

  const cases = (['adminToken', 'appUser'] as const).flatMap((caller) =>
    [false, true].flatMap((version) => [false, true].map((legacy) => [caller, version, legacy] as const)),
  );

  it.each(cases)(
    '%s (version %s, legacy %s): a list edited in the draft, a published read sent back with the title changed',
    async (caller, version, legacy) => {
      // On 0.9.0 entries the admin saves without IDs: the edited item gets a new ID in the draft only.
      const id = await draftAhead(
        { title: 't', plains: [{ heading: 'a' }, { heading: 'b' }] },
        (draft) => ({
          plains: replaceAt(draft.plains, 1, { heading: 'b2' }),
        }),
        legacy,
      );
      const { at, body } = await publishedRead(id, tokenOf(caller), version);
      const before = await footprint(id);
      const response = await request('PUT', at, tokenOf(caller), {
        expectedVersion: before.version,
        data: { ...body, title: 't-new' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const after = await footprint(id);
      // As on main: one revision, the list replaced by what was sent.
      expect(after.revisions).toBe(before.revisions + 1);
      expect(after.data.title).toBe('t-new');
      expect(headings(after.data.plains)).toEqual(['a', 'b']);
      const ids = (after.data.plains as Item[]).map((item) => item.id);
      expect(new Set(ids).size).toBe(2);
    },
  );

  it.each(cases)(
    '%s (version %s, legacy %s): a nested list edited in the draft, under an item of a list',
    async (caller, version, legacy) => {
      const id = await draftAhead(
        { title: 't', boxes: [{ label: 'L', plains: [{ heading: 'n1' }, { heading: 'n2' }] }] },
        (draft) => ({
          boxes: (draft.boxes as Item[]).map((box) => ({
            ...box,
            plains: replaceAt(box.plains, 1, { heading: 'n2b' }),
          })),
        }),
        legacy,
      );
      const { at, body } = await publishedRead(id, tokenOf(caller), version);
      const before = await footprint(id);
      const response = await request('PUT', at, tokenOf(caller), {
        expectedVersion: before.version,
        data: { ...body, title: 't-new' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const after = await footprint(id);
      expect(after.revisions).toBe(before.revisions + 1);
      expect(headings((after.data.boxes as Item[])[0]?.plains)).toEqual(['n1', 'n2']);
    },
  );

  it.each(cases)(
    '%s (version %s, legacy %s): a single component whose nested list is edited in the draft',
    async (caller, version, legacy) => {
      const id = await draftAhead(
        { title: 't', hero: { label: 'H', plains: [{ heading: 'h1' }, { heading: 'h2' }] } },
        (draft) => {
          const hero = draft.hero as Item;
          return {
            hero: {
              ...hero,
              label: 'H2',
              plains: replaceAt(hero.plains, 1, { heading: 'h2b' }),
            },
          };
        },
        legacy,
      );
      const { at, body } = await publishedRead(id, tokenOf(caller), version);
      const before = await footprint(id);
      const response = await request('PUT', at, tokenOf(caller), {
        expectedVersion: before.version,
        data: { ...body, title: 't-new' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const after = await footprint(id);
      expect(after.revisions).toBe(before.revisions + 1);
      expect((after.data.hero as Item).label).toBe('H');
      expect(headings((after.data.hero as Item).plains)).toEqual(['h1', 'h2']);
    },
  );

  it.each([false, true].flatMap((version) => [false, true].map((legacy) => [version, legacy] as const)))(
    'a list that holds values the app user cannot see (version %s, legacy %s): refused, saying why, nothing written',
    async (version, legacy) => {
      const id = await draftAhead(
        {
          title: 't',
          secrets: [
            { heading: 'a', note: 'na' },
            { heading: 'b', note: 'nb' },
          ],
        },
        (draft) => ({
          secrets: (draft.secrets as Item[]).map((item, index) =>
            index === 1 ? { heading: 'b2', note: 'nb2' } : item,
          ),
        }),
        legacy,
      );
      const { at, body } = await publishedRead(id, alice.accessToken, version);
      const before = await footprint(id);
      const response = await request('PUT', at, alice.accessToken, {
        expectedVersion: before.version,
        data: { ...body, title: 't-new' },
      });
      expect(response.statusCode, response.body).toBe(422);
      const issues = response.json<{
        error: { details: { issues: Array<{ path: string; code: string; message: string }> } };
      }>().error.details.issues;
      expect(issues.map((issue) => [issue.path, issue.code])).toEqual([['/secrets', 'AMBIGUOUS_ITEMS']]);
      expect(issues[0]?.message).toMatch(
        /^replaces items this caller cannot read \(the entry has unpublished changes/,
      );
      expect(await footprint(id)).toEqual(before);
    },
  );

  it.each([false, true].flatMap((version) => [false, true].map((legacy) => [version, legacy] as const)))(
    'the same list sent by a caller that may read drafts (version %s, legacy %s): accepted, as on main',
    async (version, legacy) => {
      const id = await draftAhead(
        {
          title: 't',
          secrets: [
            { heading: 'a', note: 'na' },
            { heading: 'b', note: 'nb' },
          ],
        },
        (draft) => ({
          secrets: (draft.secrets as Item[]).map((item, index) =>
            index === 1 ? { heading: 'b2', note: 'nb2' } : item,
          ),
        }),
        legacy,
      );
      const { at, body } = await publishedRead(id, adminToken, version);
      const before = await footprint(id);
      const response = await request('PUT', at, adminToken, {
        expectedVersion: before.version,
        data: { ...body, title: 't-new' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const after = await footprint(id);
      expect(after.revisions).toBe(before.revisions + 1);
      expect(headings(after.data.secrets)).toEqual(['a', 'b']);
    },
  );

  it.each(cases)(
    '%s (version %s, legacy %s): an ID no head shows, in a list with nothing hidden: a new item, as on main',
    async (caller, version, legacy) => {
      const id = await draftAhead(
        { title: 't', plains: [{ heading: 'a' }, { heading: 'b' }] },
        (draft) => ({
          plains: replaceAt(draft.plains, 1, { heading: 'b2' }),
        }),
        legacy,
      );
      const { at, body } = await publishedRead(id, tokenOf(caller), version);
      const before = await footprint(id);
      const plains = (body.plains as Item[]).map((item, index) =>
        index === 1 ? { ...item, id: 'ZZZZZZZZZZZZ' } : item,
      );
      const response = await request('PUT', at, tokenOf(caller), {
        expectedVersion: before.version,
        data: { ...body, plains },
      });
      // Nothing in the list is hidden from either caller (the app user cannot see the draft, which is ahead):
      // nothing can be lost, so the item is new.
      expect(response.statusCode, response.body).toBe(200);
      const after = await footprint(id);
      expect(headings(after.data.plains)).toEqual(['a', 'b']);
      expect((after.data.plains as Item[]).map((item) => item.id)).not.toContain('ZZZZZZZZZZZZ');
    },
  );

  it.each([false, true])('a GraphQL mutation sending back a published read (legacy %s)', async (legacy) => {
    const id = await draftAhead(
      { title: 't', plains: [{ heading: 'a' }, { heading: 'b' }] },
      (draft) => ({
        plains: replaceAt(draft.plains, 1, { heading: 'b2' }),
      }),
      legacy,
    );
    const { body } = await publishedRead(id, adminToken, false);
    const before = await footprint(id);
    const result = await graphql(
      testApp.app,
      'mutation ($id: ID!, $v: Int, $d: P9pageInput) { updateP9page(id: $id, expectedVersion: $v, data: $d) { id } }',
      {
        headers: bearer(adminToken),
        variables: { id, v: before.version, d: { title: 't-new', plains: body.plains } },
      },
    );
    expect(result.body.errors, JSON.stringify(result.body)).toBeUndefined();
    const after = await footprint(id);
    expect(after.revisions).toBe(before.revisions + 1);
    expect(headings(after.data.plains)).toEqual(['a', 'b']);
  });

  describe('tenth review: items copied from another locale, by a caller that sees the draft', () => {
    let v1: string;
    let bob: AppSessionBody;
    beforeAll(async () => {
      const locale = await admin.post('/api/admin/locales', { code: 'de', label: 'German' });
      expect([201, 409]).toContain(locale.statusCode);
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'p10_card',
          label: 'P10 card',
          fields: [
            { apiKey: 'heading', label: 'Heading', type: 'string' },
            { apiKey: 'note', label: 'Note', type: 'string', public: false },
          ],
        },
        'components',
      );
      const lpage = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'p10page',
        label: 'P10 page',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          {
            apiKey: 'lcards',
            label: 'LCards',
            localized: true,
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
          },
          {
            apiKey: 'lhero',
            label: 'LHero',
            localized: true,
            type: 'component',
            settings: { component: card.definition.id },
          },
        ],
      });
      bob = await signUp(testApp.app);
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${bob.user.id}`,
          payload: {
            roleIds: [
              await createAppRole(database.current.db, [
                { action: 'read', modelId: lpage.definition.id },
                { action: 'update', modelId: lpage.definition.id },
              ]),
            ],
          },
        }),
        200,
      );
      v1 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
        schemaVersionToken: string;
      }>().schemaVersionToken;
      const current = (await admin.get(`/api/admin/models/${lpage.definition.id}`)).json<ModelBody>();
      expect(
        (
          await admin.put(`/api/admin/models/${lpage.definition.id}`, {
            definition: {
              ...current.definition,
              fields: [...current.definition.fields, { apiKey: 'extra', label: 'Extra', type: 'string' }],
            },
            expectedVersion: current.version,
          })
        ).statusCode,
      ).toBeLessThan(300);
    });
    /** Published in `en` and `de`, draft equal to published in both. */
    const entry = async () => {
      const created = expectStatus(
        await admin.post('/api/admin/content/p10page?locale=en', {
          locale: 'en',
          data: {
            title: 'en',
            lcards: [
              { heading: 'c1', note: 'n1' },
              { heading: 'c2', note: 'n2' },
            ],
            lhero: { heading: 'h', note: 'hn' },
          },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/p10page/${created.id}?locale=de`, {
          locale: 'de',
          expectedVersion: null,
          data: {
            title: 'de',
            lcards: [
              { heading: 'd1', note: 'dn1' },
              { heading: 'd2', note: 'dn2' },
            ],
            lhero: { heading: 'dh', note: 'dhn' },
          },
        }),
        200,
      );
      expectStatus(
        await admin.post(`/api/admin/content/p10page/${created.id}/publish`, { locales: ['en', 'de'] }),
        200,
      );
      return created.id;
    };
    const at = (id: string, locale: string, version: boolean) =>
      `/api/content/p10pages/${id}?locale=${locale}${version ? `&schemaVersion=${encodeURIComponent(v1)}` : ''}`;
    const readOf = async (id: string, locale: string, token: string, version: boolean) =>
      expectStatus(await request('GET', at(id, locale, version), token), 200).json<{ data: Data }>().data;
    const draftOf = async (id: string, locale: string) =>
      expectStatus(
        await admin.get(`/api/admin/content/p10page/${id}?locale=${locale}`),
        200,
      ).json<EntryBody>();
    type Row = (en: Data, de: Data) => { locale: string; data: Data; expected: string[] | string };
    const rows: Array<[string, Row]> = [
      [
        'en items with their ids appended to de',
        (en, de) => ({
          locale: 'de',
          data: { lcards: [...(de.lcards as Item[]), ...(en.lcards as Item[])] },
          expected: ['d1', 'd2', 'c1', 'c2'],
        }),
      ],
      [
        'en items without ids appended to de',
        (en, de) => ({
          locale: 'de',
          data: { lcards: [...(de.lcards as Item[]), ...(withoutIds(en.lcards) as Item[])] },
          expected: ['d1', 'd2', 'c1', 'c2'],
        }),
      ],
      [
        'both without ids',
        (en, de) => ({
          locale: 'de',
          data: { lcards: withoutIds([...(de.lcards as Item[]), ...(en.lcards as Item[])]) },
          expected: ['d1', 'd2', 'c1', 'c2'],
        }),
      ],
      [
        'en replaced by de items with their ids',
        (_en, de) => ({ locale: 'en', data: { lcards: de.lcards }, expected: ['d1', 'd2'] }),
      ],
      [
        'en replaced by de items sent as new',
        (_en, de) => ({
          locale: 'en',
          data: { lcards: (withoutIds(de.lcards) as Item[]).map((item) => ({ ...item, id: null })) },
          expected: ['d1', 'd2'],
        }),
      ],
      [
        'the en single component sent to de with its id',
        (en) => ({ locale: 'de', data: { lhero: en.lhero }, expected: 'h' }),
      ],
    ];
    it.each(
      (['adminToken', 'appUser'] as const).flatMap((caller) =>
        [false, true].flatMap((version) => rows.map(([name, row]) => [caller, version, name, row] as const)),
      ),
    )('%s (version %s): %s: accepted, as on main', async (caller, version, _name, row) => {
      const token = caller === 'adminToken' ? adminToken : bob.accessToken;
      const id = await entry();
      const en = await readOf(id, 'en', token, version);
      const de = await readOf(id, 'de', token, version);
      const { locale, data, expected } = row(en, de);
      const before = await draftOf(id, locale);
      const response = await request('PUT', at(id, locale, version), token, {
        locale,
        expectedVersion: before.version,
        data,
      });
      expect(response.statusCode, response.body).toBe(200);
      const after = await draftOf(id, locale);
      expect(after.version).toBe(before.version + 1);
      if (Array.isArray(expected)) {
        const items = after.data.lcards as Item[];
        expect(headings(items)).toEqual(expected);
        expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      } else {
        expect((after.data.lhero as Item).heading).toBe(expected);
      }
    });

    describe('eleventh review: the admin API', () => {
      let sessionHeaders: Record<string, string>;
      beforeAll(async () => {
        sessionHeaders = (await login(testApp.app, await createAdmin(database.current.db))).headers;
      });
      const adminRequest = (
        caller: 'session' | 'token',
        method: 'GET' | 'PUT',
        url: string,
        payload?: unknown,
      ) =>
        testApp.app.inject({
          method,
          url,
          headers: caller === 'session' ? sessionHeaders : bearer(adminToken),
          ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        });
      const adminRead = async (caller: 'session' | 'token', id: string, locale: string) =>
        expectStatus(
          await adminRequest(caller, 'GET', `/api/admin/content/p10page/${id}?locale=${locale}`),
          200,
        ).json<EntryBody>();
      type AdminRow = (en: Data, de: Data) => { locale: string; data: Data; expected: string[] | string };
      const adminRows: Array<[string, boolean, AdminRow]> = [
        [
          'en items with their ids appended to de',
          false,
          (en, de) => ({
            locale: 'de',
            data: { lcards: [...(de.lcards as Item[]), ...(en.lcards as Item[])] },
            expected: ['d1', 'd2', 'c1', 'c2'],
          }),
        ],
        [
          'en items with their ids appended to de, its draft ahead',
          true,
          (en, de) => ({
            locale: 'de',
            data: { lcards: [...(de.lcards as Item[]), ...(en.lcards as Item[])] },
            expected: ['d1x', 'd2', 'c1', 'c2'],
          }),
        ],
        [
          'en replaced by de items with their ids',
          false,
          (_en, de) => ({ locale: 'en', data: { lcards: de.lcards }, expected: ['d1', 'd2'] }),
        ],
        [
          'en replaced by de items with their ids, de ahead',
          true,
          (_en, de) => ({ locale: 'en', data: { lcards: de.lcards }, expected: ['d1x', 'd2'] }),
        ],
        [
          'the en single component sent to de with its id',
          false,
          (en) => ({ locale: 'de', data: { lhero: en.lhero }, expected: 'h' }),
        ],
      ];
      it.each(
        (['session', 'token'] as const).flatMap((caller) =>
          adminRows.map(([name, ahead, row]) => [caller, name, ahead, row] as const),
        ),
      )('%s: %s: accepted, as on main', async (caller, _name, ahead, row) => {
        const id = await entry();
        if (ahead) {
          const de = await adminRead(caller, id, 'de');
          const lcards = (de.data.lcards as Item[]).map((item, index) =>
            index === 0 ? { ...item, heading: 'd1x' } : item,
          );
          expectStatus(
            await adminRequest(caller, 'PUT', `/api/admin/content/p10page/${id}?locale=de`, {
              locale: 'de',
              expectedVersion: de.version,
              data: { lcards },
            }),
            200,
          );
        }
        const en = (await adminRead(caller, id, 'en')).data;
        const de = (await adminRead(caller, id, 'de')).data;
        const { locale, data, expected } = row(en, de);
        const before = await adminRead(caller, id, locale);
        const response = await adminRequest(
          caller,
          'PUT',
          `/api/admin/content/p10page/${id}?locale=${locale}`,
          {
            locale,
            expectedVersion: before.version,
            data,
          },
        );
        expect(response.statusCode, response.body).toBe(200);
        const after = await adminRead(caller, id, locale);
        expect(after.version).toBe(before.version + 1);
        if (Array.isArray(expected)) {
          const items = after.data.lcards as Item[];
          expect(headings(items)).toEqual(expected);
          expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
        } else {
          expect((after.data.lhero as Item).heading).toBe(expected);
        }
      });

      it.each(['session', 'token', 'delivery'] as const)(
        '%s: the same copy of de items sent to en twice: the second changes nothing',
        async (caller) => {
          const id = await entry();
          const copy = async () => {
            const de =
              caller === 'delivery'
                ? await readOf(id, 'de', adminToken, false)
                : (await adminRead(caller, id, 'de')).data;
            const before = await adminRead('token', id, 'en');
            const body = { locale: 'en', expectedVersion: before.version, data: { lcards: de.lcards } };
            const response =
              caller === 'delivery'
                ? await request('PUT', at(id, 'en', false), adminToken, body)
                : await adminRequest(caller, 'PUT', `/api/admin/content/p10page/${id}?locale=en`, body);
            expect(response.statusCode, response.body).toBe(200);
            return { before, after: await adminRead('token', id, 'en') };
          };
          const first = await copy();
          expect(first.after.version).toBe(first.before.version + 1);
          const second = await copy();
          expect(second.after.version).toBe(second.before.version);
          expect(second.after.data.lcards).toEqual(first.after.data.lcards);
        },
      );

      it.each(['session', 'token'] as const)(
        '%s: an ID no head of the entry shows is a new item; a malformed one is unknown',
        async (caller) => {
          const id = await entry();
          const first = await adminRead(caller, id, 'de');
          const stale = (first.data.lcards as Item[]).map((item, index) =>
            index === 0 ? { ...item, id: 'ZZZZZZZZZZZZ', heading: 'd1-new' } : item,
          );
          expectStatus(
            await adminRequest(caller, 'PUT', `/api/admin/content/p10page/${id}?locale=de`, {
              locale: 'de',
              expectedVersion: first.version,
              data: { lcards: stale },
            }),
            200,
          );
          const before = await adminRead(caller, id, 'de');
          expect(headings(before.data.lcards)).toEqual(['d1-new', 'd2']);
          expect((before.data.lcards as Item[]).map((item) => item.id)).not.toContain('ZZZZZZZZZZZZ');
          const lcards = (before.data.lcards as Item[]).map((item, index) =>
            index === 0 ? { ...item, id: 'not-an-id' } : item,
          );
          const response = await adminRequest(caller, 'PUT', `/api/admin/content/p10page/${id}?locale=de`, {
            locale: 'de',
            expectedVersion: before.version,
            data: { lcards },
          });
          expect(response.statusCode, response.body).toBe(422);
          const issues = response.json<{
            error: { details: { issues: Array<{ path: string; code: string }> } };
          }>().error.details.issues;
          expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
            ['/lcards/0/id', 'UNKNOWN_ITEM_ID'],
          ]);
          expect((await adminRead(caller, id, 'de')).version).toBe(before.version);
        },
      );
    });
  });

  describe('eleventh review: a stale read sent back, and look-alikes reordered in a shared list', () => {
    let bob: AppSessionBody;
    let carol: AppSessionBody;
    let v2: string;
    beforeAll(async () => {
      const item = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'st_item',
          label: 'St item',
          fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
        },
        'components',
      );
      const secret = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'st_secret',
          label: 'St secret',
          fields: [
            { apiKey: 'label', label: 'Label', type: 'string' },
            { apiKey: 'note', label: 'Note', type: 'string', public: false },
          ],
        },
        'components',
      );
      const list = (component: ModelBody) => ({
        type: 'component',
        settings: { component: component.definition.id, repeatable: true },
      });
      const models = [];
      for (const [apiKey, draftAndPublish] of [
        ['stnp', true],
        ['stnd', false],
      ] as const) {
        models.push(
          await createDefinition(admin, {
            kind: 'collection',
            apiKey,
            label: apiKey,
            draftAndPublish,
            fields: [
              { apiKey: 'title', label: 'Title', type: 'string' },
              { apiKey: 'items', label: 'Items', ...list(item) },
              { apiKey: 'secrets', label: 'Secrets', ...list(secret) },
            ],
          }),
        );
      }
      const grants = models.flatMap((model) => [
        { action: 'read' as const, modelId: model.definition.id },
        { action: 'update' as const, modelId: model.definition.id },
      ]);
      bob = await user(grants);
      carol = await user(grants);
      v2 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
        schemaVersionToken: string;
      }>().schemaVersionToken;
      for (const model of models) {
        const current = (await admin.get(`/api/admin/models/${model.definition.id}`)).json<ModelBody>();
        expect(
          (
            await admin.put(`/api/admin/models/${model.definition.id}`, {
              definition: {
                ...current.definition,
                fields: [...current.definition.fields, { apiKey: 'extra', label: 'Extra', type: 'string' }],
              },
              expectedVersion: current.version,
            })
          ).statusCode,
        ).toBeLessThan(300);
      }
    });
    const user = async (grants: Array<{ action: 'read' | 'update'; modelId: string }>) => {
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
    type Other = 'adminApiNoIds' | 'deleteItem' | 'otherClientNoIds';
    /** An entry with [A, B] in `field`, read by `read`, then changed by someone else, on every head. */
    const staleRead = async (
      model: 'stnp' | 'stnd',
      field: 'items' | 'secrets',
      other: Other,
      read: (id: string) => Promise<Data>,
    ) => {
      const values =
        field === 'items'
          ? [{ label: 'A' }, { label: 'B' }]
          : [
              { label: 'A', note: 'nA' },
              { label: 'B', note: 'nB' },
            ];
      const created = expectStatus(
        await admin.post(`/api/admin/content/${model}`, { data: { title: 't', [field]: values } }),
        201,
      ).json<EntryBody>();
      const publish = async () => {
        if (model === 'stnp') {
          expectStatus(await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {}), 200);
        }
      };
      await publish();
      const first = expectStatus(
        await admin.get(`/api/admin/content/${model}/${created.id}`),
        200,
      ).json<EntryBody>();
      const data = await read(created.id);
      const items = first.data[field] as Item[];
      if (other === 'adminApiNoIds') {
        const edited = (withoutIds(items) as Item[]).map((value, index) =>
          index === 0 ? { ...value, label: 'A-admin' } : value,
        );
        expectStatus(
          await admin.put(`/api/admin/content/${model}/${created.id}`, {
            expectedVersion: first.version,
            data: { [field]: edited },
          }),
          200,
        );
      } else if (other === 'deleteItem') {
        expectStatus(
          await admin.put(`/api/admin/content/${model}/${created.id}`, {
            expectedVersion: first.version,
            data: { [field]: [items[0]] },
          }),
          200,
        );
      } else {
        expectStatus(
          await request('PUT', `/api/content/${model}s/${created.id}`, carol.accessToken, {
            expectedVersion: first.version,
            data: { [field]: [{ label: 'A' }, { label: 'B-carol' }] },
          }),
          200,
        );
      }
      await publish();
      return { id: created.id, data, known: first.version };
    };
    const adminView = async (model: string, id: string) =>
      expectStatus(await admin.get(`/api/admin/content/${model}/${id}`), 200).json<EntryBody>();
    const labels = (value: unknown) => (value as Item[]).map((item) => item.label);
    const others: Other[] = ['adminApiNoIds', 'deleteItem', 'otherClientNoIds'];
    const models = ['stnp', 'stnd'] as const;

    it.each(
      models.flatMap((model) =>
        others.flatMap((other) =>
          (['rest', 'version', 'admin'] as const).map((via) => [model, other, via] as const),
        ),
      ),
    )(
      '%s, changed by %s, a read sent back %s: 409, then the retry wins, as on main',
      async (model, other, via) => {
        const route = (id: string) =>
          via === 'admin'
            ? `/api/admin/content/${model}/${id}`
            : `/api/content/${model}s/${id}${via === 'version' ? `?schemaVersion=${encodeURIComponent(v2)}` : ''}`;
        const token = via === 'admin' ? adminToken : bob.accessToken;
        const { id, data, known } = await staleRead(model, 'items', other, async (entryId) =>
          via === 'admin'
            ? (await adminView(model, entryId)).data
            : expectStatus(await request('GET', route(entryId), token), 200).json<{ data: Data }>().data,
        );
        const body = { title: `${String(data.title)}!`, items: data.items };
        const first = await request('PUT', route(id), token, { expectedVersion: known, data: body });
        expect(first.statusCode, first.body).toBe(409);
        const currentVersion = first.json<{ error: { details: { currentVersion: number } } }>().error.details
          .currentVersion;
        const retry = await request('PUT', route(id), token, { expectedVersion: currentVersion, data: body });
        expect(retry.statusCode, retry.body).toBe(200);
        const after = await adminView(model, id);
        expect(labels(after.data.items)).toEqual(['A', 'B']);
        expect(new Set((after.data.items as Item[]).map((item) => item.id)).size).toBe(2);
      },
    );

    it.each(models.flatMap((model) => others.map((other) => [model, other] as const)))(
      '%s, changed by %s, a read sent back over GraphQL with the current version: accepted',
      async (model, other) => {
        const { id, data } = await staleRead(
          model,
          'items',
          other,
          async (entryId) =>
            expectStatus(
              await request('GET', `/api/content/${model}s/${entryId}`, bob.accessToken),
              200,
            ).json<{
              data: Data;
            }>().data,
        );
        const typeName = model === 'stnp' ? 'Stnp' : 'Stnd';
        const result = await graphql(
          testApp.app,
          `mutation ($id: ID!, $v: Int, $d: ${typeName}Input) { update${typeName}(id: $id, expectedVersion: $v, data: $d) { id } }`,
          {
            headers: bearer(bob.accessToken),
            variables: { id, v: (await adminView(model, id)).version, d: { title: 't!', items: data.items } },
          },
        );
        expect(result.body.errors, JSON.stringify(result.body)).toBeUndefined();
        expect(labels((await adminView(model, id)).data.items)).toEqual(['A', 'B']);
      },
    );

    it.each(
      models.flatMap((model) =>
        (['adminApiNoIds', 'deleteItem'] as const).flatMap((other) =>
          [false, true].map((version) => [model, other, version] as const),
        ),
      ),
    )(
      '%s, changed by %s, a list with private values sent back stale (version %s): unknown, nothing written',
      async (model, other, version) => {
        const route = (id: string) =>
          `/api/content/${model}s/${id}${version ? `?schemaVersion=${encodeURIComponent(v2)}` : ''}`;
        const { id, data } = await staleRead(
          model,
          'secrets',
          other,
          async (entryId) =>
            expectStatus(await request('GET', route(entryId), bob.accessToken), 200).json<{ data: Data }>()
              .data,
        );
        const before = await adminView(model, id);
        const response = await request('PUT', route(id), bob.accessToken, {
          expectedVersion: before.version,
          data: { title: 't!', secrets: data.secrets },
        });
        expect(response.statusCode, response.body).toBe(422);
        const codes = response
          .json<{ error: { details: { issues: Array<{ code: string }> } } }>()
          .error.details.issues.map((issue) => issue.code);
        expect(codes.length).toBeGreaterThan(0);
        expect(codes.every((code) => code === 'UNKNOWN_ITEM_ID')).toBe(true);
        expect(await adminView(model, id)).toEqual(before);
      },
    );

    it.each(models)(
      '%s: an app user swapping look-alikes by their ids: a change whether or not their private values differ',
      async (model) => {
        const outcomes: Array<{ status: number; keys: string[]; bumped: boolean }> = [];
        for (const notes of [
          ['same', 'same'],
          ['one', 'other'],
        ]) {
          const created = expectStatus(
            await admin.post(`/api/admin/content/${model}`, {
              data: { title: 't', secrets: notes.map((note) => ({ label: 'A', note })) },
            }),
            201,
          ).json<EntryBody>();
          if (model === 'stnp') {
            expectStatus(await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {}), 200);
          }
          const read = expectStatus(
            await request('GET', `/api/content/${model}s/${created.id}`, bob.accessToken),
            200,
          ).json<{ data: Data }>().data;
          const before = await adminView(model, created.id);
          const response = await request('PUT', `/api/content/${model}s/${created.id}`, bob.accessToken, {
            expectedVersion: before.version,
            data: { secrets: [...(read.secrets as Item[])].reverse() },
          });
          const body = response.json<{ data: Data }>();
          outcomes.push({
            status: response.statusCode,
            keys: Object.keys(body.data ?? {}).sort(),
            bumped: (await adminView(model, created.id)).version === before.version + 1,
          });
        }
        expect(outcomes[0]).toEqual(outcomes[1]);
        expect(outcomes[0]).toMatchObject({ status: 200, bumped: true });
      },
    );

    it('identical items of a shared list reordered in one locale leave the other locale as it was', async () => {
      const card = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'ro_card',
          label: 'Ro card',
          fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
        },
        'components',
      );
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'rodoc',
        label: 'Ro doc',
        localized: true,
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', localized: true },
          {
            apiKey: 'sl',
            label: 'SL',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
          },
        ],
      });
      const locale = await admin.post('/api/admin/locales', { code: 'fr', label: 'French' });
      expect([201, 409]).toContain(locale.statusCode);
      const created = expectStatus(
        await admin.post('/api/admin/content/rodoc?locale=en', {
          locale: 'en',
          data: { title: 'en', sl: [{ heading: 's1' }, { heading: 's2' }, { heading: 's1' }] },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/rodoc/${created.id}?locale=fr`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr' },
        }),
        200,
      );
      expectStatus(
        await admin.post(`/api/admin/content/rodoc/${created.id}/publish`, { locales: ['en', 'fr'] }),
        200,
      );
      const view = async (code: string) =>
        expectStatus(await admin.get(`/api/admin/content/rodoc/${created.id}?locale=${code}`), 200).json<
          EntryBody & { status: string }
        >();
      const frBefore = await view('fr');
      const en = await view('en');
      expectStatus(
        await admin.put(`/api/admin/content/rodoc/${created.id}?locale=en`, {
          locale: 'en',
          expectedVersion: en.version,
          data: { sl: [...(en.data.sl as Item[])].reverse() },
        }),
        200,
      );
      const frAfter = await view('fr');
      expect(frAfter.version).toBe(frBefore.version);
      expect(frAfter.status).toBe(frBefore.status);
      expect(headings(frAfter.data.sl)).toEqual(['s1', 's2', 's1']);
      expect(new Set((frAfter.data.sl as Item[]).map((item) => item.id))).toEqual(
        new Set(((await view('en')).data.sl as Item[]).map((item) => item.id)),
      );
    });
  });
});
