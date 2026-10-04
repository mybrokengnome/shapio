import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import type { Worker } from '../src/jobs/worker.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import * as publicationsRepository from '../src/repositories/publications.js';
import { consumersOf } from '../src/services/usage.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import {
  createSharedDefinition,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
  startReceiver,
  type Receiver,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Publishing per site (sites plan §H, package G5): change sets, schedules, webhooks, preview tokens and usage
 * belong to one site; a schema change set ships one snapshot on every site whose content it converts.
 */
type ChangeSet = { id: string; status: string; version: number; shippedSnapshot: number | null };
type SiteBody = { id: string; key: string };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

describe('publishing per site (plan §H, G5)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let token: string;
  let owner: TestSession;
  let siteA: SchemaClient;
  let siteB: SchemaClient;
  let other: SiteBody;
  let article: ModelBody;
  let worker: Worker;
  let receiver: Receiver;

  /** A client of the network admin token that names `siteKey` on every request. */
  const clientFor = (siteKey: string): SchemaClient => {
    const base = schemaClient(testApp.app, token);
    const request: SchemaClient['request'] = (options) =>
      base.request({ ...options, headers: { [SITE_HEADER]: siteKey, ...options.headers } });
    return {
      request,
      get: (url) => request({ method: 'GET', url }),
      post: (url, payload) => request({ method: 'POST', url, payload: payload as object }),
      put: (url, payload) => request({ method: 'PUT', url, payload: payload as object }),
      delete: (url) => request({ method: 'DELETE', url }),
    };
  };
  const asSession = (session: TestSession, siteKey: string) => ({
    post: (url: string, payload: unknown) =>
      testApp.app.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { ...session.headers, [SITE_HEADER]: siteKey },
      }),
    put: (url: string, payload: unknown) =>
      testApp.app.inject({
        method: 'PUT',
        url,
        payload: payload as object,
        headers: { ...session.headers, [SITE_HEADER]: siteKey },
      }),
  });
  /** An admin whose only role is `roleKey`, assigned on `siteId` alone. */
  const siteOnlyAdmin = async (roleKey: string, siteId: string) => {
    const admin = await createAdmin(database.current.db, { roleKeys: [] });
    const [role] = await adminRolesRepository.findByKeys([roleKey], database.current.db);
    await database.current.db
      .insertInto('admin_user_roles')
      .values({ admin_user_id: admin.id, role_id: role?.id ?? '', site_id: siteId })
      .execute();
    return login(testApp.app, admin);
  };

  /** `body` is plain text until the schema test converts it to rich text; later entries leave it out. */
  const createArticle = async (client: SchemaClient, title: string, body?: string) =>
    expectStatus(
      await client.post('/api/admin/content/article', {
        data: { title, ...(body === undefined ? {} : { body }) },
      }),
      201,
    ).json<EntryBody>();
  const publish = async (client: SchemaClient, id: string) =>
    expectStatus(await client.post(`/api/admin/content/article/${id}/publish`, {}), 200);
  const createSet = async (client: SchemaClient, title: string) =>
    expectStatus(await client.post('/api/admin/change-sets', { title }), 201).json<ChangeSet>();
  const getSet = async (client: SchemaClient, id: string) =>
    expectStatus(await client.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSet>();
  const addItem = (client: SchemaClient, setId: string, entryId: string) =>
    client.post(`/api/admin/change-sets/${setId}/items`, { modelKey: 'article', entryId, action: 'publish' });
  const ship = async (client: SchemaClient, setId: string) =>
    client.post(`/api/admin/change-sets/${setId}/ship`, {
      expectedVersion: (await getSet(client, setId)).version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
  const seqOf = (siteId: string) => publicationsRepository.currentSeq(siteId, database.current.db);
  const drain = (types: string[]) => drainJobs(worker, database.current.db, { types });

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    token = await createRoleToken(database.current.db);
    owner = await login(testApp.app, await createAdmin(database.current.db));
    siteA = clientFor('default');
    other = expectStatus(
      await siteA.post('/api/admin/sites', { key: 'b', name: 'Site B' }),
      201,
    ).json<SiteBody>();
    siteB = clientFor('b');
    worker = createPublishingWorker({ db: database.current.db, app: testApp.app });
    receiver = await startReceiver();
    article = await createSharedDefinition(siteA, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    });
  });

  afterAll(async () => {
    await worker.stop(500);
    await receiver.close();
    await testApp.app.close();
  });

  describe('change sets', () => {
    it('are isolated per site: listed, read and changed only on their own site', async () => {
      const onA = await createSet(siteA, 'A launch');
      const onB = await createSet(siteB, 'B launch');
      const listedOnA = expectStatus(await siteA.get('/api/admin/change-sets'), 200).json<{
        items: Array<{ id: string }>;
      }>();
      expect(listedOnA.items.map((item) => item.id)).toContain(onA.id);
      expect(listedOnA.items.map((item) => item.id)).not.toContain(onB.id);
      const crossRead = await siteA.get(`/api/admin/change-sets/${onB.id}`);
      expect(crossRead.statusCode).toBe(404);
      expect(codeOf(crossRead)).toBe('CHANGE_SET_NOT_FOUND');
      expect((await siteA.get(`/api/admin/change-sets/${onB.id}/review`)).statusCode).toBe(404);
      expect((await siteA.post(`/api/admin/change-sets/${onB.id}/discard`, {})).statusCode).toBe(404);
      expect(await getSet(siteB, onB.id)).toMatchObject({ status: 'open' });
      const row = await database.current.db
        .selectFrom('change_sets')
        .select('site_id')
        .where('id', '=', onB.id)
        .executeTakeFirstOrThrow();
      expect(row.site_id).toBe(other.id);
    });

    it("cannot include another site's entry", async () => {
      const entryOnB = await createArticle(siteB, 'Only on B');
      const set = await createSet(siteA, 'A with B entry');
      const added = await addItem(siteA, set.id, entryOnB.id);
      expect(added.statusCode).toBe(404);
      expect(codeOf(added)).toBe('ENTRY_NOT_FOUND');
      expect(expectStatus(await addItem(siteB, (await createSet(siteB, 'B own')).id, entryOnB.id), 200));
    });

    it("shipping on one site takes a snapshot there and leaves the other site's sequence alone", async () => {
      const entry = await createArticle(siteA, 'Ships on A');
      const set = await createSet(siteA, 'A ship');
      expectStatus(await addItem(siteA, set.id, entry.id), 200);
      const [beforeA, beforeB] = [await seqOf(PRIMARY_SITE_ID), await seqOf(other.id)];
      const shipped = expectStatus(await ship(siteA, set.id), 200).json<ChangeSet>();
      expect(shipped.status).toBe('shipped');
      expect(shipped.shippedSnapshot).toBe(beforeA + 1);
      expect(await seqOf(PRIMARY_SITE_ID)).toBe(beforeA + 1);
      expect(await seqOf(other.id)).toBe(beforeB);
      const event = await database.current.db
        .selectFrom('outbox_events')
        .select('site_id')
        .where('type', '=', 'change_set.shipped')
        .where('aggregate_id', '=', set.id)
        .executeTakeFirstOrThrow();
      expect(event.site_id).toBe(PRIMARY_SITE_ID);
      const audit = await database.current.db
        .selectFrom('audit_events')
        .select('site_id')
        .where('action', '=', 'change_set.ship')
        .where('target_id', '=', set.id)
        .executeTakeFirstOrThrow();
      expect(audit.site_id).toBe(PRIMARY_SITE_ID);
    });

    it('a schema item needs schema permission on every site', async () => {
      const siteAdmin = await siteOnlyAdmin('admin', other.id);
      const set = await createSet(siteB, 'Site admin schema');
      const response = await asSession(siteAdmin, 'b').put(
        `/api/admin/change-sets/${set.id}/schema/${article.definition.id}`,
        {
          category: 'model',
          definition: { ...article.definition, label: 'Story' },
          baseVersion: article.version,
        },
      );
      expect(response.statusCode).toBe(403);
    });

    it('a schema change set reviews affected entries per site and ships one snapshot per affected site', async () => {
      for (const client of [siteA, siteB]) {
        await publish(client, (await createArticle(client, 'Converted', 'Plain body')).id);
      }
      const bodyId = fieldIdOf(article, 'body');
      const set = await createSet(siteA, 'Rich bodies everywhere');
      const converted = {
        ...article.definition,
        fields: article.definition.fields.map((field) =>
          field.id === bodyId ? { ...field, type: 'richtext', settings: {}, editor: undefined } : field,
        ),
      };
      expectStatus(
        await siteA.put(`/api/admin/change-sets/${set.id}/schema/${article.definition.id}`, {
          category: 'model',
          definition: converted,
          baseVersion: article.version,
        }),
        200,
      );
      const review = expectStatus(await siteA.get(`/api/admin/change-sets/${set.id}/review`), 200).json<{
        schema: Array<{ affectedEntriesBySite: Array<{ site: { key: string }; entries: number }> }>;
      }>();
      const bySite = review.schema[0]?.affectedEntriesBySite ?? [];
      expect(bySite.map((row) => row.site.key).sort()).toEqual(['b', 'default']);
      expect(bySite.every((row) => row.entries > 0)).toBe(true);

      const [beforeA, beforeB] = [await seqOf(PRIMARY_SITE_ID), await seqOf(other.id)];
      expect([200, 202]).toContain((await ship(siteA, set.id)).statusCode);
      await drain([PUBLISHING_JOBS.changeSetShip, 'schema.followUp']);
      expect(await getSet(siteA, set.id)).toMatchObject({ status: 'shipped', shippedSnapshot: beforeA + 1 });
      expect(await seqOf(PRIMARY_SITE_ID)).toBe(beforeA + 1);
      expect(await seqOf(other.id)).toBe(beforeB + 1);
      const ledger = await database.current.db
        .selectFrom('publication_snapshots')
        .select(['site_id', 'source', 'change_set_id'])
        .where('change_set_id', '=', set.id)
        .orderBy('site_id')
        .execute();
      expect(ledger).toEqual(
        expect.arrayContaining([
          { site_id: PRIMARY_SITE_ID, source: 'change_set', change_set_id: set.id },
          { site_id: other.id, source: 'conversion', change_set_id: set.id },
        ]),
      );
      article = expectStatus(
        await siteA.get(`/api/admin/models/${article.definition.id}`),
        200,
      ).json<ModelBody>();
    });
  });

  it('runs a schedule on its own site', async () => {
    const entry = await createArticle(siteB, 'Scheduled on B');
    const clock = createTestClock();
    const created = expectStatus(
      await siteB.post('/api/admin/publishing/schedules', {
        modelKey: 'article',
        entryId: entry.id,
        action: 'publish',
        runAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      201,
    ).json<{ id: string }>();
    const listedOnA = expectStatus(await siteA.get('/api/admin/publishing/schedules'), 200).json<{
      items: Array<{ id: string }>;
    }>();
    expect(listedOnA.items.map((item) => item.id)).not.toContain(created.id);
    expect((await siteA.delete(`/api/admin/publishing/schedules/${created.id}`)).statusCode).toBe(404);

    const [beforeA, beforeB] = [await seqOf(PRIMARY_SITE_ID), await seqOf(other.id)];
    const timed = createPublishingWorker({ db: database.current.db, app: testApp.app, now: clock.now });
    try {
      clock.advance(61_000);
      await drainJobs(timed, database.current.db, {
        types: [PUBLISHING_JOBS.scheduledPublication],
        now: clock.now,
      });
    } finally {
      await timed.stop(500);
    }
    const row = await database.current.db
      .selectFrom('scheduled_publications')
      .select(['status', 'site_id', 'snapshot_seq'])
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'done', site_id: other.id, snapshot_seq: String(beforeB + 1) });
    expect(await seqOf(other.id)).toBe(beforeB + 1);
    expect(await seqOf(PRIMARY_SITE_ID)).toBe(beforeA);
  });

  describe('webhooks', () => {
    const createWebhook = async (client: SchemaClient, name: string, network = false) =>
      expectStatus(
        await client.post('/api/admin/webhooks', {
          name,
          url: `${receiver.url}/${name}`,
          events: ['change_set.shipped'],
          allowPrivateNetwork: true,
          ...(network ? { network: true } : {}),
        }),
        201,
      ).json<{ webhook: { id: string; site: { key: string } | null } }>().webhook;

    it("a site webhook gets only its site's events, a network webhook every site's", async () => {
      const hookA = await createWebhook(siteA, 'hook-a');
      const hookB = await createWebhook(siteB, 'hook-b');
      const network = await createWebhook(siteA, 'hook-network', true);
      expect(hookA.site?.key).toBe('default');
      expect(network.site).toBeNull();
      const listedOnB = expectStatus(await siteB.get('/api/admin/webhooks'), 200).json<
        Array<{ id: string }>
      >();
      expect(listedOnB.map((hook) => hook.id).sort()).toEqual([hookB.id, network.id].sort());
      expect((await siteB.get(`/api/admin/webhooks/${hookA.id}`)).statusCode).toBe(404);

      const set = await createSet(siteB, 'B event');
      expectStatus(await addItem(siteB, set.id, (await createArticle(siteB, 'Event on B')).id), 200);
      expectStatus(await ship(siteB, set.id), 200);
      await drain([PUBLISHING_JOBS.webhookDeliver]);

      const deliveries = await database.current.db
        .selectFrom('webhook_deliveries as d')
        .innerJoin('outbox_events as e', 'e.event_id', 'd.event_id')
        .select(['d.webhook_id', 'd.payload'])
        .where('e.aggregate_id', '=', set.id)
        .execute();
      expect(deliveries.map((delivery) => delivery.webhook_id).sort()).toEqual([hookB.id, network.id].sort());
      for (const delivery of deliveries) {
        expect((delivery.payload as { site: unknown }).site).toEqual({ id: other.id, key: 'b' });
      }
    });

    it('needs webhooks.manage on every site for a network webhook', async () => {
      const siteAdmin = await siteOnlyAdmin('admin', other.id);
      const refused = await asSession(siteAdmin, 'b').post('/api/admin/webhooks', {
        name: 'not mine',
        url: `${receiver.url}/nope`,
        events: ['change_set.shipped'],
        allowPrivateNetwork: true,
        network: true,
      });
      expect(refused.statusCode).toBe(403);
      const own = await asSession(siteAdmin, 'b').post('/api/admin/webhooks', {
        name: 'mine',
        url: `${receiver.url}/mine`,
        events: ['change_set.shipped'],
        allowPrivateNetwork: true,
      });
      expect(own.statusCode).toBe(201);
    });
  });

  it('a preview token reads its own site only', async () => {
    const entryOnB = await createArticle(siteB, 'Preview on B');
    const entryOnA = await createArticle(siteA, 'Preview on A');
    const onB = asSession(owner, 'b');
    const crossCreate = await onB.post('/api/admin/preview/tokens', {
      modelKey: 'article',
      entryId: entryOnA.id,
    });
    expect(crossCreate.statusCode).toBe(404);
    const modelWide = await onB.post('/api/admin/preview/tokens', { modelKey: 'article' });
    expect(modelWide.statusCode).toBe(400);
    const created = expectStatus(
      await onB.post('/api/admin/preview/tokens', { modelKey: 'article', entryId: entryOnB.id }),
      201,
    ).json<{ token: string }>();
    const read = (id: string, query = '') =>
      testApp.app.inject({
        method: 'GET',
        url: `/api/preview/content/articles/${id}${query}`,
        headers: { authorization: `Bearer ${created.token}` },
      });
    expect(expectStatus(await read(entryOnB.id), 200).json<{ data: { title: string } }>().data.title).toBe(
      'Preview on B',
    );
    const mismatch = await read(entryOnB.id, '?site=default');
    expect(mismatch.statusCode).toBe(403);
    expect(codeOf(mismatch)).toBe('SITE_MISMATCH');
    expect((await read(entryOnA.id)).statusCode).toBe(403);
  });

  it('keys usage by site: the model usage shows the request site only', async () => {
    const titleId = fieldIdOf(article, 'title');
    const day = new Date().toISOString().slice(0, 10);
    await database.current.db
      .insertInto('field_reads')
      .values(
        [PRIMARY_SITE_ID, other.id].map((siteId, index) => ({
          day,
          site_id: siteId,
          model_id: article.definition.id,
          field_path: titleId,
          principal_key: `reader-${index}`,
          selection: 'explicit',
          reads: String(10 + index),
          last_read_at: new Date(),
        })),
      )
      .execute();
    const usageOn = async (client: SchemaClient) =>
      expectStatus(await client.get(`/api/admin/usage/fields?modelId=${article.definition.id}`), 200).json<{
        fields: Array<{ principals: Array<{ principalKey: string }> }>;
      }>();
    const keysOf = (usage: Awaited<ReturnType<typeof usageOn>>) =>
      usage.fields
        .flatMap((field) => field.principals.map((principal) => principal.principalKey))
        .filter((key) => key.startsWith('reader-'));
    expect(keysOf(await usageOn(siteA))).toEqual(['reader-0']);
    expect(keysOf(await usageOn(siteB))).toEqual(['reader-1']);

    // A change-set review spans sites: a network viewer sees every site's readers labelled with the site,
    // anyone else their own site's plus anonymous totals for the others.
    const [everySite] = await consumersOf([titleId], 7, { siteId: other.id, network: true });
    expect(
      everySite?.principals
        .filter((principal) => principal.principalKey.startsWith('reader-'))
        .map((principal) => `${principal.site.key}:${principal.principalKey}`)
        .sort(),
    ).toEqual(['b:reader-1', 'default:reader-0']);
    expect(everySite?.otherSites).toBeNull();
    const [restricted] = await consumersOf([titleId], 7, { siteId: other.id, network: false });
    expect(restricted?.principals.every((principal) => principal.site.id === other.id)).toBe(true);
    expect(restricted?.otherSites?.consumers).toBeGreaterThanOrEqual(1);
    expect(restricted?.otherSites?.reads).toBeGreaterThanOrEqual(10);
  });
});
