import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
    '%s (version %s, legacy %s): an ID no head the caller may read shows is still unknown',
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
      expect(response.statusCode, response.body).toBe(422);
      const issues = response.json<{
        error: { details: { issues: Array<{ path: string; code: string }> } };
      }>().error.details.issues;
      expect(issues.map((issue) => [issue.path, issue.code])).toEqual([['/plains/1/id', 'UNKNOWN_ITEM_ID']]);
      expect(await footprint(id)).toEqual(before);
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
});
