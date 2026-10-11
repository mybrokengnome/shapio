import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp, createPublishingWorker, drainJobs } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type History = {
  items: Array<{ id: string; reason: string; authorName: string | null }>;
  publications: Array<{
    revisionId: string;
    publishedBy: string | null;
    via: 'schedule' | 'changeSet' | null;
    changeSetTitle: string | null;
    live: boolean;
    unpublishedAt: string | null;
    unpublishedBy: string | null;
  }>;
};

/** Entry history (documentation/content.md "History and restore"): when, why and by whom, publishes included. */
describe('entry history', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let tokenClient: SchemaClient;
  let session: TestSession;
  const workers: Worker[] = [];

  const asAdmin = (method: InjectOptions['method'], url: string, payload?: Record<string, unknown>) =>
    testApp.app.inject({ method, url, headers: session.headers, ...(payload ? { payload } : {}) });
  const historyOf = async (id: string) =>
    expectStatus(await asAdmin('GET', `/api/admin/content/article/${id}/revisions`), 200).json<History>();
  const revisionCount = async (id: string) =>
    (
      await database.current.db
        .selectFrom('content_revisions')
        .select('id')
        .where('entry_id', '=', id)
        .execute()
    ).length;
  const updatedEvents = async (id: string) =>
    (
      await database.current.db
        .selectFrom('outbox_events')
        .select('id')
        .where('type', '=', 'entry.updated')
        .where('aggregate_id', '=', id)
        .execute()
    ).length;

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    tokenClient = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(tokenClient, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    const owner = await createAdmin(database.current.db);
    await database.current.db
      .updateTable('admin_users')
      .set({ name: 'Ada Owner' })
      .where('id', '=', owner.id)
      .execute();
    session = await login(testApp.app, owner);
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.stop(500)));
    await testApp.app.close();
  });

  it('names who made each revision and lists publishes and unpublishes with who did them', async () => {
    const entry = expectStatus(
      await asAdmin('POST', '/api/admin/content/article', { data: { title: 'First' } }),
      201,
    ).json<EntryBody>();
    expectStatus(await asAdmin('POST', `/api/admin/content/article/${entry.id}/publish`, {}), 200);
    const saved = expectStatus(
      await tokenClient.put(`/api/admin/content/article/${entry.id}`, {
        expectedVersion: 1,
        data: { title: 'Second' },
      }),
      200,
    ).json<EntryBody>();
    expectStatus(await asAdmin('POST', `/api/admin/content/article/${entry.id}/publish`, {}), 200);

    let history = await historyOf(entry.id);
    expect(history.items.map((item) => [item.reason, item.authorName])).toEqual([
      ['save', expect.stringMatching(/^test admin /)],
      ['create', 'Ada Owner'],
    ]);
    expect(history.publications).toEqual([
      expect.objectContaining({
        revisionId: saved.revisionId,
        publishedBy: 'Ada Owner',
        live: true,
        via: null,
      }),
      // Replaced by the second publish, not unpublished.
      expect.objectContaining({ revisionId: entry.revisionId, live: false, unpublishedAt: null }),
    ]);

    expectStatus(await asAdmin('POST', `/api/admin/content/article/${entry.id}/unpublish`, {}), 200);
    history = await historyOf(entry.id);
    expect(history.publications[0]).toMatchObject({ live: false, unpublishedBy: 'Ada Owner' });
    expect(Date.parse(history.publications[0]?.unpublishedAt ?? '')).not.toBeNaN();
  });

  it('names a scheduled publish and a change set publish', async () => {
    const scheduled = expectStatus(
      await asAdmin('POST', '/api/admin/content/article', { data: { title: 'Scheduled' } }),
      201,
    ).json<EntryBody>();
    expectStatus(
      await asAdmin('POST', '/api/admin/publishing/schedules', {
        modelKey: 'article',
        entryId: scheduled.id,
        action: 'publish',
        runAt: new Date().toISOString(),
      }),
      201,
    );
    const worker = createPublishingWorker({ db: database.current.db, app: testApp.app });
    workers.push(worker);
    await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.scheduledPublication] });
    expect((await historyOf(scheduled.id)).publications).toEqual([
      expect.objectContaining({ via: 'schedule', publishedBy: 'Ada Owner', live: true }),
    ]);

    const shipped = expectStatus(
      await asAdmin('POST', '/api/admin/content/article', { data: { title: 'Shipped' } }),
      201,
    ).json<EntryBody>();
    const set = expectStatus(await asAdmin('POST', '/api/admin/change-sets', { title: 'Launch' }), 201).json<{
      id: string;
    }>();
    const withItem = expectStatus(
      await asAdmin('POST', `/api/admin/change-sets/${set.id}/items`, {
        modelKey: 'article',
        entryId: shipped.id,
        action: 'publish',
      }),
      200,
    ).json<{ version: number }>();
    expectStatus(
      await asAdmin('POST', `/api/admin/change-sets/${set.id}/ship`, { expectedVersion: withItem.version }),
      200,
    );
    expect((await historyOf(shipped.id)).publications).toEqual([
      expect.objectContaining({ via: 'changeSet', changeSetTitle: 'Launch', live: true }),
    ]);
  });

  it('answers a save that changes nothing with the same version, and records no revision or event', async () => {
    const entry = expectStatus(
      await asAdmin('POST', '/api/admin/content/article', { data: { title: 'Steady' } }),
      201,
    ).json<EntryBody>();
    const events = await updatedEvents(entry.id);
    for (const data of [{}, { title: 'Steady' }]) {
      const same = expectStatus(
        await asAdmin('PUT', `/api/admin/content/article/${entry.id}`, { expectedVersion: 1, data }),
        200,
      ).json<EntryBody>();
      expect(same).toMatchObject({ version: 1, revisionId: entry.revisionId });
    }
    expect(await revisionCount(entry.id)).toBe(1);
    expect(await updatedEvents(entry.id)).toBe(events);
    // The version guard still applies.
    expect(
      (await asAdmin('PUT', `/api/admin/content/article/${entry.id}`, { expectedVersion: 7, data: {} }))
        .statusCode,
    ).toBe(409);
  });

  it('still makes a revision when an unchanged save follows an autosave', async () => {
    const entry = expectStatus(
      await asAdmin('POST', '/api/admin/content/article', { data: { title: 'Draft' } }),
      201,
    ).json<EntryBody>();
    const autosaved = expectStatus(
      await asAdmin('PUT', `/api/admin/content/article/${entry.id}`, {
        expectedVersion: 1,
        data: { title: 'Typed' },
        autosave: true,
      }),
      200,
    ).json<EntryBody>();
    expect(await revisionCount(entry.id)).toBe(1);
    const saved = expectStatus(
      await asAdmin('PUT', `/api/admin/content/article/${entry.id}`, {
        expectedVersion: autosaved.version,
        data: {},
      }),
      200,
    ).json<EntryBody>();
    expect(saved.version).toBe(autosaved.version + 1);
    expect(await revisionCount(entry.id)).toBe(2);
    expect((await historyOf(entry.id)).items[0]).toMatchObject({ reason: 'save', authorName: 'Ada Owner' });
  });
});
