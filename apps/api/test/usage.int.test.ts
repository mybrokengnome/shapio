import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createRetentionJobHandlers, ensureRetentionScheduled } from '../src/jobs/retention.js';
import { createWorker } from '../src/jobs/worker.js';
import * as publicationsRepository from '../src/repositories/publications.js';
import * as usageRepository from '../src/repositories/usage.js';
import { consumersOf, writeUsageBatch } from '../src/services/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type UsageBody = {
  tracking: boolean;
  fields: Array<{
    fieldPath: string;
    apiKeyPath: string | null;
    reads: number;
    principals: Array<{ principalKey: string; tokenName?: string; reads: number; selection: string }>;
  }>;
  principals: Array<{ principalKey: string; requests: number; lastSnapshot: number | null }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Field usage from delivery traffic (plan developer-face §5): counting, flushing, the API and retention. */
describe('field usage', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let author: ModelBody;
  let article: ModelBody;
  let siteToken: string;
  let otherToken: string;
  let post: EntryBody;

  const deliver = (url: string, token: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const usage = async () => {
    await testApp.app.usage.flush();
    return expectStatus(
      await admin.get(`/api/admin/usage/fields?modelId=${article.definition.id}&days=7`),
      200,
    ).json<UsageBody>();
  };
  const tokenKeyOf = async (name: 'site' | 'other') => {
    const rows = await database.current.db
      .selectFrom('api_tokens')
      .select(['id', 'name'])
      .orderBy('created_at')
      .execute();
    const delivery = rows.filter((row) => row.name.startsWith('test token'));
    return `token:${(name === 'site' ? delivery[0] : delivery[1])?.id ?? ''}`;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'body', label: 'Body', type: 'text' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    siteToken = await createDeliveryToken(database.current.db, [
      { modelId: article.definition.id },
      { modelId: author.definition.id },
    ]);
    otherToken = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
    const writer = expectStatus(
      await admin.post('/api/admin/content/author', { data: { name: 'Ada' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/author/${writer.id}/publish`, {}), 200);
    post = expectStatus(
      await admin.post('/api/admin/content/article', {
        data: { title: 'Hello', body: 'Text', author: writer.id },
      }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/article/${post.id}/publish`, {}), 200);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('counts REST reads by token: explicit fields, whole-model reads and populated targets', async () => {
    expectStatus(await deliver('/api/content/articles?fields=title', siteToken), 200);
    expectStatus(await deliver('/api/content/articles?fields=title,author&populate=author', siteToken), 200);
    const pinned = await publicationsRepository.currentSeq(PRIMARY_SITE_ID, database.current.db);
    expectStatus(await deliver(`/api/content/articles/${post.id}?snapshot=${pinned}`, otherToken), 200);
    // Admin reads (here an admin-scope API token) are not consumers.
    expectStatus(await admin.get('/api/content/articles'), 200);

    const body = await usage();
    const site = await tokenKeyOf('site');
    const other = await tokenKeyOf('other');
    const byPath = new Map(body.fields.map((field) => [field.apiKeyPath, field]));
    expect(byPath.get('title')?.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalKey: site, reads: 2, selection: 'explicit' }),
        expect.objectContaining({ principalKey: other, reads: 1, selection: 'implicit' }),
      ]),
    );
    expect(
      byPath.get('title')?.principals.find((principal) => principal.principalKey === site)?.tokenName,
    ).toMatch(/^test token/);
    expect(byPath.get('body')?.principals).toEqual([
      expect.objectContaining({ principalKey: other, selection: 'implicit' }),
    ]);
    expect(byPath.get('author.name')?.principals).toEqual([
      expect.objectContaining({ principalKey: site, reads: 1, selection: 'implicit' }),
    ]);
    expect(body.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalKey: site, requests: 2, lastSnapshot: null }),
        expect.objectContaining({ principalKey: other, requests: 1, lastSnapshot: pinned }),
      ]),
    );
    expect(body.tracking).toBe(true);
  });

  it('counts GraphQL selections once per operation, fragments included', async () => {
    const before = (await usage()).fields.find((field) => field.apiKeyPath === 'body')?.reads ?? 0;
    const result = await graphql(
      testApp.app,
      `{ articles { nodes { ...Parts } } article(id: "${post.id}") { body } }
       fragment Parts on Article { body author { name } }`,
      { headers: { authorization: `Bearer ${siteToken}` } },
    );
    expect(result.body.errors).toBeUndefined();
    const body = await usage();
    const site = await tokenKeyOf('site');
    const bodyField = body.fields.find((field) => field.apiKeyPath === 'body');
    expect(bodyField?.reads).toBe(before + 1);
    expect(bodyField?.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalKey: site, selection: 'explicit', reads: 1 }),
      ]),
    );
  });

  it('answers consumersOf for change-set reviews, including relation paths', async () => {
    const site = await tokenKeyOf('site');
    const nameId = fieldIdOf(author, 'name');
    const [title, name, unread] = await consumersOf(
      [fieldIdOf(article, 'title'), nameId, '00000000-0000-4000-8000-000000000000'],
      7,
      { siteId: PRIMARY_SITE_ID, network: true },
    );
    expect(title?.principals.map((principal) => principal.principalKey)).toContain(site);
    expect(name?.principals).toEqual([expect.objectContaining({ principalKey: site })]);
    expect(unread).toEqual({
      fieldId: '00000000-0000-4000-8000-000000000000',
      principals: [],
      otherSites: null,
    });
  });

  it('upserts concurrent flushes additively', async () => {
    const day = usageDayOf(new Date());
    const row = {
      day,
      siteId: PRIMARY_SITE_ID,
      modelId: article.definition.id,
      fieldPath: 'upsert-test',
      principalKey: 'anonymous',
      selection: 'explicit' as const,
      reads: 3,
      lastReadAt: new Date(),
    };
    await Promise.all([
      writeUsageBatch(database.current.db, { fieldReads: [row], tokenReads: [] }),
      writeUsageBatch(database.current.db, { fieldReads: [row], tokenReads: [] }),
    ]);
    const rows = await usageRepository.fieldUsageForModel(
      PRIMARY_SITE_ID,
      article.definition.id,
      day,
      database.current.db,
    );
    expect(rows.find((candidate) => candidate.fieldPath === 'upsert-test')?.reads).toBe(6);
  });

  it('is gated by tokens.manage and validates the model', async () => {
    expect(
      (
        await testApp.app.inject({
          method: 'GET',
          url: `/api/admin/usage/fields?modelId=${article.definition.id}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await admin.get('/api/admin/usage/fields?modelId=00000000-0000-4000-8000-000000000000')).statusCode,
    ).toBe(404);
  });

  it('prunes buckets older than USAGE_RETENTION_DAYS', async () => {
    const old = usageDayOf(new Date(Date.now() - 100 * DAY_MS));
    const recent = usageDayOf(new Date(Date.now() - 10 * DAY_MS));
    await writeUsageBatch(database.current.db, {
      fieldReads: [old, recent].map((day) => ({
        day,
        siteId: PRIMARY_SITE_ID,
        modelId: article.definition.id,
        fieldPath: `retention-${day}`,
        principalKey: 'anonymous',
        selection: 'explicit' as const,
        reads: 1,
        lastReadAt: new Date(),
      })),
      tokenReads: [old, recent].map((day) => ({
        day,
        siteId: PRIMARY_SITE_ID,
        principalKey: `retention-${day}`,
        requests: 1,
        lastSnapshot: null,
        lastReadAt: new Date(),
      })),
    });
    const worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers(
        createRetentionJobHandlers(database.current.db, { days: 30, usageDays: 90 }),
      ),
      workerId: 'usage-retention-test',
      concurrency: 1,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
    const { job } = await ensureRetentionScheduled(database.current.db);
    await waitFor(async () => {
      await worker.tick();
      const row = await database.current.db
        .selectFrom('jobs')
        .select('status')
        .where('id', '=', job.id)
        .executeTakeFirst();
      return row?.status === 'succeeded';
    });
    await worker.stop(500);
    const paths = (
      await usageRepository.fieldUsageForModel(
        PRIMARY_SITE_ID,
        article.definition.id,
        '2000-01-01',
        database.current.db,
      )
    ).map((row) => row.fieldPath);
    expect(paths).toContain(`retention-${recent}`);
    expect(paths).not.toContain(`retention-${old}`);
    const principals = (
      await usageRepository.principalSummaries(PRIMARY_SITE_ID, '2000-01-01', database.current.db)
    ).map((row) => row.principalKey);
    expect(principals).toContain(`retention-${recent}`);
    expect(principals).not.toContain(`retention-${old}`);
  });
});
