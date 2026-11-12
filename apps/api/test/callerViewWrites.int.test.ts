import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BODY_DEPTH } from '../src/constants/requestBody.js';
import { MAX_REPORTED_ISSUES } from '../src/content/validator/issues.js';
import { bearer, createAppRole, signUp, type AppSessionBody } from './helpers/appUsers.js';
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

type Item = { id?: string; [key: string]: unknown };
type ErrorBody = {
  error: {
    code: string;
    details?: { issues?: Array<{ path: string; code: string }>; issueCount?: number; truncated?: boolean };
  };
};

/**
 * What a write keeps behind what a read showed (`keepBehindRead`, `callerView.ts`): relation targets the caller
 * cannot see stay when it sends back what it read, with and without IDs and a version, at the top level and inside
 * items; a many-relation keeps them around what it sends (the merge rule); and values no depth or size can turn
 * into a 500 or an unbounded refusal.
 */
describe('writes keep what the read hid', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let article: ModelBody;
  let tile: ModelBody;
  let reader: AppSessionBody;
  let v0: string;
  const targets: Record<'a' | 'b' | 'hidden', string> = { a: '', b: '', hidden: '' };

  const request = (method: 'GET' | 'PUT' | 'POST', url: string, token: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const at = (url: string) => `${url}?schemaVersion=${encodeURIComponent(v0)}`;
  const adminView = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/content/article/${id}`), 200).json<EntryBody>();
  const create = async (data: Record<string, unknown>) => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/article', { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
    return entry.id;
  };
  const readAs = async (id: string, version: boolean) =>
    expectStatus(
      await request(
        'GET',
        (version ? at : (url: string) => url)(`/api/content/articles/${id}`),
        reader.accessToken,
      ),
      200,
    ).json<{ data: Record<string, unknown> }>().data;
  const write = async (id: string, version: boolean, data: Record<string, unknown>) =>
    request('PUT', (version ? at : (url: string) => url)(`/api/content/articles/${id}`), reader.accessToken, {
      expectedVersion: (await adminView(id)).version,
      data,
    });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const target = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'target',
      label: 'Target',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    tile = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'tile',
        label: 'Tile',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          {
            apiKey: 'rel',
            label: 'Rel',
            type: 'relation',
            settings: { target: target.definition.id, cardinality: 'one' },
          },
          {
            apiKey: 'refs',
            label: 'Refs',
            type: 'relation',
            settings: { target: target.definition.id, cardinality: 'many' },
          },
          { apiKey: 'doc', label: 'Doc', type: 'json' },
          { apiKey: 'pic', label: 'Pic', type: 'media', settings: { multiple: false } },
        ],
      },
      'components',
    );
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'lead',
          label: 'Lead',
          type: 'relation',
          settings: { target: target.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'links',
          label: 'Links',
          type: 'relation',
          settings: { target: target.definition.id, cardinality: 'many' },
        },
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: tile.definition.id, repeatable: true },
        },
      ],
    });
    for (const key of ['a', 'b', 'hidden'] as const) {
      const entry = expectStatus(
        await admin.post('/api/admin/content/target', { data: { name: key } }),
        201,
      ).json<EntryBody>();
      if (key !== 'hidden') {
        expectStatus(await admin.post(`/api/admin/content/target/${entry.id}/publish`, {}), 200);
      }
      targets[key] = entry.id;
    }
    reader = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${reader.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(database.current.db, [
              { action: 'read', modelId: article.definition.id },
              { action: 'update', modelId: article.definition.id },
              { action: 'create', modelId: article.definition.id },
              { action: 'read', modelId: target.definition.id },
            ]),
          ],
        },
      }),
      200,
    );
    v0 = expectStatus(await request('GET', '/api/snapshots/current', adminToken), 200).json<{
      schemaVersionToken: string;
    }>().schemaVersionToken;
    // Something changes after v0, so a client naming it writes through a version.
    const current = (await admin.get(`/api/admin/models/${article.definition.id}`)).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${article.definition.id}`, {
        definition: { ...current.definition, label: 'Article (renamed)' },
        expectedVersion: current.version,
      }),
      200,
    );
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  /** An asset ID no read can show (no such asset): what a deleted asset leaves behind, set in storage directly. */
  const GONE_ASSET = '00000000-0000-4000-8000-000000000001';
  const fieldIdOf = (model: ModelBody, apiKey: string) =>
    model.definition.fields.find((field) => field.apiKey === apiKey)?.id as string;
  /** Rewrites every head of an entry in storage (values no write would store: what older data leaves behind). */
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
  /** Sets the first card's `pic` to an asset that no longer resolves, in every head of the entry. */
  const withGoneAsset = async (id: string) => {
    const cardsId = fieldIdOf(article, 'cards');
    const picId = fieldIdOf(tile, 'pic');
    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data'])
      .where('entry_id', '=', id)
      .execute();
    for (const head of heads) {
      const data = head.data as Record<string, unknown>;
      const cards = (data[cardsId] as Array<Record<string, unknown>>).map((card, index) =>
        index === 0 ? { ...card, [picId]: GONE_ASSET } : card,
      );
      await database.current.db
        .updateTable('entry_heads')
        .set({ data: { ...data, [cardsId]: cards } as never })
        .where('entry_id', '=', id)
        .where('locale', '=', head.locale)
        .where('state', '=', head.state as never)
        .execute();
    }
  };

  describe.each([false, true])('through a version: %s', (version) => {
    it.each([
      ['with its ID', true, false],
      ['without IDs, exactly as read', false, false],
      ['without IDs, edited (a new item: what it hid goes, as before item IDs)', false, true],
    ])(
      'an item holding a hidden relation target and a gone asset, sent back %s',
      async (_name, ids, edit) => {
        const id = await create({
          title: 't',
          cards: [
            { heading: 'A', rel: targets.hidden },
            { heading: 'B', rel: targets.b },
          ],
        });
        await withGoneAsset(id);
        const read = await readAs(id, version);
        const cards = (read.cards as Item[]).map((card, index) => {
          const { id: itemId, ...rest } = card;
          return {
            ...(ids ? { id: itemId } : {}),
            ...rest,
            ...(edit && index === 0 ? { heading: 'A2' } : {}),
          };
        });
        expect(cards[0]).toMatchObject({ rel: null, pic: null });
        expectStatus(await write(id, version, { cards }), 200);
        const stored = (await adminView(id)).data.cards as Item[];
        expect(stored[0]).toMatchObject(
          edit ? { heading: 'A2', rel: null } : { heading: 'A', rel: targets.hidden, pic: GONE_ASSET },
        );
        if (edit) {
          expect([null, undefined]).toContain(stored[0]?.pic);
        }
      },
    );

    it('a relation read as null (its target unpublished), sent back, stays', async () => {
      const id = await create({ title: 't', lead: targets.hidden });
      const read = await readAs(id, version);
      expect(read.lead).toBeNull();
      expectStatus(await write(id, version, { title: 't2', lead: read.lead }), 200);
      expect((await adminView(id)).data.lead).toBe(targets.hidden);
      // A target it can see replaces it.
      expectStatus(await write(id, version, { lead: targets.a }), 200);
      expect((await adminView(id)).data.lead).toBe(targets.a);
    });

    it.each([
      ['sent back as read', ['a', 'b'], ['a', 'hidden', 'b']],
      ['reordered: the hidden target stays after the one it followed', ['b', 'a'], ['b', 'a', 'hidden']],
      ['the one it followed removed: it moves to the start', ['b'], ['hidden', 'b']],
      ['emptied: only the hidden target stays', [], ['hidden']],
    ] as const)('a many-relation %s', async (_name, sent, expected) => {
      const id = await create({ title: 't', links: [targets.a, targets.hidden, targets.b] });
      expect(await readAs(id, version)).toMatchObject({ links: [targets.a, targets.b] });
      expectStatus(await write(id, version, { links: sent.map((key) => targets[key]) }), 200);
      expect((await adminView(id)).data.links).toEqual(expected.map((key) => targets[key]));
    });

    it.each([true, false])('inside an item, sent back with its ID: %s', async (withIds) => {
      const id = await create({
        title: 't',
        cards: [
          { heading: 'A', rel: targets.hidden, refs: [targets.hidden, targets.a] },
          { heading: 'B', rel: targets.b },
        ],
      });
      const read = await readAs(id, version);
      const cards = (read.cards as Item[]).map((card) => {
        if (withIds) {
          return card;
        }
        const { id: _id, ...rest } = card;
        return rest;
      });
      expect(cards[0]).toMatchObject({ rel: null, refs: [targets.a] });
      expectStatus(await write(id, version, { cards }), 200);
      const stored = (await adminView(id)).data.cards as Item[];
      expect(stored.map(({ rel, refs }) => ({ rel, refs }))).toEqual([
        { rel: targets.hidden, refs: [targets.hidden, targets.a] },
        { rel: targets.b, refs: [] },
      ]);
    });
  });

  it('a json value nested deep inside an item never makes a write fail with a 5xx', async () => {
    // Arrays nested as deep as a body may carry them (`MAX_BODY_DEPTH`, less the four levels of
    // `{ data: { cards: [{ doc } ] } }` and the innermost `[]`): every later write of the list hashes the item's
    // content (any depth: listPairing.test.ts).
    const levels = MAX_BODY_DEPTH - 5;
    let deep: unknown = [];
    for (let depth = 0; depth < levels; depth += 1) {
      deep = [deep];
    }
    const created = await admin.post('/api/admin/content/article', {
      data: { title: 't', cards: [{ heading: 'A', doc: deep }] },
    });
    expect(created.statusCode, created.body.slice(0, 400)).toBe(201);
    const id = created.json<EntryBody>().id;
    expectStatus(await admin.post(`/api/admin/content/article/${id}/publish`, {}), 200);
    for (let round = 0; round < 2; round += 1) {
      const read = await readAs(id, false);
      const response = await write(id, false, { cards: read.cards });
      expect(response.statusCode, response.body).toBeLessThan(500);
      const saved = await admin.put(`/api/admin/content/article/${id}`, {
        expectedVersion: (await adminView(id)).version,
        data: { cards: (await adminView(id)).data.cards },
      });
      expect(saved.statusCode, saved.body).toBeLessThan(500);
    }
  });

  it('a refusal lists at most a bounded number of issues, and says how many there were', async () => {
    const id = await create({ title: 't' });
    const data = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`unknown${index}`, 1]));
    for (const version of [false, true]) {
      const refused = await write(id, version, data);
      expect(refused.statusCode).toBe(422);
      const { error } = refused.json<ErrorBody>();
      expect(error.code).toBe('CONTENT_INVALID');
      expect(error.details?.issues).toHaveLength(MAX_REPORTED_ISSUES);
      expect(error.details?.issueCount).toBe(500);
      expect(error.details?.truncated).toBe(true);
    }
  });

  it('through a version, an unknown field answers before a stale version, at no cost for the items', async () => {
    const id = await create({ title: 't', cards: [{ heading: 'A' }] });
    const refused = await request('PUT', at(`/api/content/articles/${id}`), reader.accessToken, {
      expectedVersion: 999,
      data: { nope: 1, cards: Array.from({ length: 2_000 }, () => ({ heading: 'x' })) },
    });
    expect([refused.statusCode, refused.json<ErrorBody>().error.code]).toEqual([422, 'CONTENT_INVALID']);
  });

  describe.each([false, true])('documented claims, through a version: %s', (version) => {
    const draftData = async (id: string) =>
      (
        await database.current.db
          .selectFrom('entry_heads')
          .select('data')
          .where('entry_id', '=', id)
          .where('state', '=', 'draft' as never)
          .executeTakeFirstOrThrow()
      ).data as Record<string, unknown>;

    /** An entry whose title and first card's heading no longer fit their fields (as older data can). */
    const withMisfits = async () => {
      const id = await create({ title: 't', cards: [{ heading: 'A' }, { heading: 'B' }] });
      await inStorage(id, (data) => ({
        ...data,
        [fieldIdOf(article, 'title')]: 5,
        [fieldIdOf(article, 'cards')]: (
          data[fieldIdOf(article, 'cards')] as Array<Record<string, unknown>>
        ).map((card, index) => (index === 0 ? { ...card, [fieldIdOf(tile, 'heading')]: 7 } : card)),
      }));
      return id;
    };
    const storedMisfits = async (id: string) => {
      const data = await draftData(id);
      const cards = data[fieldIdOf(article, 'cards')] as Array<Record<string, unknown>>;
      return { title: data[fieldIdOf(article, 'title')], heading: cards[0]?.[fieldIdOf(tile, 'heading')] };
    };

    it.each([true, false])(
      'a value that no longer fits its field reads as empty and, sent back empty, is cleared (with IDs: %s)',
      async (ids) => {
        const id = await withMisfits();
        const read = await readAs(id, version);
        expect(read.title).toBeNull();
        expect((read.cards as Item[])[0]?.heading).toBeNull();
        const cards = (read.cards as Item[]).map((card) => {
          const { id: itemId, ...rest } = card;
          return ids ? { id: itemId, ...rest } : rest;
        });
        // The entry can be saved: what it read, sent back, clears both (as before item IDs), the items continue.
        const saved = await write(id, version, { title: read.title, cards });
        expect(saved.statusCode, saved.body).toBe(200);
        expect(await storedMisfits(id)).toEqual({ title: undefined, heading: undefined });
        const after = (await adminView(id)).data.cards as Item[];
        expect(after.map((card) => card.id)).toEqual((read.cards as Item[]).map((card) => card.id));
      },
    );

    it('an admin can save an entry holding values that no longer fit, clearing them', async () => {
      const id = await withMisfits();
      const view = await adminView(id);
      expect(view.data.title).toBeNull();
      const saved = await admin.put(`/api/admin/content/article/${id}`, {
        expectedVersion: view.version,
        data: { title: view.data.title, cards: view.data.cards },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(await storedMisfits(id)).toEqual({ title: undefined, heading: undefined });
    });

    it('a write that leaves such a value out leaves it as stored, and the validator answers for it as before', async () => {
      const id = await withMisfits();
      const response = await write(id, version, { lead: targets.a });
      expect(response.statusCode).toBe(422);
      expect(response.json<ErrorBody>().error.details?.issues).toEqual([
        expect.objectContaining({ path: '/title', code: 'INVALID_TYPE' }),
        expect.objectContaining({ path: '/cards/0/heading', code: 'INVALID_TYPE' }),
      ]);
      expect(await storedMisfits(id)).toEqual({ title: 5, heading: 7 });
    });

    it('a stored relation target that no longer resolves never fails an update and is dropped; a new one fails', async () => {
      // A target deleted since it was stored (its row stays, marked deleted): it no longer resolves.
      const gone = expectStatus(
        await admin.post('/api/admin/content/target', { data: { name: 'gone' } }),
        201,
      ).json<EntryBody>().id;
      expectStatus(await admin.post(`/api/admin/content/target/${gone}/publish`, {}), 200);
      const id = await create({ title: 't', lead: gone, cards: [{ heading: 'A', rel: gone }] });
      const leadId = fieldIdOf(article, 'lead');
      await database.current.db
        .updateTable('entries')
        .set({ deleted_at: new Date() as never })
        .where('id', '=', gone)
        .execute();
      const read = await readAs(id, version);
      expectStatus(await write(id, version, { title: 't2', lead: read.lead, cards: read.cards }), 200);
      // Kept for the caller while it resolved; deleted, it is dropped, as the same write before 0.9.0 drops it.
      expect((await draftData(id))[leadId] ?? null).toBeNull();
      expect(JSON.stringify(await draftData(id))).not.toContain(gone);
      const refused = await write(id, version, { lead: '00000000-0000-4000-8000-000000000003' });
      expect(refused.statusCode).toBe(422);
      expect(refused.json<ErrorBody>().error.details?.issues).toEqual([
        expect.objectContaining({ path: '/lead', code: 'RELATION_TARGET_MISSING' }),
      ]);
    });

    it('a delivery create of 50,001 items in a list without `max` is refused TOO_MANY at the list', async () => {
      const created = await request(
        'POST',
        (version ? at : (url: string) => url)('/api/content/articles'),
        reader.accessToken,
        { data: { title: 't', cards: Array.from({ length: 50_001 }, () => ({})) } },
      );
      expect(created.statusCode).toBe(422);
      expect(created.json<ErrorBody>().error.details?.issues).toEqual([
        expect.objectContaining({ path: '/cards', code: 'TOO_MANY' }),
      ]);
    });
  });
});
