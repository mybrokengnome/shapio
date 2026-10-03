import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
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

type NotEmptyBody = { error: { code: string; details: Record<string, number> } };

/** Tables keyed by site whose rows must all go when a site is deleted. */
const SITE_TABLES = [
  'entries',
  'entry_heads',
  'unique_values',
  'publication_log',
  'publication_snapshots',
  'publication_state',
  'content_health_findings',
  'scheduled_publications',
  'media_assets',
  'field_reads',
  'token_reads',
  'app_users',
  'app_user_roles',
  'app_oauth_accounts',
] as const;

/**
 * Deleting a site (sites plan §H): "empty" means no live content. Soft-deleted entries, media assets and app
 * users do not block it; they are purged with the site, history included.
 */
describe('deleting a site with deleted content', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let tag: ModelBody;
  let article: ModelBody;

  /** The admin API on one site (the network admin token names its site with the header). */
  const on = (siteKey: string) => ({
    post: (url: string, payload: unknown) =>
      network.request({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { [SITE_HEADER]: siteKey },
      }),
    delete: (url: string) => network.request({ method: 'DELETE', url, headers: { [SITE_HEADER]: siteKey } }),
  });
  const createEntry = async (siteKey: string, modelKey: string, data: Record<string, unknown>) =>
    expectStatus(
      await on(siteKey).post(`/api/admin/content/${modelKey}`, { data, publish: true }),
      201,
    ).json<EntryBody>();
  const deleteEntry = async (siteKey: string, modelKey: string, id: string) =>
    expectStatus(await on(siteKey).delete(`/api/admin/content/${modelKey}/${id}`), 204);
  const deleteSite = (id: string) => network.delete(`/api/admin/sites/${id}`);
  const notEmptyDetails = (response: LightMyRequestResponse) => {
    expect(response.statusCode).toBe(409);
    const body = response.json<NotEmptyBody>();
    expect(body.error.code).toBe('SITE_NOT_EMPTY');
    return body.error.details;
  };
  /** An app user of the site with a role, an OAuth account, a refresh token and a login code. */
  const insertAppUser = async (siteId: string) => {
    const { db } = database.current;
    const user = await db
      .insertInto('app_users')
      .values({ site_id: siteId, email: `${randomUUID()}@example.com` })
      .returning('id')
      .executeTakeFirstOrThrow();
    const role = await db
      .selectFrom('app_roles')
      .select('id')
      .where('key', '=', 'authenticated')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('app_user_roles')
      .values({ app_user_id: user.id, role_id: role.id, site_id: siteId })
      .execute();
    await db
      .insertInto('app_oauth_accounts')
      .values({ app_user_id: user.id, site_id: siteId, provider: 'github', provider_user_id: randomUUID() })
      .execute();
    const expiresAt = new Date(Date.now() + 60_000);
    await db
      .insertInto('app_refresh_tokens')
      .values({
        app_user_id: user.id,
        family_id: randomUUID(),
        token_hash: randomUUID(),
        expires_at: expiresAt,
      })
      .execute();
    await db
      .insertInto('app_login_codes')
      .values({
        app_user_id: user.id,
        code_hash: randomUUID(),
        code_challenge: 'challenge',
        expires_at: expiresAt,
      })
      .execute();
    return user.id;
  };
  const createSite = async (key: string) =>
    expectStatus(await network.post('/api/admin/sites', { key, name: key }), 201).json<{ id: string }>().id;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    tag = await createDefinition(network, {
      kind: 'collection',
      apiKey: 'tag',
      label: 'Tag',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(network, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'slug', label: 'Slug', type: 'slug', unique: true },
        {
          apiKey: 'tag',
          label: 'Tag',
          type: 'relation',
          settings: { target: tag.definition.id, cardinality: 'one' },
        },
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
      ],
    });
    await runContentSchemaJobs(database.current.db);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('refuses a site with live content, then purges its deleted entries, media and app users with it', async () => {
    const siteId = await createSite('archive');
    const assetId = randomUUID();
    await database.current.db
      .insertInto('media_assets')
      .values({
        id: assetId,
        site_id: siteId,
        mime_type: 'image/png',
        original_filename: 'cover.png',
        size_bytes: '10',
        storage_driver: 'local',
        storage_key: `test/${assetId}`,
        status: 'ready',
      })
      .execute();
    const topic = await createEntry('archive', 'tag', { name: 'News' });
    const story = await createEntry('archive', 'article', {
      title: 'Hello',
      slug: 'hello',
      tag: topic.id,
      cover: assetId,
    });
    await database.current.db
      .insertInto('field_reads')
      .values({
        day: new Date().toISOString().slice(0, 10),
        site_id: siteId,
        model_id: article.definition.id,
        field_path: 'title',
        principal_key: 'reader',
        selection: 'explicit',
        reads: '1',
        last_read_at: new Date(),
      })
      .execute();
    const entryIds = [topic.id, story.id];
    const appUserId = await insertAppUser(siteId);

    expect(notEmptyDetails(await deleteSite(siteId))).toMatchObject({ appUsers: 1 });
    await database.current.db
      .updateTable('app_users')
      .set({ deleted_at: new Date() })
      .where('id', '=', appUserId)
      .execute();

    expect(notEmptyDetails(await deleteSite(siteId))).toMatchObject({ entries: 2, mediaAssets: 1 });
    await deleteEntry('archive', 'article', story.id);
    expect(notEmptyDetails(await deleteSite(siteId))).toMatchObject({ entries: 1 });
    await deleteEntry('archive', 'tag', topic.id);
    expect(notEmptyDetails(await deleteSite(siteId))).toMatchObject({ entries: 0, mediaAssets: 1 });
    await database.current.db
      .updateTable('media_assets')
      .set({ deleted_at: new Date() })
      .where('id', '=', assetId)
      .execute();

    expect((await deleteSite(siteId)).statusCode).toBe(204);
    expect(
      await database.current.db.selectFrom('sites').select('id').where('id', '=', siteId).execute(),
    ).toEqual([]);
    for (const table of SITE_TABLES) {
      const rows = await database.current.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('site_id', '=', siteId)
        .executeTakeFirstOrThrow();
      expect({ table, rows: Number(rows.n) }).toEqual({ table, rows: 0 });
    }
    for (const table of ['app_refresh_tokens', 'app_login_codes'] as const) {
      const rows = await database.current.db
        .selectFrom(table)
        .select('id')
        .where('app_user_id', '=', appUserId)
        .execute();
      expect({ table, rows }).toEqual({ table, rows: [] });
    }
    for (const [table, column] of [
      ['content_revisions', 'entry_id'],
      ['relation_edges', 'source_entry_id'],
      ['relation_edges', 'target_entry_id'],
      ['media_references', 'entry_id'],
    ] as const) {
      const rows = await database.current.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where(column, 'in', entryIds)
        .executeTakeFirstOrThrow();
      expect({ table, column, rows: Number(rows.n) }).toEqual({ table, column, rows: 0 });
    }
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', siteId)
      .where('action', '=', 'site.delete')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('keeps refusing a site with a live entry, and never deletes the primary site', async () => {
    const siteId = await createSite('busy');
    const kept = await createEntry('busy', 'tag', { name: 'Kept' });
    const gone = await createEntry('busy', 'tag', { name: 'Gone' });
    await deleteEntry('busy', 'tag', gone.id);
    expect(notEmptyDetails(await deleteSite(siteId))).toMatchObject({ entries: 1 });
    const live = await database.current.db
      .selectFrom('entries')
      .select('id')
      .where('site_id', '=', siteId)
      .orderBy('id')
      .execute();
    // The refused delete rolled back: the soft-deleted entry is still there too.
    expect(live.map((row) => row.id).sort()).toEqual([kept.id, gone.id].sort());

    const primary = await deleteSite(PRIMARY_SITE_ID);
    expect(primary.statusCode).toBe(409);
    expect(primary.json<NotEmptyBody>().error.code).toBe('SITE_IS_PRIMARY');
  });
});
