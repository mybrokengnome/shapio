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

type Item = { id: string; [key: string]: unknown };
type ErrorBody = {
  error: { code: string; details?: { issues?: Array<{ path: string; code: string }>; fields?: string[] } };
};

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

/**
 * The fifth review's findings (plan item-ids), each as a regression test: no answer depends on stored content
 * the caller cannot read (B1), no hidden value is lost or moved without IDs (B2, M1), the work a write can cost
 * is bounded (H1), a delivery caller cannot set what its audience cannot read (H2), and the IDs a write answers
 * are the ones stored (M2).
 */
describe('item IDs: fifth review', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let card: ModelBody;
  let page: ModelBody;
  let tile: ModelBody;
  let memo: ModelBody;
  /** Memos stored before `legacy` and `secret` were hidden, one per test that needs one. */
  const memoIds: string[] = [];
  const MEMO = {
    tiles: [{ heading: 'A', legacy: 'L', secret: 'S' }],
    hero: { heading: 'H', legacy: 'HL', secret: 'HS' },
  };
  let v0: string;

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const fieldId = (model: ModelBody, apiKey: string) =>
    model.definition.fields.find((field) => field.apiKey === apiKey)?.id as string;
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
  const create = async (data: Record<string, unknown>) => {
    const entry = expectStatus(await admin.post('/api/admin/content/page', { data }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/page/${entry.id}/publish`, {}), 200);
    return entry;
  };
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/page/${id}`), 200).json<EntryBody>();
  /** Status, code and issue codes: what an answer tells a caller. */
  const answer = (response: { statusCode: number; json: <T>() => T }) => {
    const body = response.statusCode >= 400 ? response.json<ErrorBody>() : undefined;
    return [
      response.statusCode,
      body?.error.code,
      (body?.error.details?.issues ?? []).map((issue) => `${issue.path} ${issue.code}`),
    ];
  };
  const at = (url: string) => `${url}?schemaVersion=${encodeURIComponent(v0)}`;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { ...GRAPHQL_ENV, RATE_LIMIT_MAX: '10000' },
    });
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
        ],
      },
      'components',
    );
    const section = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'section',
        label: 'Section',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: card.definition.id, repeatable: true },
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
          apiKey: 'internal',
          label: 'Internal',
          type: 'component',
          public: false,
          settings: { component: card.definition.id, repeatable: true },
        },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'component',
          settings: { component: section.definition.id, repeatable: true },
        },
      ],
    });
    // A component whose `legacy` field is deprecated after v0 and whose `secret` field is made private after v0.
    tile = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'tile',
        label: 'Tile',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'legacy', label: 'Legacy', type: 'string' },
          { apiKey: 'secret', label: 'Secret', type: 'string' },
        ],
      },
      'components',
    );
    memo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'memo',
      label: 'Memo',
      fields: [
        {
          apiKey: 'tiles',
          label: 'Tiles',
          type: 'component',
          settings: { component: tile.definition.id, repeatable: true },
        },
        { apiKey: 'hero', label: 'Hero', type: 'component', settings: { component: tile.definition.id } },
      ],
    });
    for (let index = 0; index < 3; index += 1) {
      const entry = expectStatus(
        await admin.post('/api/admin/content/memo', { data: MEMO }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/memo/${entry.id}/publish`, {}), 200);
      memoIds.push(entry.id);
    }
    v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // Something changes after v0, so a client naming it writes through a version.
    const tileNow = (await admin.get(`/api/admin/components/${tile.definition.id}`)).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/components/${tile.definition.id}`, {
        definition: {
          ...tileNow.definition,
          fields: tileNow.definition.fields.map((field) =>
            field.apiKey === 'legacy'
              ? { ...field, deprecated: true }
              : field.apiKey === 'secret'
                ? { ...field, public: false }
                : field,
          ),
        },
        expectedVersion: tileNow.version,
        acknowledgeBreaking: true,
      }),
      200,
    );
    const current = (await admin.get(`/api/admin/models/${page.definition.id}`)).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${page.definition.id}`, {
        definition: { ...current.definition, label: 'Page (renamed)' },
        expectedVersion: current.version,
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  describe('B1: no answer depends on items the caller cannot read', () => {
    const guesses = [
      [{ heading: 'nope' }],
      [{ heading: 'secret-A' }],
      [{ heading: 'x' }, { heading: 'y' }],
      [{ heading: 'x' }, { heading: 'y' }, { heading: 'z' }],
    ];
    const secrets = [
      { heading: 'secret-A', note: 'n1' },
      { heading: 'secret-B', note: 'n2' },
    ];

    it('a top-level private list: every guess, stale or not, answers 403 alike', async () => {
      const alice = await user([
        { action: 'read', modelId: page.definition.id },
        { action: 'update', modelId: page.definition.id },
      ]);
      const entry = await create({ title: 't', internal: secrets });
      const read = expectStatus(
        await request('GET', `/api/content/pages/${entry.id}`, alice.accessToken),
        200,
      );
      expect(Object.keys(read.json<{ data: object }>().data)).not.toContain('internal');
      for (const version of [99, (await adminView(entry.id)).version]) {
        const answers = await Promise.all(
          guesses.map(async (internal) =>
            answer(
              await request('PUT', `/api/content/pages/${entry.id}`, alice.accessToken, {
                expectedVersion: version,
                data: { internal },
              }),
            ),
          ),
        );
        expect(new Set(answers.map((one) => JSON.stringify(one))).size, JSON.stringify(answers)).toBe(1);
        expect(answers[0]?.slice(0, 2)).toEqual([403, 'FORBIDDEN_FIELD']);
      }
    });

    it('a list the caller may neither read nor write (T1): 403 alike, nothing written', async () => {
      const bob = await user([
        { action: 'read', modelId: page.definition.id, fieldIds: [fieldId(page, 'title')] },
        { action: 'update', modelId: page.definition.id, fieldIds: [fieldId(page, 'title')] },
      ]);
      const entry = await create({ title: 't', cards: secrets });
      const before = await adminView(entry.id);
      for (const url of [`/api/content/pages/${entry.id}`, at(`/api/content/pages/${entry.id}`)]) {
        const answers = await Promise.all(
          [...guesses, []].map(async (cards) =>
            answer(
              await request('PUT', url, bob.accessToken, {
                expectedVersion: before.version,
                data: { cards },
              }),
            ),
          ),
        );
        expect(new Set(answers.map((one) => JSON.stringify(one))).size, JSON.stringify(answers)).toBe(1);
        expect(answers[0]?.slice(0, 2)).toEqual([403, 'FORBIDDEN_FIELD']);
      }
      expect((await adminView(entry.id)).version).toBe(before.version);
    });

    it('a list the caller may write but not read (T1b, V1): every non-empty guess answers alike', async () => {
      const eve = await user([
        { action: 'read', modelId: page.definition.id, fieldIds: [fieldId(page, 'title')] },
        { action: 'update', modelId: page.definition.id },
      ]);
      const entry = await create({ title: 't', cards: secrets });
      const before = await adminView(entry.id);
      for (const url of [`/api/content/pages/${entry.id}`, at(`/api/content/pages/${entry.id}`)]) {
        for (const version of [99, before.version]) {
          const answers = await Promise.all(
            guesses.map(async (cards) =>
              answer(
                await request('PUT', url, eve.accessToken, { expectedVersion: version, data: { cards } }),
              ),
            ),
          );
          expect(new Set(answers.map((one) => JSON.stringify(one))).size, JSON.stringify(answers)).toBe(1);
          expect(answers[0]?.[0]).toBe(version === 99 ? 409 : 422);
        }
      }
      // GraphQL answers alike too.
      const graphqlAnswers = await Promise.all(
        guesses.map(async (cards) =>
          JSON.stringify(
            (
              await graphql(
                testApp.app,
                'mutation ($id: ID!, $v: Int, $data: PageInput) { updatePage(id: $id, expectedVersion: $v, data: $data) { id } }',
                {
                  headers: bearer(eve.accessToken),
                  variables: { id: entry.id, v: before.version, data: { cards } },
                },
              )
            ).body.errors?.map((error) => error.extensions?.code),
          ),
        ),
      );
      expect(new Set(graphqlAnswers).size).toBe(1);
      expect((await adminView(entry.id)).version).toBe(before.version);
    });
  });

  describe('B2 and M1: without IDs, look-alikes and nested changes are refused, never lost or moved', () => {
    let alice: AppSessionBody;
    beforeAll(async () => {
      alice = await user([
        { action: 'read', modelId: page.definition.id },
        { action: 'update', modelId: page.definition.id },
      ]);
    });
    const put = async (id: string, data: Record<string, unknown>) =>
      request('PUT', `/api/content/pages/${id}`, alice.accessToken, {
        expectedVersion: (await adminView(id)).version,
        data,
      });

    it.each([
      ['[Intro, S, S] to [S, S, Intro]', ['Intro', 'S', 'S'], ['S', 'S', 'Intro']],
      ['[S, A, S, B] to [A, B, S, S]', ['S', 'A', 'S', 'B'], ['A', 'B', 'S', 'S']],
      ['[B, A] to [A, B, B]', ['B', 'A'], ['A', 'B', 'B']],
      ['[B, B, A] to [A, B]', ['B', 'B', 'A'], ['A', 'B']],
    ])('%s is refused, and with IDs the notes stay with their items', async (_name, stored, sent) => {
      const start = stored.map((heading, index) => ({ heading, note: `n${index}` }));
      const entry = await create({ cards: start });
      const response = await put(entry.id, { cards: sent.map((heading) => ({ heading })) });
      expect(answer(response)).toEqual([422, 'CONTENT_INVALID', ['/cards AMBIGUOUS_ITEMS']]);
      expect(content((await adminView(entry.id)).data.cards)).toEqual(start);
    });

    it('M1: nested lists exchanged between parents without IDs are refused', async () => {
      const sections = [
        { name: 's1', items: [{ heading: 'i1', note: 'in1' }] },
        { name: 's2', items: [{ heading: 'i2', note: 'in2' }] },
      ];
      const entry = await create({ sections });
      const response = await put(entry.id, {
        sections: [
          { name: 's2', items: [{ heading: 'i1' }] },
          { name: 's1', items: [{ heading: 'i2' }] },
        ],
      });
      expect(answer(response)).toEqual([422, 'CONTENT_INVALID', ['/sections AMBIGUOUS_ITEMS']]);
      expect(content((await adminView(entry.id)).data.sections)).toEqual(sections);
    });

    it('a deprecated field inside the items counts as hidden too', async () => {
      const tag = await createDefinition(
        admin,
        {
          kind: 'component',
          apiKey: 'tag',
          label: 'Tag',
          fields: [
            { apiKey: 'heading', label: 'Heading', type: 'string' },
            { apiKey: 'legacy', label: 'Legacy', type: 'string' },
          ],
        },
        'components',
      );
      const board = await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'board',
        label: 'Board',
        fields: [
          {
            apiKey: 'tags',
            label: 'Tags',
            type: 'component',
            settings: { component: tag.definition.id, repeatable: true },
          },
        ],
      });
      const entry = expectStatus(
        await admin.post('/api/admin/content/board', {
          data: {
            tags: [
              { heading: 'I', legacy: 'l0' },
              { heading: 'S', legacy: 'l1' },
              { heading: 'S', legacy: 'l2' },
            ],
          },
        }),
        201,
      ).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/board/${entry.id}/publish`, {}), 200);
      const current = (await admin.get(`/api/admin/components/${tag.definition.id}`)).json<ModelBody>();
      expectStatus(
        await admin.put(`/api/admin/components/${tag.definition.id}`, {
          definition: {
            ...current.definition,
            fields: current.definition.fields.map((field) =>
              field.apiKey === 'legacy' ? { ...field, deprecated: true } : field,
            ),
          },
          expectedVersion: current.version,
          acknowledgeBreaking: true,
        }),
        200,
      );
      await runContentSchemaJobs(database.current.db);
      const bob = await user([
        { action: 'read', modelId: board.definition.id },
        { action: 'update', modelId: board.definition.id },
      ]);
      const version = expectStatus(
        await admin.get(`/api/admin/content/board/${entry.id}`),
        200,
      ).json<EntryBody>().version;
      const response = await request('PUT', `/api/content/boards/${entry.id}`, bob.accessToken, {
        expectedVersion: version,
        data: { tags: [{ heading: 'S' }, { heading: 'S' }, { heading: 'I' }] },
      });
      expect(answer(response)).toEqual([422, 'CONTENT_INVALID', ['/tags AMBIGUOUS_ITEMS']]);
    });
  });

  describe('documented without IDs: new lists and deleting several items', () => {
    let alice: AppSessionBody;
    beforeAll(async () => {
      alice = await user([
        { action: 'read', modelId: page.definition.id },
        { action: 'update', modelId: page.definition.id },
      ]);
    });
    const put = async (id: string, data: Record<string, unknown>) =>
      request('PUT', `/api/content/pages/${id}`, alice.accessToken, {
        expectedVersion: (await adminView(id)).version,
        data,
      });

    it('nothing stored: every item is new (look-alikes too), with new IDs and empty hidden fields', async () => {
      const entry = await create({ title: 't' });
      const response = await put(entry.id, { cards: [{ heading: 'A' }, { heading: 'A' }] });
      expect(response.statusCode, response.body).toBe(200);
      const cards = (await adminView(entry.id)).data.cards as Item[];
      expect(content(cards)).toEqual([
        { heading: 'A', note: null },
        { heading: 'A', note: null },
      ]);
      expect(new Set(cards.map((item) => item.id)).size).toBe(2);
      expect(response.json<{ data: { itemIds: { cards: Item[] } } }>().data.itemIds.cards).toEqual(
        cards.map((item) => ({ id: item.id })),
      );
    });

    it('a list under a new item (sent with id: null in a list named by IDs) is new too', async () => {
      const entry = await create({ sections: [{ name: 's1', items: [{ heading: 'i1', note: 'in1' }] }] });
      const [stored] = (await adminView(entry.id)).data.sections as Array<Item & { items: Item[] }>;
      const response = await put(entry.id, {
        sections: [
          { id: stored?.id, name: 's1', items: [{ id: stored?.items[0]?.id, heading: 'i1' }] },
          { id: null, name: 's2', items: [{ heading: 'x' }, { heading: 'x' }] },
        ],
      });
      expect(response.statusCode, response.body).toBe(200);
      const sections = (await adminView(entry.id)).data.sections as Array<Item & { items: Item[] }>;
      expect(content(sections)).toEqual([
        { name: 's1', items: [{ heading: 'i1', note: 'in1' }] },
        {
          name: 's2',
          items: [
            { heading: 'x', note: null },
            { heading: 'x', note: null },
          ],
        },
      ]);
      expect(sections[0]?.id).toBe(stored?.id);
      expect(new Set(sections[1]?.items.map((item) => item.id)).size).toBe(2);
    });

    it('deleting several distinct items in one write keeps the others with their hidden values', async () => {
      const entry = await create({
        cards: ['A', 'B', 'C', 'D'].map((heading) => ({ heading, note: `n${heading}` })),
      });
      const before = (await adminView(entry.id)).data.cards as Item[];
      const response = await put(entry.id, { cards: [{ heading: 'B' }, { heading: 'D' }] });
      expect(response.statusCode, response.body).toBe(200);
      const after = (await adminView(entry.id)).data.cards as Item[];
      expect(content(after)).toEqual([
        { heading: 'B', note: 'nB' },
        { heading: 'D', note: 'nD' },
      ]);
      expect(after.map((item) => item.id)).toEqual([before[1]?.id, before[3]?.id]);
    });
  });

  it('H1: a stale write of many large lists answers at once, and a fresh one is bounded', async () => {
    const plain = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'plain',
        label: 'Plain',
        fields: [{ apiKey: 'h', label: 'H', type: 'string' }],
      },
      'components',
    );
    const group = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'group',
        label: 'Group',
        fields: [
          { apiKey: 'name', label: 'Name', type: 'string' },
          {
            apiKey: 'items',
            label: 'Items',
            type: 'component',
            settings: { component: plain.definition.id, repeatable: true },
          },
        ],
      },
      'components',
    );
    const sheet = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'sheet',
      label: 'Sheet',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'component',
          settings: { component: group.definition.id, repeatable: true },
        },
      ],
    });
    const alice = await user([
      { action: 'read', modelId: sheet.definition.id },
      { action: 'update', modelId: sheet.definition.id },
    ]);
    const entry = expectStatus(
      await admin.post('/api/admin/content/sheet', { data: { title: 'x' } }),
      201,
    ).json<EntryBody>();
    const sheetVersion = async () =>
      expectStatus(await admin.get(`/api/admin/content/sheet/${entry.id}`), 200).json<EntryBody>().version;
    // 120 sections of 1,413 empty items of a component with no hidden field (so items align with the least
    // edits, for their IDs): each list alone fills a full alignment table.
    const sections = Array.from({ length: 120 }, (_, index) => ({
      name: `${index}`,
      items: Array.from({ length: 1413 }, () => ({})),
    }));
    expectStatus(
      await request('PUT', `/api/content/sheets/${entry.id}`, alice.accessToken, {
        expectedVersion: await sheetVersion(),
        data: { sections },
      }),
      200,
    );
    const attack = sections.map((section) => ({ name: section.name, items: section.items.slice(0, 1412) }));
    let started = performance.now();
    const stale = await request('PUT', `/api/content/sheets/${entry.id}`, alice.accessToken, {
      expectedVersion: 999,
      data: { sections: attack },
    });
    expect(stale.statusCode).toBe(409);
    // Before the fix this took over ten seconds; the version is checked before any work on the items now.
    expect(performance.now() - started).toBeLessThan(3_000);
    started = performance.now();
    const fresh = await request('PUT', `/api/content/sheets/${entry.id}`, alice.accessToken, {
      expectedVersion: await sheetVersion(),
      data: { sections: attack },
    });
    expect(fresh.statusCode).toBeLessThan(500);
    // One alignment budget for the whole body: a fresh write is bounded too.
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 60_000);

  describe('H2: a delivery caller may not set a component field its audience cannot read', () => {
    let alice: AppSessionBody;
    beforeAll(async () => {
      alice = await user([
        { action: 'read', modelId: page.definition.id },
        { action: 'create', modelId: page.definition.id },
        { action: 'update', modelId: page.definition.id },
      ]);
    });

    it('on update and create, with and without a version, over REST and GraphQL', async () => {
      const entry = await create({
        title: 't',
        cards: [{ heading: 'A', note: 'n1' }],
        hero: { heading: 'H', note: 'hn' },
      });
      const read = expectStatus(
        await request('GET', `/api/content/pages/${entry.id}`, alice.accessToken),
        200,
      ).json<{
        data: { cards: Item[] };
      }>().data;
      for (const url of [`/api/content/pages/${entry.id}`, at(`/api/content/pages/${entry.id}`)]) {
        const update = await request('PUT', url, alice.accessToken, {
          expectedVersion: (await adminView(entry.id)).version,
          data: {
            cards: [{ id: read.cards[0]?.id, heading: 'A', note: 'OVERWRITTEN' }],
            hero: { heading: 'H', note: 'X' },
          },
        });
        expect(update.statusCode, update.body).toBe(403);
        expect(update.json<ErrorBody>().error).toMatchObject({
          code: 'FORBIDDEN_FIELD',
          details: { fields: ['/cards/0/note', '/hero/note'] },
        });
      }
      for (const url of ['/api/content/pages', at('/api/content/pages')]) {
        const created = await request('POST', url, alice.accessToken, {
          data: { title: 'n', cards: [{ heading: 'A', note: 'SET-ON-CREATE' }] },
        });
        expect([created.statusCode, created.json<ErrorBody>().error.code]).toEqual([403, 'FORBIDDEN_FIELD']);
      }
      const viaGraphql = await graphql(
        testApp.app,
        'mutation ($data: PageInput) { createPage(data: $data) { id } }',
        {
          headers: bearer(alice.accessToken),
          variables: { data: { title: 'g', cards: [{ heading: 'A', note: 'G' }] } },
        },
      );
      // Null included: sending the field at all is refused, through a version as without one.
      for (const url of [`/api/content/pages/${entry.id}`, at(`/api/content/pages/${entry.id}`)]) {
        const cleared = await request('PUT', url, alice.accessToken, {
          expectedVersion: (await adminView(entry.id)).version,
          data: { cards: [{ id: read.cards[0]?.id, heading: 'A', note: null }] },
        });
        expect(cleared.statusCode, cleared.body).toBe(403);
        expect(cleared.json<ErrorBody>().error).toMatchObject({
          code: 'FORBIDDEN_FIELD',
          details: { fields: ['/cards/0/note'] },
        });
      }
      // GraphQL's input types for this caller do not name the field at all.
      expect(viaGraphql.body.errors?.map((error) => error.extensions?.code)).toEqual([
        'GRAPHQL_VALIDATION_FAILED',
      ]);
      expect(content((await adminView(entry.id)).data)).toMatchObject({
        cards: [{ heading: 'A', note: 'n1' }],
        hero: { heading: 'H', note: 'hn' },
      });
    });
  });

  describe('a component field hidden since the version (deprecated, or made private)', () => {
    type MemoRead = { data: { tiles: Item[]; hero: Item } };
    let alice: AppSessionBody;
    const memoView = async (id: string) =>
      expectStatus(await admin.get(`/api/admin/content/memo/${id}`), 200).json<EntryBody>();
    const newMemo = (index: number) => ({ id: memoIds[index] as string });
    /** The stored draft as is (field IDs, hidden fields included): what a write left alone stays equal. */
    const storedDraft = async (id: string) =>
      (
        await database.current.db
          .selectFrom('entry_heads')
          .select('data')
          .where('entry_id', '=', id)
          .where('state', '=', 'draft' as never)
          .executeTakeFirstOrThrow()
      ).data;
    beforeAll(async () => {
      alice = await user([
        { action: 'read', modelId: memo.definition.id },
        { action: 'create', modelId: memo.definition.id },
        { action: 'update', modelId: memo.definition.id },
      ]);
    });

    it('DD: the read through the version, sent straight back, is accepted and changes nothing', async () => {
      const entry = newMemo(0);
      const read = expectStatus(
        await request('GET', at(`/api/content/memos/${entry.id}`), alice.accessToken),
        200,
      ).json<MemoRead>().data;
      expect(read.tiles[0]).toMatchObject({ heading: 'A', legacy: null, secret: null });
      expect(read.tiles[0]?.id).toEqual(expect.any(String));
      expect(read.hero).toMatchObject({ heading: 'H', legacy: null, secret: null });
      const before = await storedDraft(entry.id);
      const echo = await request('PUT', at(`/api/content/memos/${entry.id}`), alice.accessToken, {
        expectedVersion: (await memoView(entry.id)).version,
        data: { tiles: read.tiles, hero: read.hero },
      });
      expect(echo.statusCode, echo.body).toBe(200);
      expect(await storedDraft(entry.id)).toEqual(before);
      // A null create through the version names what that version shows: left out, nothing set.
      const created = await request('POST', at('/api/content/memos'), alice.accessToken, {
        data: { tiles: [{ heading: 'A', legacy: null, secret: null }], hero: { heading: 'H', secret: null } },
      });
      expect(created.statusCode, created.body).toBe(201);
    });

    it.each(['legacy', 'secret'])('a value for `%s` is refused, with a version and without', async (key) => {
      const entry = newMemo(key === 'legacy' ? 1 : 2);
      const read = expectStatus(
        await request('GET', at(`/api/content/memos/${entry.id}`), alice.accessToken),
        200,
      ).json<MemoRead>().data;
      const before = await storedDraft(entry.id);
      const body = {
        tiles: [{ id: read.tiles[0]?.id, heading: 'A', [key]: 'x' }],
        hero: { heading: 'H', [key]: 'x' },
      };
      const versioned = await request('PUT', at(`/api/content/memos/${entry.id}`), alice.accessToken, {
        expectedVersion: (await memoView(entry.id)).version,
        data: body,
      });
      expect(versioned.statusCode, versioned.body).toBe(403);
      expect(versioned.json<ErrorBody>().error).toMatchObject({
        code: 'FORBIDDEN_FIELD',
        details: { fields: [`/tiles/0/${key}`, `/hero/${key}`] },
      });
      const created = await request('POST', at('/api/content/memos'), alice.accessToken, {
        data: { tiles: [{ heading: 'A', [key]: 'x' }] },
      });
      expect([created.statusCode, created.json<ErrorBody>().error.code]).toEqual([403, 'FORBIDDEN_FIELD']);
      // Without a version: a deprecated field is no field at all (422), a private one is refused (403), null too.
      for (const value of ['x', null]) {
        const plain = await request('PUT', `/api/content/memos/${entry.id}`, alice.accessToken, {
          expectedVersion: (await memoView(entry.id)).version,
          data: { tiles: [{ id: read.tiles[0]?.id, heading: 'A', [key]: value }] },
        });
        if (key === 'legacy') {
          expect(answer(plain)).toEqual([422, 'CONTENT_INVALID', ['/tiles/0/legacy UNKNOWN_FIELD']]);
        } else {
          expect([plain.statusCode, plain.json<ErrorBody>().error.code]).toEqual([403, 'FORBIDDEN_FIELD']);
        }
      }
      expect(await storedDraft(entry.id)).toEqual(before);
    });
  });

  it('a refused list names the same nested issues with and without a version', async () => {
    const alice = await user([
      { action: 'read', modelId: page.definition.id },
      { action: 'update', modelId: page.definition.id },
    ]);
    const entry = await create({ sections: [{ name: 's1', items: [{ heading: 'i1', note: 'in1' }] }] });
    const body = {
      sections: [
        { name: 'x', items: [{ id: 'nope', heading: 'i' }] },
        { name: 'y', items: [] },
      ],
    };
    const answers = [];
    for (const url of [`/api/content/pages/${entry.id}`, at(`/api/content/pages/${entry.id}`)]) {
      answers.push(
        answer(
          await request('PUT', url, alice.accessToken, {
            expectedVersion: (await adminView(entry.id)).version,
            data: body,
          }),
        ),
      );
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toEqual([
      422,
      'CONTENT_INVALID',
      ['/sections AMBIGUOUS_ITEMS', '/sections/0/items/0/id UNKNOWN_ITEM_ID'],
    ]);
  });

  it('M2: a write that changes nothing answers the stored IDs, which the next write accepts', async () => {
    const alice = await user([
      { action: 'read', modelId: page.definition.id },
      { action: 'update', modelId: page.definition.id },
    ]);
    const entry = await create({ title: 't', cards: [{ heading: 'A' }] });
    // Stored without IDs (content saved before item IDs existed): the answer is the derived ID.
    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', entry.id)
      .execute();
    const cardsId = fieldId(page, 'cards');
    for (const head of heads) {
      const data = head.data as Record<string, unknown>;
      await database.current.db
        .updateTable('entry_heads')
        .set({
          data: {
            ...data,
            [cardsId]: (data[cardsId] as Array<Record<string, unknown>>).map(
              ({ __id: _id, ...rest }) => rest,
            ),
          } as never,
        })
        .where('entry_id', '=', entry.id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state as never)
        .execute();
    }
    const version = (await adminView(entry.id)).version;
    const noop = await request('PUT', `/api/content/pages/${entry.id}`, alice.accessToken, {
      expectedVersion: version,
      data: { cards: [{ heading: 'A' }] },
    });
    const answered = noop.json<{ data: { version: number; itemIds: { cards: Item[] } } }>().data;
    const stored = (await adminView(entry.id)).data.cards as Item[];
    expect(answered.itemIds.cards.map((item) => item.id)).toEqual(stored.map((item) => item.id));
    const next = await request('PUT', `/api/content/pages/${entry.id}`, alice.accessToken, {
      expectedVersion: answered.version,
      data: { cards: [{ id: answered.itemIds.cards[0]?.id, heading: 'A2' }] },
    });
    expect(next.statusCode, next.body).toBe(200);
    // `id: null` on a list that is otherwise unchanged writes a new item: the answer names the new, stored ID.
    const fresh = await request('PUT', `/api/content/pages/${entry.id}`, alice.accessToken, {
      expectedVersion: next.json<{ data: { version: number } }>().data.version,
      data: { cards: [{ id: null, heading: 'A2' }] },
    });
    const freshIds = fresh
      .json<{ data: { itemIds: { cards: Item[] } } }>()
      .data.itemIds.cards.map((item) => item.id);
    expect(freshIds).toEqual(((await adminView(entry.id)).data.cards as Item[]).map((item) => item.id));
  });
});
