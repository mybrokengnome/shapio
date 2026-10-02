import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONTENT_HEALTH_JOBS,
  contentHealthOutboxSubscriber,
  createContentHealthJobHandlers,
} from '../src/jobs/contentHealth.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { drainJobs } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Check = {
  rule: string;
  severity: string;
  path?: string;
  code?: string;
  params: Record<string, unknown>;
};
type Preflight = { locales: { locale: string; ready: boolean; checks: Check[] }[]; entry: Check[] };
type Finding = { entryId: string; rule: string; locale: string; entryTitle: string | null; path?: string };
type Person = { userId: string; name: string; you: boolean; locale: string | null };

const HEALTH_TYPES = Object.values(CONTENT_HEALTH_JOBS);

/** The entry document's endpoints (plan editor-experience §2, §5, §9) against a real database. */
describe('editor experience: pre-flight, content health, presence, counts, model permissions', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let worker: Worker | undefined;
  let article: ModelBody;
  let tag: ModelBody;
  let image: MediaAssetBody;

  const richText = (...content: unknown[]) => ({
    format: 'shapio-richtext',
    version: 1,
    doc: { type: 'doc', content },
  });
  const inlineImage = (alt: string | null) => ({
    type: 'image',
    attrs: { mediaId: image.id, alt, title: null },
  });

  const preflight = async (entryId: string, locales?: string[]) =>
    expectStatus(
      await admin.post(`/api/admin/content/article/${entryId}/preflight`, locales ? { locales } : {}),
      200,
    ).json<Preflight>();

  const findings = async (client: SchemaClient = admin, query = '') =>
    expectStatus(await client.get(`/api/admin/content-health${query}`), 200).json<{ items: Finding[] }>()
      .items;

  const drain = () => {
    if (!worker) {
      throw new Error('worker not started');
    }
    return drainJobs(worker, database.current.db, { types: HEALTH_TYPES });
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const token = await createRoleToken(database.current.db, 'owner');
    admin = schemaClient(testApp.app, token);
    image = await uploadAsset(
      testApp.app,
      { authorization: `Bearer ${token}` },
      {
        file: await createPng(16, 16),
        filename: 'photo.png',
        mimeType: 'image/png',
      },
    );
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    tag = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'tag',
      label: 'Tag',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true, localized: true },
        { apiKey: 'slug', label: 'Slug', type: 'slug', unique: true, localized: true },
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
        { apiKey: 'body', label: 'Body', type: 'richtext', localized: true },
        {
          apiKey: 'tag',
          label: 'Tag',
          type: 'relation',
          settings: { target: tag.definition.id, cardinality: 'one' },
        },
      ],
    });
    worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers(
        createContentHealthJobHandlers({ db: database.current.db, staleDays: 14, log: silentLogger }),
      ),
      subscribers: [contentHealthOutboxSubscriber],
      workerId: `test-${randomUUID()}`,
      concurrency: 2,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
  });
  afterAll(async () => {
    await worker?.stop(1000);
    await testApp.app.close();
  });

  describe('publish pre-flight', () => {
    it('reports errors and warnings without publishing, and is ready once they are fixed', async () => {
      const draftTag = expectStatus(
        await admin.post('/api/admin/content/tag', { data: { name: 'News' } }),
        201,
      ).json<EntryBody>();
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', {
          data: { title: 'Hello', cover: image.id, body: richText(inlineImage(null)), tag: draftTag.id },
        }),
        201,
      ).json<EntryBody>();
      // Autosave an empty title: the draft can't be published.
      expectStatus(
        await admin.put(`/api/admin/content/article/${entry.id}`, {
          expectedVersion: entry.version,
          data: { title: null },
          autosave: true,
        }),
        200,
      );

      const before = await preflight(entry.id);
      expect(before.locales).toHaveLength(1);
      const [en] = before.locales;
      expect(en).toMatchObject({ locale: 'en', ready: false });
      expect(en?.checks.map((check) => `${check.severity} ${check.rule} ${check.path ?? ''}`)).toEqual([
        'error requiredEmpty /title',
        'warning altMissing /cover',
        'warning altMissing /body',
        'warning relationUnpublished /tag',
      ]);
      expect(before.entry).toEqual([
        { rule: 'localeMissing', severity: 'warning', params: { locale: 'fr' } },
      ]);
      // Nothing was published and the findings were recorded.
      const read = expectStatus(
        await admin.get(`/api/admin/content/article/${entry.id}`),
        200,
      ).json<EntryBody>();
      expect(read.status).toBe('draft');
      expect((await findings(admin, '?rule=altMissing')).filter((f) => f.entryId === entry.id)).toHaveLength(
        2,
      );

      const current = expectStatus(
        await admin.get(`/api/admin/content/article/${entry.id}`),
        200,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/article/${entry.id}`, {
          expectedVersion: current.version,
          data: { title: 'Hello again' },
        }),
        200,
      );
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/media/assets/${image.id}`,
          payload: { expectedVersion: image.version, alt: 'A photo' },
        }),
        200,
      );
      expectStatus(await admin.post(`/api/admin/content/tag/${draftTag.id}/publish`, {}), 200);

      const after = await preflight(entry.id);
      expect(after.locales[0]).toEqual({ locale: 'en', ready: true, checks: [] });
      expect((await findings(admin)).filter((f) => f.entryId === entry.id).map((f) => f.rule)).toEqual([
        'localeMissing',
      ]);
    });

    it('reports a unique value another entry already publishes, per locale', async () => {
      const first = expectStatus(
        await admin.post('/api/admin/content/article', {
          data: { title: 'One', slug: 'shared' },
          publish: true,
        }),
        201,
      ).json<EntryBody>();
      // The first entry's draft moves on; its published version keeps the slug.
      expectStatus(
        await admin.put(`/api/admin/content/article/${first.id}`, {
          expectedVersion: first.version,
          data: { slug: 'moved' },
        }),
        200,
      );
      const second = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Two', slug: 'shared' } }),
        201,
      ).json<EntryBody>();
      const result = await preflight(second.id);
      expect(result.locales[0]?.ready).toBe(false);
      expect(result.locales[0]?.checks).toContainEqual({
        rule: 'uniqueConflict',
        severity: 'error',
        code: 'NOT_UNIQUE',
        path: '/slug',
        params: { fieldId: fieldIdOf(article, 'slug') },
      });
      expect(
        (await admin.post(`/api/admin/content/article/${second.id}/publish`, {})).json<{
          error: { code: string };
        }>().error.code,
      ).toBe('CONTENT_INVALID');
      // The same slug in another locale is fine.
      const french = expectStatus(
        await admin.put(`/api/admin/content/article/${second.id}`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'Deux', slug: 'shared' },
        }),
        200,
      ).json<EntryBody>();
      expect((await preflight(french.id, ['fr'])).locales[0]).toMatchObject({ locale: 'fr', ready: true });
    });

    it('reports a requested locale without a version as an error and needs the publish permission', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Only English' } }),
        201,
      ).json<EntryBody>();
      expect((await preflight(entry.id, ['fr'])).locales[0]).toEqual({
        locale: 'fr',
        ready: false,
        checks: [{ rule: 'localeMissing', severity: 'error', params: { locale: 'fr' } }],
      });
      const reader = schemaClient(
        testApp.app,
        await createTokenForRole(
          database.current.db,
          await createRole(database.current.db, 'admin', [
            { action: 'read', modelId: article.definition.id },
          ]),
        ),
      );
      expect((await reader.post(`/api/admin/content/article/${entry.id}/preflight`, {})).statusCode).toBe(
        403,
      );
    });
  });

  describe('content health', () => {
    it('records findings from entry events and resolves them when the rule passes', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', {
          data: { title: 'Gallery', body: richText(inlineImage(null)) },
        }),
        201,
      ).json<EntryBody>();
      // The library alt text from the pre-flight test covers this image: no alt finding, but no French.
      await drain();
      const open = (await findings()).filter((finding) => finding.entryId === entry.id);
      expect(open).toEqual([
        expect.objectContaining({ rule: 'localeMissing', locale: 'fr', entryTitle: 'Gallery' }),
      ]);

      expectStatus(
        await admin.put(`/api/admin/content/article/${entry.id}`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'Galerie' },
        }),
        200,
      );
      await drain();
      expect((await findings()).filter((finding) => finding.entryId === entry.id)).toEqual([]);
      const resolved = await database.current.db
        .selectFrom('content_health_findings')
        .select(['rule', 'resolved_at'])
        .where('entry_id', '=', entry.id)
        .execute();
      expect(resolved).toEqual([{ rule: 'localeMissing', resolved_at: expect.any(Date) as unknown }]);
    });

    it('re-checks existing entries after a schema activation (a field becomes required)', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/tag', { data: {} }),
        201,
      ).json<EntryBody>();
      const definition = expectStatus(
        await admin.get(`/api/admin/models/${tag.definition.id}`),
        200,
      ).json<ModelBody>();
      const changed = await admin.put(`/api/admin/models/${tag.definition.id}`, {
        definition: {
          ...definition.definition,
          fields: definition.definition.fields.map((field) => ({
            ...field,
            required: true,
            defaultValue: 'Untitled',
          })),
        },
        expectedVersion: definition.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      });
      expect(changed.statusCode, changed.body).toBeLessThan(300);
      await runContentSchemaJobs(database.current.db);
      await drain();
      // The backfill gave the entry a value; the sweep ran and found nothing to report.
      const sweeps = await database.current.db
        .selectFrom('jobs')
        .select(['status'])
        .where('type', '=', CONTENT_HEALTH_JOBS.sweep)
        .execute();
      expect(sweeps.some((job) => job.status === 'succeeded')).toBe(true);
      expect((await findings()).filter((finding) => finding.entryId === entry.id)).toEqual([]);
    });

    it('lists findings only for models the caller may read, and honours row filters', async () => {
      const entry = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Lonely' } }),
        201,
      ).json<EntryBody>();
      await drain();
      expect((await findings()).some((finding) => finding.entryId === entry.id)).toBe(true);
      const tagReader = schemaClient(
        testApp.app,
        await createTokenForRole(
          database.current.db,
          await createRole(database.current.db, 'admin', [{ action: 'read', modelId: tag.definition.id }]),
        ),
      );
      expect(await findings(tagReader)).toEqual([]);
      const ownReader = schemaClient(
        testApp.app,
        await createTokenForRole(
          database.current.db,
          await createRole(database.current.db, 'admin', [
            { action: 'read', modelId: article.definition.id, condition: 'ownedByPrincipal' },
          ]),
        ),
      );
      expect(await findings(ownReader)).toEqual([]);
      const summary = expectStatus(await admin.get('/api/admin/content-health/summary'), 200).json<{
        rules: { rule: string; count: number }[];
      }>();
      expect(summary.rules.find((row) => row.rule === 'localeMissing')?.count).toBeGreaterThan(0);
      expect(
        expectStatus(await ownReader.get('/api/admin/content-health/summary'), 200).json<{
          rules: unknown[];
        }>().rules,
      ).toEqual([]);
    });
  });

  describe('presence', () => {
    let first: TestSession;
    let second: TestSession;
    let entryId: string;

    const as = (session: TestSession, method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
      testApp.app.inject({
        method,
        url,
        headers: session.headers,
        ...(payload ? { payload: payload } : {}),
      });

    beforeAll(async () => {
      first = await login(testApp.app, await createAdmin(database.current.db));
      second = await login(testApp.app, await createAdmin(database.current.db));
      entryId = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Shared' } }),
        201,
      ).json<EntryBody>().id;
    });

    it('shows who else has the entry open, per tab, and forgets tabs that leave or go quiet', async () => {
      const url = `/api/admin/presence/article/${entryId}`;
      expect(expectStatus(await as(first, 'PUT', url, { tabId: 'tab-a', locale: 'en' }), 200).json()).toEqual(
        {
          people: [],
        },
      );
      const seenBySecond = expectStatus(await as(second, 'PUT', url, { tabId: 'tab-b' }), 200).json<{
        people: Person[];
      }>();
      expect(seenBySecond.people).toEqual([
        expect.objectContaining({ name: 'Test Admin', locale: 'en', you: false }),
      ]);
      // The first person's other tab is "you".
      const otherTab = expectStatus(await as(first, 'PUT', url, { tabId: 'tab-c' }), 200).json<{
        people: Person[];
      }>();
      expect(otherTab.people.map((person) => person.you).sort()).toEqual([false, true]);

      const listed = expectStatus(await as(first, 'GET', '/api/admin/presence/article'), 200).json<{
        entries: { entryId: string; people: Person[] }[];
      }>();
      expect(listed.entries.find((row) => row.entryId === entryId)?.people).toHaveLength(2);

      expectStatus(await as(second, 'DELETE', `${url}?tabId=tab-b`), 204);
      expect(expectStatus(await as(first, 'GET', url), 200).json<{ people: Person[] }>().people).toEqual([
        expect.objectContaining({ you: true }),
      ]);
      // Tabs that stop sending heartbeats drop out after the TTL.
      await database.current.db
        .updateTable('editor_presence')
        .set({ last_seen_at: new Date(Date.now() - 60_000) })
        .where('entry_id', '=', entryId)
        .execute();
      expect(expectStatus(await as(second, 'GET', url), 200).json()).toEqual({ people: [] });
    });

    it('needs an admin session and a readable entry', async () => {
      expect((await admin.put(`/api/admin/presence/article/${entryId}`, { tabId: 'token' })).statusCode).toBe(
        401,
      );
      expect(
        (await as(first, 'PUT', `/api/admin/presence/article/${randomUUID()}`, { tabId: 'x' })).statusCode,
      ).toBe(404);
      expect(
        (await as(first, 'PUT', `/api/admin/presence/article/${entryId}`, { tabId: 'bad tab!' })).statusCode,
      ).toBe(400);
    });
  });

  describe('counts and model permissions', () => {
    it('counts entries of readable models, through the row filter where there is one', async () => {
      const all = expectStatus(await admin.get('/api/admin/content-counts'), 200);
      expect(all.headers['cache-control']).toBe('private, max-age=60');
      const counts = all.json<{ counts: { modelKey: string; total: number }[] }>().counts;
      const articles = await database.current.db
        .selectFrom('entries')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('model_id', '=', article.definition.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      expect(counts.find((row) => row.modelKey === 'article')?.total).toBe(Number(articles.count));

      const ownReader = schemaClient(
        testApp.app,
        await createTokenForRole(
          database.current.db,
          await createRole(database.current.db, 'admin', [
            { action: 'read', modelId: article.definition.id, condition: 'ownedByPrincipal' },
          ]),
        ),
      );
      expect(expectStatus(await ownReader.get('/api/admin/content-counts'), 200).json()).toEqual({
        counts: [{ modelId: article.definition.id, modelKey: 'article', total: 0 }],
      });
    });

    it('lists the content actions per model on /me', async () => {
      const owner = await login(testApp.app, await createAdmin(database.current.db));
      const me = expectStatus(
        await testApp.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: owner.headers }),
        200,
      ).json<{ modelPermissions: Record<string, string[]> }>();
      expect(me.modelPermissions[article.definition.id]).toEqual([
        'read',
        'create',
        'update',
        'delete',
        'publish',
        'schemaManage',
      ]);

      const roleId = await createRole(database.current.db, 'admin', [
        { action: 'read', modelId: tag.definition.id },
      ]);
      const reader = await createAdmin(database.current.db, {
        roleKeys: [
          (
            await database.current.db
              .selectFrom('admin_roles')
              .select('key')
              .where('id', '=', roleId)
              .executeTakeFirstOrThrow()
          ).key,
        ],
      });
      const session = await login(testApp.app, reader);
      const limited = expectStatus(
        await testApp.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: session.headers }),
        200,
      ).json<{ modelPermissions: Record<string, string[]> }>();
      expect(limited.modelPermissions).toEqual({ [tag.definition.id]: ['read'] });
    });
  });
  describe('place list: author, status, author filter, locale statuses', () => {
    type ListItem = {
      id: string;
      status: string;
      author: { id: string; name: string } | null;
      locales?: unknown[];
    };
    type ListBody = { items: ListItem[]; pagination: { total: number } };

    it('adds the author, filters by status and author, and lists every locale of localized entries', async () => {
      await createDefinition(admin, {
        kind: 'collection',
        apiKey: 'note',
        label: 'Note',
        fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
      });
      const writer = await createAdmin(database.current.db);
      const session = await login(testApp.app, writer);
      const asWriter = (method: 'GET' | 'POST', url: string, payload?: object) =>
        testApp.app.inject({ method, url, headers: session.headers, ...(payload ? { payload } : {}) });

      const drafted = expectStatus(
        await asWriter('POST', '/api/admin/content/note', { data: { text: 'a' } }),
        201,
      ).json<EntryBody>();
      const published = expectStatus(
        await admin.post('/api/admin/content/note', { data: { text: 'b' }, publish: true }),
        201,
      ).json<EntryBody>();
      const modified = expectStatus(
        await admin.post('/api/admin/content/note', { data: { text: 'c' }, publish: true }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/note/${modified.id}`, {
          expectedVersion: modified.version,
          data: { text: 'c2' },
          autosave: true,
        }),
        200,
      );

      const list = async (query: string) =>
        expectStatus(await admin.get(`/api/admin/content/note${query}`), 200).json<ListBody>();
      const all = await list('');
      expect(all.items.find((item) => item.id === drafted.id)?.author).toEqual({
        id: writer.id,
        name: 'Test Admin',
      });
      expect(all.items.find((item) => item.id === published.id)?.author).toBeNull();
      expect(all.items[0]).not.toHaveProperty('locales');

      for (const [status, entry] of [
        ['draft', drafted],
        ['published', published],
        ['modified', modified],
      ] as const) {
        const filtered = await list(`?status=${status}`);
        expect(filtered.items.map((item) => [item.id, item.status])).toEqual([[entry.id, status]]);
        expect(filtered.pagination.total).toBe(1);
      }
      const byAuthor = await list(`?author=${writer.id}`);
      expect(byAuthor.items.map((item) => item.id)).toEqual([drafted.id]);

      expect((await admin.get('/api/admin/content/note?status=archived')).statusCode).toBe(400);
      expect((await admin.get('/api/admin/content/note?author=someone')).statusCode).toBe(400);
      const delivery = await admin.get('/api/content/notes?status=draft');
      expect(delivery.statusCode).toBe(400);

      const localized = expectStatus(
        await admin.post('/api/admin/content/article', { data: { title: 'Bilingual' }, publish: true }),
        201,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/article/${localized.id}`, {
          locale: 'fr',
          expectedVersion: null,
          data: { title: 'Bilingue' },
        }),
        200,
      );
      const articles = expectStatus(
        await admin.get('/api/admin/content/article?pageSize=100'),
        200,
      ).json<ListBody>();
      expect(articles.items.find((item) => item.id === localized.id)?.locales).toEqual([
        { locale: 'en', status: 'published' },
        { locale: 'fr', status: 'draft' },
      ]);
    });
  });
});
