import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createAppRole, setPublicGrants, signUp, type AppSessionBody } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Item = { id?: string; [key: string]: unknown };
type Data = Record<string, unknown>;

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

const SYSTEM = new Set(['id', 'locale', 'createdAt', 'updatedAt', 'publishedAt', 'status', 'version']);

/**
 * The twelfth review (plan item-ids): one answer for a sent item whose ID the draft lacks. A published read sent
 * back while the draft holds the same content under other item IDs changes nothing, and swapping look-alikes never
 * tells a caller whether relation targets it cannot see differ.
 */
describe('item writes: twelfth review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let alice: AppSessionBody;
  const models: Record<string, ModelBody> = {};

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string | null, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: token ? bearer(token) : {},
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const heads = (id: string) =>
    database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'version', 'revision_id'])
      .where('entry_id', '=', id)
      .orderBy('locale')
      .orderBy('state')
      .execute();
  const revisions = async (id: string) =>
    (
      await database.current.db
        .selectFrom('content_revisions')
        .select('id')
        .where('entry_id', '=', id)
        .execute()
    ).length;
  const events = async (id: string) =>
    (
      await database.current.db
        .selectFrom('outbox_events')
        .select('id')
        .where('aggregate_id', '=', id)
        .execute()
    ).length;
  const footprint = async (id: string) => ({
    heads: await heads(id),
    revisions: await revisions(id),
    events: await events(id),
  });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expect([201, 409]).toContain(
      (await admin.post('/api/admin/locales', { code: 'de', label: 'German' })).statusCode,
    );
    const item = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'r12_item',
        label: 'R12 item',
        fields: [{ apiKey: 'label', label: 'Label', type: 'string' }],
      },
      'components',
    );
    const box = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'r12_box',
        label: 'R12 box',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: item.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const fields = (localized: boolean) => [
      { apiKey: 'title', label: 'Title', type: 'string', ...(localized ? { localized: true } : {}) },
      {
        apiKey: 'items',
        label: 'Items',
        type: 'component',
        settings: { component: item.definition.id, repeatable: true },
      },
      { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: box.definition.id } },
    ];
    models.r12on = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r12on',
      label: 'R12 on',
      fields: fields(false),
    });
    models.r12off = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r12off',
      label: 'R12 off',
      draftAndPublish: false,
      fields: fields(false),
    });
    models.r12loc = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'r12loc',
      label: 'R12 loc',
      localized: true,
      fields: fields(true),
    });
    const grants = Object.values(models).flatMap((model) => [
      { action: 'read' as const, modelId: model.definition.id },
      { action: 'update' as const, modelId: model.definition.id },
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
  });
  afterAll(async () => {
    await setPublicGrants(database.current.db, []);
    await testApp.app.close();
  });

  const typeName = (apiKey: string) => `${apiKey.charAt(0).toUpperCase()}${apiKey.slice(1)}`;
  const adminView = async (model: string, id: string, locale = 'en') =>
    expectStatus(
      await admin.get(`/api/admin/content/${model}/${id}?locale=${locale}`),
      200,
    ).json<EntryBody>();
  const adminSave = async (model: string, id: string, data: Data, locale = 'en') => {
    const current = await admin.get(`/api/admin/content/${model}/${id}?locale=${locale}`);
    expectStatus(
      await admin.put(`/api/admin/content/${model}/${id}?locale=${locale}`, {
        locale,
        expectedVersion: current.statusCode === 200 ? current.json<EntryBody>().version : null,
        data,
      }),
      200,
    );
  };

  /**
   * A published entry whose draft then holds the same content under other item IDs: an admin save without IDs
   * edits the first item and the hero's first item, a second puts them back (each a new item each time).
   */
  const churned = async (model: string) => {
    const created = expectStatus(
      await admin.post(`/api/admin/content/${model}?locale=en`, {
        locale: 'en',
        data: {
          title: 't',
          items: [{ label: 'A' }, { label: 'B' }],
          hero: { label: 'H', items: [{ label: 'h1' }, { label: 'h2' }] },
        },
      }),
      201,
    ).json<EntryBody>();
    if (model === 'r12loc') {
      await adminSave(model, created.id, { title: 'de' }, 'de');
    }
    if (model !== 'r12off') {
      expectStatus(
        await admin.post(`/api/admin/content/${model}/${created.id}/publish`, {
          locales: model === 'r12loc' ? ['en', 'de'] : ['en'],
        }),
        200,
      );
    }
    for (const label of ['A2', 'A']) {
      await adminSave(model, created.id, {
        items: [{ label }, { label: 'B' }],
        hero: { label: 'H', items: [{ label: label === 'A' ? 'h1' : 'h1x' }, { label: 'h2' }] },
      });
    }
    return created.id;
  };
  const route = (model: string, id: string) => `/api/content/${model}s/${id}?locale=en`;
  const readBack = async (model: string, id: string, token: string | null) => {
    const read = expectStatus(await request('GET', route(model, id), token), 200).json<{ data: Data }>().data;
    return Object.fromEntries(
      Object.entries(read).filter(([key]) => !SYSTEM.has(key) && !key.startsWith('__')),
    );
  };

  const echoCases = (['r12on', 'r12off', 'r12loc'] as const).flatMap((model) =>
    (['appUser', 'anonymous', 'graphql'] as const).map((via) => [model, via] as const),
  );
  it.each(echoCases)(
    '%s, %s: the published read sent back three times changes nothing',
    async (model, via) => {
      const id = await churned(model);
      const token = via === 'anonymous' ? null : alice.accessToken;
      const body = await readBack(model, id, token);
      const before = await footprint(id);
      for (let round = 0; round < 3; round += 1) {
        const version = (await adminView(model, id)).version;
        if (via === 'graphql') {
          const name = typeName(model);
          const result = await graphql(
            testApp.app,
            `mutation ($id: ID!, $v: Int, $d: ${name}Input) { update${name}(id: $id, expectedVersion: $v, data: $d, locale: "en") { id } }`,
            { headers: bearer(alice.accessToken), variables: { id, v: version, d: body } },
          );
          expect(result.body.errors, JSON.stringify(result.body)).toBeUndefined();
        } else {
          const response = await request('PUT', route(model, id), token, {
            locale: 'en',
            expectedVersion: version,
            data: body,
          });
          expect(response.statusCode, response.body).toBe(200);
        }
        // No revision, no event, and no version or status change in any locale.
        expect(await footprint(id)).toEqual(before);
      }
    },
  );

  it.each(['appUser', 'anonymous'] as const)(
    '%s: a single component whose draft instance has another ID than the published one, sent back: nothing changes',
    async (via) => {
      const id = await churned('r12on');
      const heroId = (await adminView('r12on', id)).data.hero as Item;
      // The draft's instance gets an ID the published version does not show (as a no-ID save may leave it).
      const draft = await database.current.db
        .selectFrom('entry_heads')
        .select('data')
        .where('entry_id', '=', id)
        .where('state', '=', 'draft')
        .executeTakeFirstOrThrow();
      const heroField = models.r12on?.definition.fields.find((field) => field.apiKey === 'hero')
        ?.id as string;
      const data = draft.data as Record<string, Record<string, unknown>>;
      await database.current.db
        .updateTable('entry_heads')
        .set({ data: { ...data, [heroField]: { ...data[heroField], __id: 'SSSSSSSSSSSS' } } as never })
        .where('entry_id', '=', id)
        .where('state', '=', 'draft')
        .execute();
      const token = via === 'anonymous' ? null : alice.accessToken;
      const body = await readBack('r12on', id, token);
      expect((body.hero as Item).id).not.toBe('SSSSSSSSSSSS');
      expect(heroId.id).toBeDefined();
      const before = await footprint(id);
      const response = await request('PUT', route('r12on', id), token, {
        expectedVersion: (await adminView('r12on', id)).version,
        data: body,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(await footprint(id)).toEqual(before);
      expect(((await adminView('r12on', id)).data.hero as Item).id).toBe('SSSSSSSSSSSS');
    },
  );

  it('the admin copies a single component from another locale with its id, twice: the second changes nothing', async () => {
    const id = await churned('r12loc');
    const copy = async () => {
      const en = await adminView('r12loc', id, 'en');
      await adminSave('r12loc', id, { hero: en.data.hero }, 'de');
    };
    await copy();
    const after = await footprint(id);
    await copy();
    expect(await footprint(id)).toEqual(after);
    expect(withoutIds((await adminView('r12loc', id, 'de')).data.hero)).toEqual(
      withoutIds((await adminView('r12loc', id, 'en')).data.hero),
    );
  });

  describe('swapping look-alikes holding relation targets the caller cannot see', () => {
    let swapModel: string;
    let target: string;
    let otherTarget: string;
    beforeAll(async () => {
      const thing = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r12thing',
        label: 'R12 thing',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
      });
      const linked = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'r12_linked',
          label: 'R12 linked',
          fields: [
            { apiKey: 'heading', label: 'Heading', type: 'string' },
            {
              apiKey: 'rel',
              label: 'Rel',
              type: 'relation',
              settings: { target: thing.definition.id, cardinality: 'one' },
            },
          ],
        },
        'components',
      );
      const model = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'r12swap',
        label: 'R12 swap',
        draftAndPublish: false,
        fields: [
          {
            apiKey: 'links',
            label: 'Links',
            type: 'component',
            settings: { component: linked.definition.id, repeatable: true },
          },
        ],
      });
      swapModel = model.definition.apiKey;
      // Unpublished targets: the app user's reads leave them out.
      const make = async (name: string) =>
        expectStatus(
          await admin.post('/api/admin/content/r12thing', { data: { name } }),
          201,
        ).json<EntryBody>().id;
      target = await make('t1');
      otherTarget = await make('t2');
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/app-users/${alice.user.id}`,
          payload: {
            roleIds: [
              await createAppRole(database.current.db, [
                ...Object.values(models).flatMap((entry) => [
                  { action: 'read' as const, modelId: entry.definition.id },
                  { action: 'update' as const, modelId: entry.definition.id },
                ]),
                { action: 'read', modelId: model.definition.id },
                { action: 'update', modelId: model.definition.id },
                { action: 'read', modelId: thing.definition.id },
              ]),
            ],
          },
        }),
        200,
      );
    });

    it('a change whether the hidden targets are equal or differ: same status, same shape, version bumped', async () => {
      const outcomes: Array<{ status: number; keys: string[]; bumped: boolean }> = [];
      for (const targets of [
        [target, target],
        [target, otherTarget],
      ]) {
        const created = expectStatus(
          await admin.post(`/api/admin/content/${swapModel}`, {
            data: { links: targets.map((rel) => ({ heading: 'x', rel })) },
          }),
          201,
        ).json<EntryBody>();
        const read = expectStatus(
          await request('GET', `/api/content/${swapModel}s/${created.id}`, alice.accessToken),
          200,
        ).json<{ data: Data }>().data;
        expect((read.links as Item[]).map((link) => link.rel)).toEqual([null, null]);
        const before = await adminView(swapModel, created.id);
        const response = await request('PUT', `/api/content/${swapModel}s/${created.id}`, alice.accessToken, {
          expectedVersion: before.version,
          data: { links: [...(read.links as Item[])].reverse() },
        });
        outcomes.push({
          status: response.statusCode,
          keys: Object.keys(response.json<{ data: Data }>().data ?? {}).sort(),
          bumped: (await adminView(swapModel, created.id)).version === before.version + 1,
        });
      }
      expect(outcomes[0]).toEqual(outcomes[1]);
      expect(outcomes[0]).toMatchObject({ status: 200, bumped: true });
    });
  });
});
