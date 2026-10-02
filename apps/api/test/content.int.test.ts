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
});
