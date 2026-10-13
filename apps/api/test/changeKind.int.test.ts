import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type KindResult = {
  droppedFields: Array<{ id: string; apiKey: string; label: string }>;
  target: { modelId: string; modelKey: string; routeKey: string };
  entry?: EntryBody & { model: string };
};
type DeliveryList = { data: Array<Record<string, unknown>>; meta: { snapshot: number } };

/**
 * Change kind (plan polymorphic-types, D11): Post > Guide, Opinion. An entry moves within its family; values
 * of fields the new kind lacks are dropped after an acknowledgement; history, older snapshots, uniqueness and
 * relation edges stay intact; the move is a new snapshot and an `entry.kind_changed` event.
 */
describe('model inheritance: change kind', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let post: ModelBody;
  let guide: ModelBody;
  let opinion: ModelBody;
  let token: string;

  const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;
  const deliver = (url: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const list = async (url: string) => expectStatus(await deliver(url), 200).json<DeliveryList>();
  const publishNew = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, { data, publish: true }), 201).json<
      EntryBody & { model: string }
    >();
  const changeKind = (modelKey: string, id: string, body: Record<string, unknown>, dryRun = false) =>
    admin.post(`/api/admin/content/${modelKey}/${id}/kind${dryRun ? '?dryRun=1' : ''}`, body);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      pluralApiKey: 'posts',
      label: 'Post',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', unique: true }],
    });
    expectStatus(
      await admin.put(`/api/admin/models/${post.definition.id}`, {
        definition: {
          ...post.definition,
          fields: [
            ...post.definition.fields,
            {
              apiKey: 'seeAlso',
              label: 'See also',
              type: 'relation',
              settings: { target: post.definition.id, cardinality: 'many' },
            },
          ],
        },
        expectedVersion: post.version,
      }),
      200,
    );
    post = (await admin.get(`/api/admin/models/${post.definition.id}`)).json<ModelBody>();
    guide = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'guide',
      pluralApiKey: 'guides',
      label: 'Guide',
      extends: post.definition.id,
      fields: [{ apiKey: 'difficulty', label: 'Difficulty', type: 'string' }],
    });
    opinion = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'opinion',
      pluralApiKey: 'opinions',
      label: 'Opinion',
      extends: post.definition.id,
      fields: [{ apiKey: 'stance', label: 'Stance', type: 'string', defaultValue: 'neutral' }],
    });
    token = await createDeliveryToken(database.current.db, [{ modelId: post.definition.id }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('moves a plain Post to a Guide, then the Guide to an Opinion, keeping history, snapshots and edges', async () => {
    const other = await publishNew('post', { title: 'Other' });
    const entry = await publishNew('post', { title: 'Hello', seeAlso: [other.id] });
    const referrer = await publishNew('post', { title: 'Referrer', seeAlso: [entry.id] });

    // A plain Post becomes a Guide: nothing is dropped.
    const toGuide = expectStatus(
      await changeKind('post', entry.id, { targetModelKey: 'guide', expectedVersion: entry.version }),
      200,
    ).json<KindResult>();
    expect(toGuide.droppedFields).toEqual([]);
    expect(toGuide.target).toEqual({
      modelId: guide.definition.id,
      modelKey: 'guide',
      routeKey: 'posts/guides',
    });
    expect(toGuide.entry).toMatchObject({ model: 'guide', status: 'published', data: { title: 'Hello' } });
    const asGuide = expectStatus(
      await admin.put(`/api/admin/content/guide/${entry.id}`, {
        expectedVersion: toGuide.entry?.version,
        data: { difficulty: 'hard' },
      }),
      200,
    ).json<EntryBody>();
    expectStatus(
      await admin.post(`/api/admin/content/guide/${entry.id}/publish`, { expectedVersion: asGuide.version }),
      200,
    );
    const asGuideLive = await list('/api/content/posts?pageSize=100');
    const snapshotAsGuide = asGuideLive.meta.snapshot;
    expect(asGuideLive.data.find((row) => row.id === entry.id)).toMatchObject({
      __model: 'guide',
      difficulty: 'hard',
    });

    // Guide → Opinion drops `difficulty`: a dry run lists it and writes nothing.
    const current = expectStatus(
      await admin.get(`/api/admin/content/guide/${entry.id}`),
      200,
    ).json<EntryBody>();
    const dry = expectStatus(
      await changeKind(
        'post',
        entry.id,
        { targetModelKey: 'opinion', expectedVersion: current.version },
        true,
      ),
      200,
    ).json<KindResult>();
    expect(dry.droppedFields).toEqual([
      { id: fieldIdOf(guide, 'difficulty'), apiKey: 'difficulty', label: 'Difficulty' },
    ]);
    expect(dry.entry).toBeUndefined();
    // Without the acknowledgement, or with a stale version, nothing moves.
    expect(
      (await changeKind('guide', entry.id, { targetModelKey: 'opinion', expectedVersion: current.version }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await changeKind('guide', entry.id, {
          targetModelKey: 'opinion',
          expectedVersion: current.version - 1,
          acknowledgeDroppedFields: true,
        })
      ).statusCode,
    ).toBe(409);
    const moved = expectStatus(
      await changeKind('guide', entry.id, {
        targetModelKey: 'opinion',
        expectedVersion: current.version,
        acknowledgeDroppedFields: true,
      }),
      200,
    ).json<KindResult>();
    expect(moved.entry).toMatchObject({
      model: 'opinion',
      status: 'published',
      data: { title: 'Hello', stance: 'neutral' },
    });
    expect(moved.entry?.data).not.toHaveProperty('difficulty');

    // Delivery serves it as an Opinion now, and as a Guide at the older snapshot.
    expect((await deliver(`/api/content/posts/guides/${entry.id}`)).statusCode).toBe(404);
    expect(
      expectStatus(await deliver(`/api/content/posts/opinions/${entry.id}`), 200).json<{ data: unknown }>()
        .data,
    ).toMatchObject({ __model: 'opinion', stance: 'neutral' });
    const pinned = await list(`/api/content/posts?snapshot=${snapshotAsGuide}&pageSize=100`);
    expect(pinned.data.find((row) => row.id === entry.id)).toMatchObject({
      __model: 'guide',
      difficulty: 'hard',
    });
    expect(
      (await list(`/api/content/posts/guides?snapshot=${snapshotAsGuide}`)).data.map((row) => row.id),
    ).toEqual([entry.id]);

    // History keeps the dropped value.
    const revisions = await database.current.db
      .selectFrom('content_revisions')
      .select(['data', 'reason'])
      .where('entry_id', '=', entry.id)
      .execute();
    const difficultyId = fieldIdOf(guide, 'difficulty');
    expect(
      revisions.some((revision) => json<Record<string, unknown>>(revision.data)[difficultyId] === 'hard'),
    ).toBe(true);
    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(['model_id', 'state', 'revision_id'])
      .where('entry_id', '=', entry.id)
      .execute();
    expect(heads.map((head) => head.model_id)).toEqual([opinion.definition.id, opinion.definition.id]);
    // The draft and published heads shared a revision; they share the new one.
    expect(new Set(heads.map((head) => head.revision_id)).size).toBe(1);

    // Uniqueness holds across the family, under the new kind.
    const claims = await database.current.db
      .selectFrom('unique_values')
      .select(['model_id'])
      .where('entry_id', '=', entry.id)
      .execute();
    expect(claims.length).toBeGreaterThan(0);
    expect(new Set(claims.map((claim) => claim.model_id))).toEqual(new Set([opinion.definition.id]));
    const duplicate = await admin.post('/api/admin/content/guide', {
      data: { title: 'Hello' },
      publish: true,
    });
    expect(duplicate.statusCode).toBeGreaterThanOrEqual(400);

    // Edges both ways are intact: its own link, and the referrer's link to it.
    const edges = await database.current.db
      .selectFrom('relation_edges')
      .select(['source_entry_id', 'target_entry_id'])
      .where((eb) => eb.or([eb('source_entry_id', '=', entry.id), eb('target_entry_id', '=', entry.id)]))
      .execute();
    expect(edges).toEqual(
      expect.arrayContaining([
        { source_entry_id: entry.id, target_entry_id: other.id },
        { source_entry_id: referrer.id, target_entry_id: entry.id },
      ]),
    );
    const populated = expectStatus(
      await deliver(`/api/content/posts/${referrer.id}?populate=seeAlso`),
      200,
    ).json<{ data: { seeAlso: Array<Record<string, unknown>> } }>();
    expect(populated.data.seeAlso).toEqual([expect.objectContaining({ id: entry.id, __model: 'opinion' })]);

    // The event, for webhooks and deployments, and the audit row.
    const event = await database.current.db
      .selectFrom('outbox_events')
      .select('payload')
      .where('aggregate_id', '=', entry.id)
      .where('type', '=', 'entry.kind_changed')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(json(event.payload)).toMatchObject({
      from: 'guide',
      to: 'opinion',
      routeKey: 'posts/opinions',
      ancestors: ['post'],
      fromRouteKey: 'posts/guides',
      droppedFields: ['difficulty'],
      published: true,
    });
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('metadata')
      .where('target_id', '=', entry.id)
      .where('action', '=', 'content.change_kind')
      .execute();
    expect(audit).toHaveLength(2);
  });

  it('refuses a kind outside the family, and while the entry is in an unshipped change set', async () => {
    const outsider = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const entry = await publishNew('post', { title: 'Pending' });
    expect(
      (
        await changeKind('post', entry.id, {
          targetModelKey: outsider.definition.apiKey,
          expectedVersion: entry.version,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await changeKind('post', entry.id, { targetModelKey: 'post', expectedVersion: entry.version }))
        .statusCode,
    ).toBe(400);
    const set = expectStatus(await admin.post('/api/admin/change-sets', { title: 'Later' }), 201).json<{
      id: string;
    }>();
    expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/items`, {
        modelKey: 'post',
        entryId: entry.id,
        action: 'unpublish',
      }),
      200,
    );
    const blocked = await changeKind('post', entry.id, {
      targetModelKey: 'guide',
      expectedVersion: entry.version,
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'KIND_CHANGE_BLOCKED' } });
  });

  it('restores an older revision of another kind without its foreign values', async () => {
    const entry = await publishNew('opinion', { title: 'Restorable', stance: 'for' });
    const toGuide = expectStatus(
      await changeKind('opinion', entry.id, {
        targetModelKey: 'guide',
        expectedVersion: entry.version,
        acknowledgeDroppedFields: true,
      }),
      200,
    ).json<KindResult>();
    // "Restore this version" on the Opinion revision: the Guide has no `stance`, so it does not come back.
    const restored = expectStatus(
      await admin.post(`/api/admin/content/guide/${entry.id}/revisions/${entry.revisionId}/restore`, {
        expectedVersion: toGuide.entry?.version,
      }),
      200,
    ).json<EntryBody>();
    expect(restored.data).toMatchObject({ title: 'Restorable' });
    const stanceId = fieldIdOf(opinion, 'stance');
    const draft = await database.current.db
      .selectFrom('entry_heads')
      .select('data')
      .where('entry_id', '=', entry.id)
      .where('state', '=', 'draft')
      .executeTakeFirstOrThrow();
    expect(json<Record<string, unknown>>(draft.data)).not.toHaveProperty(stanceId);
    // Back to an Opinion: the dropped value stays dropped (its default fills the field, not the old value).
    const back = expectStatus(
      await changeKind('guide', entry.id, {
        targetModelKey: 'opinion',
        expectedVersion: restored.version,
        acknowledgeDroppedFields: true,
      }),
      200,
    ).json<KindResult>();
    expect(back.entry?.data).toMatchObject({ title: 'Restorable', stance: 'neutral' });
  });
});

describe('model inheritance: change kind on a localized family', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let guide: ModelBody;
  const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const post = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      pluralApiKey: 'posts',
      label: 'Post',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', localized: true },
        { apiKey: 'slug', label: 'Slug', type: 'string', localized: false },
      ],
    });
    guide = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'guide',
      pluralApiKey: 'guides',
      label: 'Guide',
      extends: post.definition.id,
      localized: true,
      fields: [{ apiKey: 'level', label: 'Level', type: 'string', localized: true }],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('moves every locale, draft and published, and rolls each published locale into one snapshot', async () => {
    const en = expectStatus(
      await admin.post('/api/admin/content/guide', {
        locale: 'en',
        data: { title: 'Hello', slug: 'hello', level: 'easy' },
      }),
      201,
    ).json<EntryBody>();
    const fr = expectStatus(
      await admin.put(`/api/admin/content/guide/${en.id}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { title: 'Bonjour', level: 'facile' },
      }),
      200,
    ).json<EntryBody>();
    const live = expectStatus(
      await admin.post(`/api/admin/content/guide/${en.id}/publish`, {
        locales: ['en', 'fr'],
        expectedVersions: { en: en.version, fr: fr.version },
      }),
      200,
    ).json<EntryBody>();
    // An unpublished change in French: its draft and published heads now differ.
    const frDraft = expectStatus(
      await admin.put(`/api/admin/content/guide/${en.id}`, {
        locale: 'fr',
        expectedVersion: (await admin.get(`/api/admin/content/guide/${en.id}?locale=fr`)).json<EntryBody>()
          .version,
        data: { title: 'Salut' },
      }),
      200,
    ).json<EntryBody>();
    const seqBefore = await database.current.db
      .selectFrom('publication_state')
      .select('last_seq')
      .executeTakeFirstOrThrow();

    const moved = expectStatus(
      await admin.post(`/api/admin/content/guide/${en.id}/kind`, {
        targetModelKey: 'post',
        locale: 'fr',
        expectedVersion: frDraft.version,
        acknowledgeDroppedFields: true,
      }),
      200,
    ).json<KindResult>();
    expect(moved.droppedFields.map((field) => field.apiKey)).toEqual(['level']);
    expect(moved.entry).toMatchObject({
      model: 'post',
      locale: 'fr',
      data: { title: 'Salut', slug: 'hello' },
    });

    const heads = await database.current.db
      .selectFrom('entry_heads')
      .select(['locale', 'state', 'model_id', 'revision_id', 'data'])
      .where('entry_id', '=', en.id)
      .orderBy('locale')
      .orderBy('state')
      .execute();
    expect(heads.map((head) => [head.locale, head.state])).toEqual([
      ['en', 'draft'],
      ['en', 'published'],
      ['fr', 'draft'],
      ['fr', 'published'],
    ]);
    const levelId = fieldIdOf(guide, 'level');
    for (const head of heads) {
      expect(head.model_id).not.toBe(guide.definition.id);
      expect(json<Record<string, unknown>>(head.data)).not.toHaveProperty(levelId);
    }
    const revisionOf = (locale: string, state: string) =>
      heads.find((head) => head.locale === locale && head.state === state)?.revision_id;
    // English draft and published shared a revision and still do; French ones differ.
    expect(revisionOf('en', 'draft')).toBe(revisionOf('en', 'published'));
    expect(revisionOf('fr', 'draft')).not.toBe(revisionOf('fr', 'published'));
    expect(moved.entry?.locales.map((state) => [state.locale, state.status])).toEqual([
      ['en', 'published'],
      ['fr', 'modified'],
    ]);
    // Both published locales moved at one new snapshot number.
    const open = await database.current.db
      .selectFrom('publication_log')
      .select(['locale', 'from_seq', 'model_id'])
      .where('entry_id', '=', en.id)
      .where('to_seq', 'is', null)
      .orderBy('locale')
      .execute();
    expect(open.map((row) => row.locale)).toEqual(['en', 'fr']);
    expect(new Set(open.map((row) => String(row.from_seq)))).toEqual(
      new Set([String(Number(seqBefore.last_seq) + 1)]),
    );
    expect(live.status).toBe('published');
  });
});
