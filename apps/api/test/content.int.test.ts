import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const richText = (text: string) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
});

describe('admin content API', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string', required: true }],
    });
    await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'quote',
        label: 'Quote',
        fields: [
          { apiKey: 'text', label: 'Text', type: 'text', required: true },
          {
            apiKey: 'by',
            label: 'By',
            type: 'relation',
            settings: { target: author.definition.id, cardinality: 'one' },
          },
        ],
      },
      'components',
    );
    const quote = (await admin.get('/api/admin/components')).json<{ items: ModelBody[] }>()
      .items[0] as ModelBody;
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'slug', label: 'Slug', type: 'slug', unique: true },
        { apiKey: 'views', label: 'Views', type: 'integer', defaultValue: 0 },
        { apiKey: 'price', label: 'Price', type: 'decimal' },
        { apiKey: 'publishedOn', label: 'Published on', type: 'datetime' },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'quotes',
          label: 'Quotes',
          type: 'component',
          settings: { component: quote.definition.id, repeatable: true },
        },
      ],
      display: {},
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const create = (modelKey: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    admin.post(`/api/admin/content/${modelKey}`, { data, ...extra });

  it('creates, reads, updates with the expected version and keeps history', async () => {
    const ada = expectStatus(await create('author', { name: 'Ada' }), 201).json<EntryBody>();
    const created = expectStatus(
      await create('article', {
        title: 'Hello',
        slug: 'hello',
        price: '12.50',
        publishedOn: '2026-10-01T10:00:00+02:00',
        body: richText('Hi there'),
        author: ada.id,
        quotes: [{ text: 'Quoted', by: ada.id }],
      }),
      201,
    ).json<EntryBody>();
    expect(created).toMatchObject({
      status: 'draft',
      version: 1,
      data: {
        title: 'Hello',
        views: 0,
        price: '12.50',
        publishedOn: '2026-10-01T08:00:00.000Z',
        author: ada.id,
        quotes: [{ text: 'Quoted', by: ada.id }],
      },
    });

    const updated = expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: 1,
        data: { title: 'Hello again' },
      }),
      200,
    ).json<EntryBody>();
    expect(updated).toMatchObject({ version: 2, data: { title: 'Hello again', slug: 'hello' } });

    const stale = await admin.put(`/api/admin/content/article/${created.id}`, {
      expectedVersion: 1,
      data: { title: 'x' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'CONTENT_VERSION_CONFLICT', details: { currentVersion: 2 } },
    });

    const revisions = (await admin.get(`/api/admin/content/article/${created.id}/revisions`)).json<{
      items: Array<{ id: string; reason: string }>;
    }>();
    expect(revisions.items.map((item) => item.reason)).toEqual(['save', 'create']);

    const restored = expectStatus(
      await admin.post(
        `/api/admin/content/article/${created.id}/revisions/${revisions.items[1]?.id}/restore`,
        {
          expectedVersion: 2,
        },
      ),
      200,
    ).json<EntryBody>();
    expect(restored).toMatchObject({ version: 3, data: { title: 'Hello' } });
  });

  it('publish refuses a draft that moved past the version the caller saw', async () => {
    const created = expectStatus(await create('article', { title: 'Seen in tab A' }), 201).json<EntryBody>();
    // Tab B saves (version 2) after tab A loaded version 1.
    expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: 1,
        data: { title: 'Saved in tab B' },
      }),
      200,
    );
    const publishPath = `/api/admin/content/article/${created.id}/publish`;
    const stale = await admin.post(publishPath, { expectedVersion: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'CONTENT_VERSION_CONFLICT', details: { expectedVersion: 1, currentVersion: 2 } },
    });
    const unchanged = expectStatus(
      await admin.get(`/api/admin/content/article/${created.id}`),
      200,
    ).json<EntryBody>();
    expect(unchanged).toMatchObject({ status: 'draft', publishedAt: null });

    // The stale version is checked before validation: an invalid draft still answers 409, not 422.
    expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: 2,
        autosave: true,
        data: { title: null },
      }),
      200,
    );
    expect((await admin.post(publishPath, { expectedVersion: 2 })).statusCode).toBe(409);
    expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: 3,
        data: { title: 'Saved in tab B' },
      }),
      200,
    );

    // Bad combinations are refused outright.
    for (const body of [
      { expectedVersion: 4, expectedVersions: { en: 4 } },
      { expectedVersions: { fr: 4 } },
    ]) {
      const refused = await admin.post(publishPath, body);
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ error: { code: 'INVALID_EXPECTED_VERSION' } });
    }

    const published = expectStatus(
      await admin.post(publishPath, { expectedVersion: 4 }),
      200,
    ).json<EntryBody>();
    expect(published).toMatchObject({ status: 'published', data: { title: 'Saved in tab B' } });

    // Without a version, publish keeps publishing the current draft.
    expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: published.version,
        data: { title: 'Published unguarded' },
      }),
      200,
    );
    expect(expectStatus(await admin.post(publishPath, {}), 200).json<EntryBody>()).toMatchObject({
      status: 'published',
      data: { title: 'Published unguarded' },
    });
  });

  it('autosave moves the draft without a revision and without enforcing required', async () => {
    const created = expectStatus(await create('article', { title: 'Draft' }), 201).json<EntryBody>();
    const autosaved = expectStatus(
      await admin.put(`/api/admin/content/article/${created.id}`, {
        expectedVersion: 1,
        autosave: true,
        data: { title: null },
      }),
      200,
    ).json<EntryBody & { autosaved: boolean }>();
    expect(autosaved).toMatchObject({ version: 2, autosaved: true, data: { title: null } });
    const revisions = (await admin.get(`/api/admin/content/article/${created.id}/revisions`)).json<{
      items: unknown[];
    }>();
    expect(revisions.items).toHaveLength(1);
    // An explicit save enforces required again.
    const save = await admin.put(`/api/admin/content/article/${created.id}`, {
      expectedVersion: 2,
      data: {},
    });
    expect(save.statusCode).toBe(422);
    expect(save.json()).toMatchObject({
      error: { code: 'CONTENT_INVALID', details: { issues: [{ path: '/title', code: 'REQUIRED' }] } },
    });
  });

  it('rejects invalid values, unknown fields and missing relation targets with paths', async () => {
    const response = await create('article', {
      title: 42,
      nope: true,
      price: '1.2.3',
      author: '00000000-0000-4000-8000-000000000000',
      body: { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content: [{ type: 'script' }] } },
    });
    expect(response.statusCode).toBe(422);
    const issues = response.json<{ error: { details: { issues: Array<{ path: string; code: string }> } } }>()
      .error.details.issues;
    expect(issues).toEqual([
      { path: '/nope', code: 'UNKNOWN_FIELD', message: expect.any(String) as unknown },
    ]);
    const typed = await create('article', {
      title: 42,
      price: '1.2.3',
      body: { format: 'shapio-richtext', version: 1, doc: { type: 'doc', content: [{ type: 'script' }] } },
    });
    expect(
      typed
        .json<{ error: { details: { issues: Array<{ path: string; code: string }> } } }>()
        .error.details.issues.map((issue) => [issue.path, issue.code]),
    ).toEqual([
      ['/title', 'INVALID_TYPE'],
      ['/price', 'INVALID_TYPE'],
      ['/body/doc/content/0', 'INVALID_RICHTEXT'],
    ]);
    const missing = await create('article', { title: 'x', author: '00000000-0000-4000-8000-000000000000' });
    expect(missing.json()).toMatchObject({
      error: { details: { issues: [{ path: '/author', code: 'RELATION_TARGET_MISSING' }] } },
    });
  });

  it('enforces uniqueness among drafts and frees a value when it changes', async () => {
    const first = expectStatus(await create('article', { title: 'A', slug: 'taken' }), 201).json<EntryBody>();
    const clash = await create('article', { title: 'B', slug: 'taken' });
    expect(clash.statusCode).toBe(422);
    expect(clash.json()).toMatchObject({
      error: { details: { issues: [{ path: '/slug', code: 'NOT_UNIQUE' }] } },
    });
    expectStatus(
      await admin.put(`/api/admin/content/article/${first.id}`, {
        expectedVersion: 1,
        data: { slug: 'moved' },
      }),
      200,
    );
    expectStatus(await create('article', { title: 'B', slug: 'taken' }), 201);
  });

  it('blocks deleting a referenced entry, duplicates and deletes', async () => {
    const ada = expectStatus(await create('author', { name: 'Grace' }), 201).json<EntryBody>();
    const post = expectStatus(
      await create('article', { title: 'Ref', slug: 'ref', author: ada.id }),
      201,
    ).json<EntryBody>();
    const blocked = await admin.delete(`/api/admin/content/author/${ada.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: 'ENTRY_REFERENCED' } });

    const copy = expectStatus(
      await admin.post(`/api/admin/content/article/${post.id}/duplicate`, {}),
      201,
    ).json<EntryBody & { autosaved: boolean }>();
    expect(copy).toMatchObject({ autosaved: true, data: { title: 'Ref', slug: null, author: ada.id } });

    expect((await admin.delete(`/api/admin/content/article/${post.id}`)).statusCode).toBe(204);
    expect((await admin.delete(`/api/admin/content/article/${copy.id}`)).statusCode).toBe(204);
    expect((await admin.get(`/api/admin/content/article/${post.id}`)).statusCode).toBe(404);
    expect((await admin.delete(`/api/admin/content/author/${ada.id}`)).statusCode).toBe(204);
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', 'in', [post.id, ada.id])
      .execute();
    expect(audit.map((row) => row.action).sort()).toEqual(['content.delete', 'content.delete']);
  });

  it('lists drafts with filters, sort and pagination', async () => {
    const list = (await admin.get('/api/admin/content/article?filters[slug][$eq]=hello&pageSize=5')).json<{
      items: EntryBody[];
      pagination: { total: number };
    }>();
    expect(list.items.map((item) => item.data.slug)).toEqual(['hello']);
    expect(list.pagination.total).toBe(1);
    expect((await admin.get('/api/admin/content/article?filters[nope][$eq]=1')).statusCode).toBe(400);
    expect((await admin.get('/api/admin/content/article?sort=title:asc')).json()).toMatchObject({
      error: { code: 'INVALID_QUERY' },
    });
    expect((await admin.get('/api/admin/content/missing')).statusCode).toBe(404);
    void fieldIdOf;
  });

  it('publishing writes the outbox event and the audit row in the same transaction', async () => {
    const entry = expectStatus(await create('author', { name: 'Linus' }), 201).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/author/${entry.id}/publish`, {}), 200);
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select(['type', 'payload'])
      .where('aggregate_id', '=', entry.id)
      .orderBy('id')
      .execute();
    expect(events.map((event) => event.type)).toEqual(['entry.created', 'entry.published']);
    expect(events[1]?.payload).toMatchObject({
      modelKey: 'author',
      locale: 'en',
      snapshot: expect.any(Number) as unknown,
    });
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', entry.id)
      .execute();
    expect(audit.map((row) => row.action)).toEqual(['content.publish']);
  });

  it('publishing a draft that is already live changes nothing: no snapshot, event or publication', async () => {
    const entry = expectStatus(
      await create('author', { name: 'Grace' }, { publish: true }),
      201,
    ).json<EntryBody>();
    const seq = async () =>
      Number(
        (
          await database.current.db
            .selectFrom('publication_state')
            .select('last_seq')
            .executeTakeFirstOrThrow()
        ).last_seq,
      );
    const countOf = async (table: 'outbox_events' | 'publication_log') =>
      table === 'outbox_events'
        ? (
            await database.current.db
              .selectFrom('outbox_events')
              .select('id')
              .where('aggregate_id', '=', entry.id)
              .where('type', '=', 'entry.published')
              .execute()
          ).length
        : (
            await database.current.db
              .selectFrom('publication_log')
              .select('entry_id')
              .where('entry_id', '=', entry.id)
              .execute()
          ).length;
    const before = await seq();

    const again = expectStatus(await admin.post(`/api/admin/content/author/${entry.id}/publish`, {}), 200);
    expect(again.json<EntryBody>()).toMatchObject({ status: 'published', data: { name: 'Grace' } });
    await Promise.all(
      Array.from({ length: 5 }, async () =>
        expectStatus(await admin.post(`/api/admin/content/author/${entry.id}/publish`, {}), 200),
      ),
    );
    expect(await seq()).toBe(before);
    expect(await countOf('outbox_events')).toBe(1);
    expect(await countOf('publication_log')).toBe(1);

    // Autosaved work on the same revision is a change: publishing it moves the snapshot.
    expectStatus(
      await admin.put(`/api/admin/content/author/${entry.id}`, {
        expectedVersion: entry.version,
        autosave: true,
        data: { name: 'Grace H.' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/author/${entry.id}/publish`, {}), 200);
    expect(await seq()).toBe(before + 1);
    expect(await countOf('outbox_events')).toBe(2);
  });

  const auditOf = async (entryId: string) =>
    (
      await database.current.db
        .selectFrom('audit_events')
        .select(['action', 'metadata'])
        .where('target_id', '=', entryId)
        .orderBy('seq')
        .execute()
    ).map((row) => ({
      action: row.action,
      metadata: (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<
        string,
        unknown
      >,
    }));

  it('create and publish writes one publish audit row, through the admin and the delivery write API', async () => {
    const viaAdmin = expectStatus(
      await create('author', { name: 'Barbara' }, { publish: true }),
      201,
    ).json<EntryBody>();
    expect(await auditOf(viaAdmin.id)).toEqual([
      {
        action: 'content.publish',
        metadata: expect.objectContaining({ modelKey: 'author', locales: ['en'], via: 'create' }) as unknown,
      },
    ]);

    const viaDelivery = expectStatus(
      await admin.post('/api/content/authors', { data: { name: 'Frances' }, publish: true }),
      201,
    ).json<{ data: { id: string; status: string } }>().data;
    expect(viaDelivery.status).toBe('published');
    expect((await auditOf(viaDelivery.id)).map((row) => row.action)).toEqual(['content.publish']);

    // A create without publish on a model with drafts is a save: recorded as a revision, not audited.
    const draft = expectStatus(await create('author', { name: 'Radia' }), 201).json<EntryBody>();
    expect(await auditOf(draft.id)).toEqual([]);
  });

  it('a create on a model without drafts is audited as a publish; later saves are not', async () => {
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      draftAndPublish: false,
      fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
    });
    const note = expectStatus(await create('note', { text: 'first' }), 201).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/note/${note.id}`, {
        expectedVersion: note.version,
        data: { text: 'second' },
      }),
      200,
    );
    expect(await auditOf(note.id)).toEqual([
      {
        action: 'content.publish',
        metadata: expect.objectContaining({ modelKey: 'note', via: 'create' }) as unknown,
      },
    ]);
  });
});
