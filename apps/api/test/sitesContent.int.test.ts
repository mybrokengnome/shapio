import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import * as publicationsRepository from '../src/repositories/publications.js';
import * as snapshotDiffRepository from '../src/repositories/snapshotDiff.js';
import {
  createDefinition,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ListBody = {
  items: Array<EntryBody & { data: Record<string, unknown> }>;
  pagination: { total: number };
};
type IssuesBody = {
  error: { code: string; details: { issues: Array<{ path: string; code: string; message: string }> } };
};
type SnapshotBody = { seq: number; source: string; changeSet: unknown };

/**
 * Sites as the tenancy boundary of content (plan agentic-ecosystem §H, G2): one instance, one schema, two
 * sites with the same models. Every read, write, uniqueness check, singleton, relation, media reference and
 * snapshot number stays on its own site.
 */
describe('content per site', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let marketingId: string;
  let tag: ModelBody;
  let article: ModelBody;

  /** The admin API on one site (the network admin token names its site with the header). */
  const on = (siteKey: string) => ({
    get: (url: string) => network.request({ method: 'GET', url, headers: { [SITE_HEADER]: siteKey } }),
    post: (url: string, payload: unknown) =>
      network.request({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { [SITE_HEADER]: siteKey },
      }),
    put: (url: string, payload: unknown) =>
      network.request({
        method: 'PUT',
        url,
        payload: payload as object,
        headers: { [SITE_HEADER]: siteKey },
      }),
  });
  const primary = on('default');
  const marketing = on('marketing');

  const create = async (
    site: ReturnType<typeof on>,
    modelKey: string,
    data: Record<string, unknown>,
    publish = false,
  ) =>
    expectStatus(await site.post(`/api/admin/content/${modelKey}`, { data, publish }), 201).json<EntryBody>();
  const seqOf = (siteId: string) => publicationsRepository.currentSeq(siteId, database.current.db);
  const model = (apiKey: string, fields: unknown[], extra: Record<string, unknown> = {}) =>
    createDefinition(network, { kind: 'collection', apiKey, label: apiKey, fields, ...extra });
  const changeModel = async (current: ModelBody, patch: Record<string, unknown>) => {
    const response = await network.put(`/api/admin/models/${current.definition.id}`, {
      definition: { ...current.definition, ...patch },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202]).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
    return response;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    marketingId = expectStatus(
      await network.post('/api/admin/sites', { key: 'marketing', name: 'Marketing' }),
      201,
    ).json<{
      id: string;
    }>().id;
    tag = await model('tag', [{ apiKey: 'name', label: 'Name', type: 'string', filterable: true }]);
    article = await model('article', [
      { apiKey: 'title', label: 'Title', type: 'string', filterable: true, sortable: true },
      { apiKey: 'slug', label: 'Slug', type: 'slug', unique: true },
      {
        apiKey: 'tag',
        label: 'Tag',
        type: 'relation',
        settings: { target: tag.definition.id, cardinality: 'one' },
      },
      { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
    ]);
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists, reads, filters and counts each site’s entries only', async () => {
    const home = await create(primary, 'article', { title: 'Home story', slug: 'story-a' });
    const away = await create(marketing, 'article', { title: 'Marketing story', slug: 'story-b' });

    const listed = (site: ReturnType<typeof on>, query = '') =>
      site
        .get(`/api/admin/content/article${query}`)
        .then((response) => expectStatus(response, 200).json<ListBody>());
    expect((await listed(primary)).items.map((item) => item.id)).toEqual([home.id]);
    expect((await listed(marketing)).items.map((item) => item.id)).toEqual([away.id]);
    expect((await listed(marketing, '?filters[title][$eq]=Home%20story')).items).toEqual([]);

    // Another site's entry is not found, for reads and writes alike (no existence oracle).
    expectStatus(await marketing.get(`/api/admin/content/article/${home.id}`), 404);
    expectStatus(
      await marketing.put(`/api/admin/content/article/${home.id}`, {
        expectedVersion: 1,
        data: { title: 'x' },
      }),
      404,
    );
    expectStatus(
      await marketing.post(`/api/admin/content/article/${home.id}/publish`, { locales: ['en'] }),
      404,
    );
    expectStatus(await primary.get(`/api/admin/content/article/${home.id}`), 200);

    const counts = async (site: ReturnType<typeof on>) =>
      expectStatus(await site.get('/api/admin/content-counts'), 200)
        .json<{ counts: Array<{ modelKey: string; total: number }> }>()
        .counts.find((count) => count.modelKey === 'article')?.total;
    expect(await counts(primary)).toBe(1);
    expect(await counts(marketing)).toBe(1);
  });

  it('keeps unique values per site', async () => {
    await create(primary, 'article', { title: 'One', slug: 'same-slug' });
    await create(marketing, 'article', { title: 'Two', slug: 'same-slug' });
    const duplicate = await primary.post('/api/admin/content/article', {
      data: { title: 'Three', slug: 'same-slug' },
    });
    expect(duplicate.statusCode).toBe(422);
    expect(duplicate.json<IssuesBody>().error.details.issues).toMatchObject([
      { path: '/slug', code: 'NOT_UNIQUE' },
    ]);
  });

  it('rejects a relation target on another site as missing on this site', async () => {
    const otherTag = await create(marketing, 'tag', { name: 'Elsewhere' });
    const response = await primary.post('/api/admin/content/article', {
      data: { title: 'Linked', tag: otherTag.id },
    });
    expect(response.statusCode).toBe(422);
    const [issue, ...others] = response.json<IssuesBody>().error.details.issues;
    expect(others).toEqual([]);
    expect(issue).toMatchObject({ path: '/tag', code: 'RELATION_TARGET_MISSING' });
    expect(issue?.message).toContain('on this site');
    const ownTag = await create(marketing, 'tag', { name: 'Here' });
    await create(marketing, 'article', { title: 'Linked here', tag: ownTag.id });
  });

  it('never populates a relation across sites, even when stored data points there', async () => {
    const otherTag = await create(marketing, 'tag', { name: 'Leaky tag name' });
    const entry = await create(primary, 'article', { title: 'Forged link' });
    // Bypass the validator, as data written before sites (or by hand) could.
    await sql`update entry_heads set data = data || jsonb_build_object(${fieldIdOf(article, 'tag')}::text, ${otherTag.id}::text)
      where entry_id = ${entry.id}::uuid`.execute(database.current.db);
    const read = expectStatus(
      await primary.get(`/api/admin/content/article?populate=tag&filters[title][$eq]=Forged%20link`),
      200,
    );
    expect(read.body).not.toContain('Leaky tag name');
  });

  it('rejects a media asset on another site as missing on this site', async () => {
    const assetId = randomUUID();
    await database.current.db
      .insertInto('media_assets')
      .values({
        id: assetId,
        site_id: marketingId,
        mime_type: 'image/png',
        original_filename: 'cover.png',
        size_bytes: '10',
        storage_driver: 'local',
        storage_key: `test/${assetId}`,
      })
      .execute();
    const response = await primary.post('/api/admin/content/article', {
      data: { title: 'With cover', cover: assetId },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<IssuesBody>().error.details.issues).toEqual([
      expect.objectContaining({
        path: '/cover',
        code: 'MEDIA_MISSING',
        message: `media asset ${assetId} does not exist on this site`,
      }),
    ]);
    await create(marketing, 'article', { title: 'With cover', cover: assetId });
  });

  it('gives a singleton one entry per site', async () => {
    await createDefinition(network, {
      kind: 'singleton',
      apiKey: 'settings',
      label: 'Settings',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    await create(primary, 'settings', { name: 'Primary settings' });
    await create(marketing, 'settings', { name: 'Marketing settings' });
    expectStatus(await marketing.post('/api/admin/content/settings', { data: { name: 'Again' } }), 409);
  });

  it('lets a collection become a singleton when no site holds more than one entry', async () => {
    const pref = await model('pref', [{ apiKey: 'name', label: 'Name', type: 'string' }]);
    await create(primary, 'pref', { name: 'Primary' });
    await create(marketing, 'pref', { name: 'Marketing' });
    await changeModel(pref, { kind: 'singleton' });
    const active = expectStatus(
      await network.get(`/api/admin/models/${pref.definition.id}`),
      200,
    ).json<ModelBody>();
    expect(active.definition.kind).toBe('singleton');
  });

  it('numbers snapshots per site, with a per-site ledger, diff and restore', async () => {
    const before = { primary: await seqOf(PRIMARY_SITE_ID), marketing: await seqOf(marketingId) };
    const entry = await create(primary, 'article', { title: 'Published on primary' }, true);
    expect(await seqOf(PRIMARY_SITE_ID)).toBe(before.primary + 1);
    expect(await seqOf(marketingId)).toBe(before.marketing);

    const ledger = async (site: ReturnType<typeof on>) =>
      expectStatus(await site.get('/api/admin/snapshots'), 200).json<{
        items: SnapshotBody[];
        current: number;
      }>();
    expect((await ledger(primary)).current).toBe(before.primary + 1);
    expect((await ledger(marketing)).current).toBe(before.marketing);
    expect((await ledger(marketing)).items.map((item) => item.seq)).not.toContain(before.primary + 1);
    expectStatus(await marketing.get(`/api/admin/snapshots/${before.primary + 1}`), 404);

    const diff = (siteId: string, from: number, to: number) =>
      snapshotDiffRepository.listChanges(
        { siteId, from, to, limit: 100, modelIds: null },
        database.current.db,
      );
    expect(
      (await diff(PRIMARY_SITE_ID, before.primary, before.primary + 1)).items.map((item) => item.entryId),
    ).toEqual([entry.id]);
    // The same numbers on the other site's ledger say nothing about this entry.
    expect(
      (await diff(marketingId, 0, await seqOf(marketingId))).items.map((item) => item.entryId),
    ).not.toContain(entry.id);

    // Restoring the primary site to before the publication unpublishes this entry only.
    const restore = expectStatus(
      await primary.post(`/api/admin/snapshots/${before.primary}/restore`, {}),
      201,
    ).json<{
      id: string;
    }>();
    const items = await database.current.db
      .selectFrom('change_set_items')
      .select(['entry_id', 'action'])
      .where('change_set_id', '=', restore.id)
      .execute();
    expect(items).toEqual([{ entry_id: entry.id, action: 'unpublish' }]);
    expect(
      (
        await database.current.db
          .selectFrom('change_sets')
          .select('site_id')
          .where('id', '=', restore.id)
          .executeTakeFirstOrThrow()
      ).site_id,
    ).toBe(PRIMARY_SITE_ID);
  });

  it('takes one snapshot per affected site when a schema change converts content, none on untouched sites', async () => {
    const empty = expectStatus(
      await network.post('/api/admin/sites', { key: 'empty', name: 'Empty' }),
      201,
    ).json<{ id: string }>();
    const note = await model('note', [{ apiKey: 'text', label: 'Text', type: 'string' }]);
    await create(primary, 'note', { text: 'Primary draft' });
    await create(marketing, 'note', { text: 'Marketing draft' });
    const before = {
      primary: await seqOf(PRIMARY_SITE_ID),
      marketing: await seqOf(marketingId),
      empty: await seqOf(empty.id),
    };
    // Turning drafts off publishes every draft as it is: an entry-level conversion on both sites.
    await changeModel(note, { draftAndPublish: false });
    expect(await seqOf(PRIMARY_SITE_ID)).toBe(before.primary + 1);
    expect(await seqOf(marketingId)).toBe(before.marketing + 1);
    expect(await seqOf(empty.id)).toBe(before.empty);
    const rows = await database.current.db
      .selectFrom('publication_snapshots')
      .select(['site_id', 'source', 'change_set_id'])
      .where((eb) =>
        eb.or([
          eb.and([eb('site_id', '=', PRIMARY_SITE_ID), eb('seq', '=', String(before.primary + 1))]),
          eb.and([eb('site_id', '=', marketingId), eb('seq', '=', String(before.marketing + 1))]),
        ]),
      )
      .orderBy('site_id')
      .execute();
    expect(rows.map((row) => [row.source, row.change_set_id])).toEqual([
      ['schema', null],
      ['schema', null],
    ]);
    const published = await database.current.db
      .selectFrom('publication_log')
      .innerJoin('entries', 'entries.id', 'publication_log.entry_id')
      .select(['publication_log.site_id', 'publication_log.from_seq'])
      .where('entries.model_id', '=', note.definition.id)
      .execute();
    expect(published.map((row) => [row.site_id, Number(row.from_seq)]).sort()).toEqual(
      [
        [PRIMARY_SITE_ID, before.primary + 1],
        [marketingId, before.marketing + 1],
      ].sort(),
    );
  });
});
