import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ITEM_ID_PATTERN } from '../src/constants/itemIds.js';
import { importEntry } from '../src/content/transfer/importEntry.js';
import * as contentRevisionsRepository from '../src/repositories/contentRevisions.js';
import { loadSnapshot } from '../src/schema/loadSnapshot.js';
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

type Item = { id: string; [key: string]: unknown };
type Stored = Record<string, unknown>;
type View = EntryBody & { status: string; data: Record<string, unknown> };

/** A fixed instance key, so every database derives the same IDs from the same stored content. */
const KEY = '0123456789abcdef'.repeat(4);
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The derivation of an ID for an item stored without one (plan item-ids), written out independently. */
const derivedId = (entryId: string, path: string[], occurrence: number, content: string) => {
  const secret = createHmac('sha256', Buffer.from(KEY, 'hex')).update(entryId).digest('hex');
  let value = BigInt(
    `0x${createHash('sha256')
      .update(`${secret}\u0000\u0000${path.join('\u0000')}\u0000${occurrence}\u0000${content}`)
      .digest()
      .subarray(0, 16)
      .toString('hex')}`,
  );
  let id = '';
  for (let index = 0; index < 12; index += 1) {
    id += BASE62[Number(value % 62n)];
    value /= 62n;
  }
  return id;
};

const sortedKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortedKeys)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sortedKeys((value as Stored)[key])]),
        )
      : value;

/** `value` with its keys in reverse order at every level (an order some databases keep and others sort). */
const reversedKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reversedKeys)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .reverse()
            .map((key) => [key, reversedKeys((value as Stored)[key])]),
        )
      : value;

/** Stored data without item IDs (content saved before item IDs existed). */
const withoutIds = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutIds)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== '__id')
            .map(([key, item]) => [key, withoutIds(item)]),
        )
      : value;

const idsOf = (value: unknown): string[] => [value].flat().map((item) => (item as Item).id);

/**
 * Item IDs as Shapio assigns and persists them (plan item-ids): 12 base62 characters, derived the same on
 * every database for items stored without one, a new one per instance on create, unique within one head
 * wherever data is persisted (B-2), and carried through a schema conversion so draft, published version and
 * a client holding a read ID agree (H6).
 */
describe('item IDs: assignment, uniqueness and conversions', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let card: ModelBody;
  let tile: ModelBody;
  let doc: ModelBody;
  let page: ModelBody;
  let memo: ModelBody;
  let alice: AppSessionBody;

  const db = () => database.current.db;
  const request = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) =>
    testApp.app.inject({
      method,
      url,
      headers: bearer(alice.accessToken),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  const fieldId = (model: ModelBody, apiKey: string) =>
    model.definition.fields.find((field) => field.apiKey === apiKey)?.id as string;
  const view = async (apiKey: string, id: string, locale?: string) =>
    expectStatus(
      await admin.get(`/api/admin/content/${apiKey}/${id}${locale ? `?locale=${locale}` : ''}`),
      200,
    ).json<View>();
  const deliver = async (routeKey: string, id: string, locale?: string) =>
    expectStatus(
      await request('GET', `/api/content/${routeKey}/${id}${locale ? `?locale=${locale}` : ''}`),
      200,
    ).json<{
      data: Record<string, unknown>;
    }>().data;
  const heads = (id: string) =>
    db()
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'data', 'revision_id'])
      .where('entry_id', '=', id)
      .execute();
  const setHead = (id: string, locale: string, state: string, data: unknown) =>
    db()
      .updateTable('entry_heads')
      .set({ data: data as never })
      .where('entry_id', '=', id)
      .where('locale', '=', locale)
      .where('state', '=', state as never)
      .execute();
  const makeLegacy = async (id: string) => {
    for (const head of await heads(id)) {
      await setHead(id, head.locale, head.state, withoutIds(head.data));
    }
  };
  const create = async (apiKey: string, data: Record<string, unknown>, locale?: string) =>
    expectStatus(
      await admin.post(`/api/admin/content/${apiKey}`, { ...(locale ? { locale } : {}), data }),
      201,
    ).json<EntryBody>();
  const publish = async (apiKey: string, id: string, locales?: string[]) =>
    expectStatus(
      await admin.post(`/api/admin/content/${apiKey}/${id}/publish`, locales ? { locales } : {}),
      200,
    );
  const editDefinition = async (
    kind: 'models' | 'components',
    id: string,
    change: (definition: ModelBody['definition']) => ModelBody['definition'],
  ) => {
    const current = (await admin.get(`/api/admin/${kind}/${id}`)).json<ModelBody>();
    const changed = await admin.put(`/api/admin/${kind}/${id}`, {
      definition: change(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    // A change with content work is accepted (202) and activates once its job runs.
    expect([200, 202], changed.body).toContain(changed.statusCode);
    await runContentSchemaJobs(db());
  };
  const editField = (model: ModelBody, apiKey: string, change: (field: Stored) => Stored) =>
    editDefinition('models', model.definition.id, (definition) => ({
      ...definition,
      fields: definition.fields.map((field) =>
        field.apiKey === apiKey ? (change(field as never) as never) : field,
      ),
    }));

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '10000' },
    });
    // Before anything reads the key: every database derives from this one.
    await db().updateTable('system_versions').set({ item_id_key: KEY }).execute();
    admin = schemaClient(testApp.app, await createRoleToken(db()));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'note', label: 'Note', type: 'string' },
          { apiKey: 'meta', label: 'Meta', type: 'json' },
        ],
      },
      'components',
    );
    tile = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'tile',
        label: 'Tile',
        fields: [
          { apiKey: 'label', label: 'Label', type: 'string' },
          { apiKey: 'num', label: 'Num', type: 'string' },
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
    const cards = (apiKey: string, extra: Stored = {}) => ({
      apiKey,
      label: apiKey,
      type: 'component',
      settings: { component: card.definition.id, repeatable: true },
      ...extra,
    });
    const single = (apiKey: string) => ({
      apiKey,
      label: apiKey,
      type: 'component',
      settings: { component: card.definition.id },
    });
    doc = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'doc',
      label: 'Doc',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        cards('cards'),
        single('hero'),
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'component',
          settings: { component: section.definition.id, repeatable: true },
        },
      ],
    });
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', localized: true },
        cards('cards'),
        single('hero'),
        cards('strip'),
        {
          apiKey: 'tiles',
          label: 'Tiles',
          type: 'component',
          settings: { component: tile.definition.id, repeatable: true },
        },
        cards('blocks', { localized: true }),
      ],
    });
    memo = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'memo',
      label: 'Memo',
      localized: true,
      fields: [cards('notes', { localized: true })],
    });
    alice = await signUp(testApp.app);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/app-users/${alice.user.id}`,
        payload: {
          roleIds: [
            await createAppRole(
              db(),
              [doc, page, memo].flatMap((model) =>
                (['read', 'create', 'update'] as const).map((action) => ({
                  action,
                  modelId: model.definition.id,
                })),
              ),
            ),
          ],
        },
      }),
      200,
    );
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('derives the same IDs on every database for items stored without one, whatever key order it returns', async () => {
    const entry = await create('doc', { title: 't' });
    const [cardsId, heroId, headingId, noteId, metaId] = [
      fieldId(doc, 'cards'),
      fieldId(doc, 'hero'),
      fieldId(card, 'heading'),
      fieldId(card, 'note'),
      fieldId(card, 'meta'),
    ] as [string, string, string, string, string];
    const twin = {
      [headingId]: 'A',
      [noteId]: 'n',
      [metaId]: { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } },
    };
    const stored = {
      [cardsId]: [twin, twin, { [headingId]: 'B' }],
      [heroId]: { [headingId]: 'H', [noteId]: 'h' },
      [fieldId(doc, 'title')]: 't',
    };
    const [draft] = await heads(entry.id);
    await setHead(entry.id, draft?.locale ?? 'en', 'draft', reversedKeys(stored));
    const read = (await view('doc', entry.id)).data;
    const content = (item: unknown) => JSON.stringify(sortedKeys(item));
    expect([...idsOf(read.cards), ...idsOf(read.hero)]).toEqual([
      derivedId(entry.id, [cardsId], 0, content(twin)),
      derivedId(entry.id, [cardsId], 1, content(twin)),
      derivedId(entry.id, [cardsId], 0, content({ [headingId]: 'B' })),
      derivedId(entry.id, [heroId], 0, 'single'),
    ]);
    expect(idsOf(read.cards).every((id) => ITEM_ID_PATTERN.test(id))).toBe(true);
  });

  describe('B-2: a create never stores two items under one ID', () => {
    it('gives each item of a delivery create its own ID, whatever IDs the body repeats', async () => {
      const created = await request('POST', '/api/content/docs', {
        data: {
          title: 'mine',
          cards: [
            { id: 'x', heading: 'A' },
            { id: 'x', heading: 'B' },
          ],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const body = created.json<{ data: { id: string; itemIds: { cards: Item[] } } }>().data;
      const answered = idsOf(body.itemIds.cards);
      expect(new Set(answered).size).toBe(2);
      expect(answered.every((id) => ITEM_ID_PATTERN.test(id))).toBe(true);
      const stored = (await view('doc', body.id)).data.cards as Item[];
      expect(idsOf(stored)).toEqual(answered);
      // Each item can be continued on its own: keep B by its ID.
      const written = await request('PUT', `/api/content/docs/${body.id}`, {
        expectedVersion: (await view('doc', body.id)).version,
        data: { cards: [{ id: answered[1], heading: 'B2' }] },
      });
      expect(written.statusCode, written.body).toBe(200);
      expect((await view('doc', body.id)).data.cards).toEqual([
        expect.objectContaining({ id: answered[1], heading: 'B2' }),
      ]);
    });

    it('gives each item of an admin create its own ID across lists, single fields and nesting', async () => {
      const entry = await create('doc', {
        title: 't',
        cards: [{ id: 'y', heading: 'A' }],
        hero: { id: 'y', heading: 'H' },
        sections: [{ id: 'y', name: 's', items: [{ id: 'y', heading: 'i' }] }],
      });
      const data = (await view('doc', entry.id)).data;
      const sections = data.sections as Array<Item & { items: Item[] }>;
      const ids = [
        ...idsOf(data.cards),
        ...idsOf(data.hero),
        ...idsOf(sections),
        ...idsOf(sections[0]?.items),
      ];
      expect(new Set(ids).size).toBe(4);
      expect(ids.every((id) => ITEM_ID_PATTERN.test(id))).toBe(true);
    });
  });

  describe('B-2: stored data repeating an ID is persisted with the later repeats renewed', () => {
    it('duplicates an entry into two items, the same IDs in every locale of a shared field', async () => {
      const entry = await create('page', { title: 'en', cards: [{ heading: 'A' }, { heading: 'B' }] }, 'en');
      expectStatus(
        await admin.put(`/api/admin/content/page/${entry.id}`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr' },
        }),
        200,
      );
      const cardsId = fieldId(page, 'cards');
      for (const head of await heads(entry.id)) {
        const data = head.data;
        const items = data[cardsId] as Stored[];
        await setHead(entry.id, head.locale, head.state, {
          ...data,
          [cardsId]: [items[0], { ...items[1], __id: items[0]?.__id }],
        });
      }
      const copy = expectStatus(
        await admin.post(`/api/admin/content/page/${entry.id}/duplicate`, {}),
        201,
      ).json<EntryBody>();
      const en = idsOf((await view('page', copy.id, 'en')).data.cards);
      const fr = idsOf((await view('page', copy.id, 'fr')).data.cards);
      expect(new Set(en).size).toBe(2);
      expect(fr).toEqual(en);
    });

    /** A new revision of the draft whose second card repeats the first card's ID (revisions are immutable). */
    const repeatingRevision = async (entryId: string) => {
      const draft = (await heads(entryId)).find((head) => head.state === 'draft');
      const cardsId = fieldId(doc, 'cards');
      const data = draft?.data as Stored;
      const items = data[cardsId] as Stored[];
      const first = items[0]?.__id as string;
      const repeating = { ...data, [cardsId]: [items[0], { ...items[1], __id: first }] };
      const parent = await db()
        .selectFrom('content_revisions')
        .select('schema_revision_id')
        .where('id', '=', draft?.revision_id as string)
        .executeTakeFirstOrThrow();
      const revision = await contentRevisionsRepository.insert(
        {
          entryId,
          locale: draft?.locale as string,
          schemaRevisionId: parent.schema_revision_id,
          data: repeating,
          reason: 'save',
          authorType: 'system',
          authorId: null,
          parentRevisionId: draft?.revision_id as string,
        },
        db(),
      );
      return { revisionId: revision.id, first, data: repeating, locale: draft?.locale as string };
    };

    it('restores a revision repeating an ID with the first kept and the repeat renewed', async () => {
      const entry = await create('doc', { cards: [{ heading: 'A' }, { heading: 'B' }] });
      const repeating = await repeatingRevision(entry.id);
      expectStatus(
        await admin.post(`/api/admin/content/doc/${entry.id}/revisions/${repeating.revisionId}/restore`, {
          expectedVersion: (await view('doc', entry.id)).version,
        }),
        200,
      );
      const restored = idsOf((await view('doc', entry.id)).data.cards);
      expect(restored[0]).toBe(repeating.first);
      expect(new Set(restored).size).toBe(2);
    });

    it('republishes a snapshot whose revision repeats an ID with the repeat renewed', async () => {
      const entry = await create('doc', { title: 'v1', cards: [{ heading: 'A' }, { heading: 'B' }] });
      // The draft (and so the published version) holds a revision repeating an ID, as stored before IDs were
      // checked.
      const repeating = await repeatingRevision(entry.id);
      await db()
        .updateTable('entry_heads')
        .set({ revision_id: repeating.revisionId, data: repeating.data as never })
        .where('entry_id', '=', entry.id)
        .where('state', '=', 'draft')
        .execute();
      await publish('doc', entry.id);
      const at = Number(
        (await db().selectFrom('publication_state').select('last_seq').executeTakeFirstOrThrow()).last_seq,
      );
      expectStatus(
        await admin.put(`/api/admin/content/doc/${entry.id}`, {
          expectedVersion: (await view('doc', entry.id)).version,
          data: { title: 'v2', cards: [{ heading: 'C' }] },
        }),
        200,
      );
      await publish('doc', entry.id);
      const set = expectStatus(await admin.post(`/api/admin/snapshots/${at}/restore`, {}), 201).json<{
        id: string;
      }>();
      const current = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}`), 200).json<{
        version: number;
      }>();
      expectStatus(
        await admin.post(`/api/admin/change-sets/${set.id}/ship`, {
          expectedVersion: current.version,
          acknowledgeBreaking: true,
          acknowledgeDestructive: true,
        }),
        200,
      );
      const live = await deliver('docs', entry.id);
      expect(live.title).toBe('v1');
      expect(idsOf(live.cards)[0]).toBe(repeating.first);
      expect(new Set(idsOf(live.cards)).size).toBe(2);
    });

    it('refuses an import bundle whose item IDs are malformed or given twice, and takes valid ones as they are', async () => {
      const site = await db().selectFrom('sites').select('id').executeTakeFirstOrThrow();
      const snapshot = (await loadSnapshot(db())).forSite(site.id);
      const cardsId = fieldId(doc, 'cards');
      const heroId = fieldId(doc, 'hero');
      const headingId = fieldId(card, 'heading');
      const context = {
        db: db(),
        actor: { kind: 'system', component: 'transfer' } as const,
        siteId: site.id,
      };
      const bundleEntry = (data: Stored) => {
        const revisionId = randomUUID();
        const now = new Date().toISOString();
        return {
          type: 'entry' as const,
          id: randomUUID(),
          modelId: doc.definition.id,
          ownerAppUserId: null,
          createdAt: now,
          updatedAt: now,
          revisions: [
            {
              id: revisionId,
              locale: 'en',
              parentRevisionId: null,
              reason: 'create' as const,
              data,
              createdAt: now,
            },
          ],
          heads: (['draft', 'published'] as const).map((state) => ({
            locale: 'en',
            state,
            revisionId,
            data,
            autosavedAt: null,
            version: 1,
            createdAt: now,
            updatedAt: now,
            publishedAt: state === 'published' ? now : null,
          })),
        };
      };
      const refusal = async (data: Stored) => {
        const entry = bundleEntry(data);
        const error = await importEntry(context, snapshot, entry).then(
          () => undefined,
          (thrown: unknown) => thrown as { statusCode: number; code: string; details: { path: string } },
        );
        // Nothing of the entry is written.
        expect(await heads(entry.id)).toEqual([]);
        return error && [error.statusCode, error.code, error.details.path];
      };
      expect(
        await refusal({
          [cardsId]: [
            { __id: 'AAAAAAAAAAAA', [headingId]: 'A' },
            { __id: 'AAAAAAAAAAAA', [headingId]: 'B' },
          ],
        }),
      ).toEqual([400, 'BUNDLE_INVALID', `/en/draft/${cardsId}/1/__id`]);
      // Across fields of one version too.
      expect(
        await refusal({ [cardsId]: [{ __id: 'BBBBBBBBBBBB' }], [heroId]: { __id: 'BBBBBBBBBBBB' } }),
      ).toEqual([400, 'BUNDLE_INVALID', `/en/draft/${heroId}/__id`]);
      for (const odd of [5, null, '', 'x'.repeat(65), { a: 1 }, ['x'], true]) {
        expect(await refusal({ [heroId]: { __id: odd, [headingId]: 'H' } })).toEqual([
          400,
          'BUNDLE_INVALID',
          `/en/draft/${heroId}/__id`,
        ]);
      }
      const valid = bundleEntry({
        [cardsId]: [
          { __id: 'z'.repeat(64), [headingId]: 'A' },
          { __id: 'AAAAAAAAAAAA', [headingId]: 'B' },
        ],
      });
      expect(await importEntry(context, snapshot, valid)).toBe('added');
      for (const head of await heads(valid.id)) {
        expect((head.data[cardsId] as Stored[]).map((item) => item.__id)).toEqual([
          'z'.repeat(64),
          'AAAAAAAAAAAA',
        ]);
      }
      expect(await importEntry(context, snapshot, valid)).toBe('unchanged');
    });
  });

  describe('H6: a conversion keeps the IDs items read with, the same in draft and published', () => {
    /** A published entry of `page` stored before item IDs existed, and the IDs a read gives it now. */
    const legacyPage = async (data: Record<string, unknown>) => {
      const entry = await create('page', { title: 't', ...data }, 'en');
      await publish('page', entry.id);
      await makeLegacy(entry.id);
      return {
        id: entry.id,
        draft: (await view('page', entry.id)).data,
        live: await deliver('pages', entry.id),
      };
    };

    it('a single component made a list keeps its ID (CONV5)', async () => {
      const before = await legacyPage({
        hero: { heading: 'H' },
        cards: [{ heading: 'A' }, { heading: 'B' }],
      });
      expect(idsOf(before.live.hero)).toEqual(idsOf(before.draft.hero));
      await editField(page, 'hero', (field) => ({
        ...field,
        settings: { ...(field.settings as Stored), repeatable: true },
      }));
      const draft = await view('page', before.id);
      const live = await deliver('pages', before.id);
      expect(idsOf(draft.data.hero)).toEqual(idsOf(before.draft.hero));
      expect(idsOf(live.hero)).toEqual(idsOf(before.draft.hero));
      expect(idsOf(live.cards)).toEqual(idsOf(before.draft.cards));
      expect(draft.status).toBe('published');
      const written = await request('PUT', `/api/content/pages/${before.id}`, {
        expectedVersion: draft.version,
        data: { hero: [{ id: idsOf(live.hero)[0], heading: 'H2' }] },
      });
      expect(written.statusCode, written.body).toBe(200);
    });

    it('a list made a single component keeps the ID of its first item (CONV7)', async () => {
      const before = await legacyPage({ strip: [{ heading: 'S1' }, { heading: 'S2' }] });
      await editField(page, 'strip', (field) => ({
        ...field,
        settings: { ...(field.settings as Stored), repeatable: false },
      }));
      const draft = await view('page', before.id);
      expect(idsOf(draft.data.strip)).toEqual([idsOf(before.draft.strip)[0]]);
      expect(idsOf((await deliver('pages', before.id)).strip)).toEqual([idsOf(before.draft.strip)[0]]);
      expect(draft.status).toBe('published');
    });

    it('a sub-field type change keeps the IDs of the items it converts', async () => {
      const before = await legacyPage({
        tiles: [
          { label: 'a', num: '1' },
          { label: 'b', num: '2' },
        ],
      });
      await editDefinition('components', tile.definition.id, (definition) => ({
        ...definition,
        fields: definition.fields.map((field) => {
          if (field.apiKey !== 'num') {
            return field;
          }
          const { editor: _editor, ...rest } = field as Stored;
          return { ...rest, type: 'integer' } as never;
        }),
      }));
      const draft = await view('page', before.id);
      // The values change (the items' content with them), the IDs stay.
      expect((draft.data.tiles as Item[]).map((item) => item.num)).not.toEqual(['1', '2']);
      expect(idsOf(draft.data.tiles)).toEqual(idsOf(before.draft.tiles));
      expect(idsOf((await deliver('pages', before.id)).tiles)).toEqual(idsOf(before.draft.tiles));
      expect(draft.status).toBe('published');
    });

    it('a localized field made shared keeps the IDs of the primary locale, and each published version its own', async () => {
      const entry = await create('page', { title: 'en', blocks: [{ heading: 'E1' }] }, 'en');
      expectStatus(
        await admin.put(`/api/admin/content/page/${entry.id}`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'fr', blocks: [{ heading: 'F1' }, { heading: 'F2' }] },
        }),
        200,
      );
      await publish('page', entry.id, ['en', 'fr']);
      await makeLegacy(entry.id);
      const en = idsOf((await view('page', entry.id, 'en')).data.blocks);
      const fr = idsOf((await deliver('pages', entry.id, 'fr')).blocks);
      await editField(page, 'blocks', (field) => ({ ...field, localized: false }));
      expect(idsOf((await view('page', entry.id, 'en')).data.blocks)).toEqual(en);
      expect(idsOf((await view('page', entry.id, 'fr')).data.blocks)).toEqual(en);
      expect(idsOf((await deliver('pages', entry.id, 'en')).blocks)).toEqual(en);
      expect(idsOf((await deliver('pages', entry.id, 'fr')).blocks)).toEqual(fr);
      expect((await view('page', entry.id, 'en')).status).toBe('published');
    });

    it('a content type made not localized keeps the IDs of its localized fields', async () => {
      const entry = await create('memo', { notes: [{ heading: 'N1' }, { heading: 'N2' }] }, 'en');
      await publish('memo', entry.id);
      await makeLegacy(entry.id);
      const before = idsOf((await view('memo', entry.id)).data.notes);
      await editDefinition('models', memo.definition.id, (definition) => ({
        ...definition,
        localized: false,
      }));
      const draft = await view('memo', entry.id);
      expect(idsOf(draft.data.notes)).toEqual(before);
      expect(idsOf((await deliver('memos', entry.id)).notes)).toEqual(before);
      expect(draft.status).toBe('published');
    });
  });
});
