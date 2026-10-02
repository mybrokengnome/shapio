import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnTsProcess, type SpawnedProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

/**
 * Change sets with entry items only (what releases were): every transition, one snapshot per ship, strict
 * interactive ships, scheduling across a worker restart, permissions. Schema items: changeSetsSchema.int.
 */
type ChangeSet = {
  id: string;
  status: string;
  version: number;
  shippedSnapshot: number | null;
  error: { code: string; message: string; itemId: string | null } | null;
  items: Array<{
    id: string;
    kind: string;
    entryId: string;
    status: string;
    error: string | null;
    action: string;
  }>;
};

describe('change sets (content)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let deliveryToken: string;
  const workers: Worker[] = [];

  const createEntry = async (title: string) =>
    expectStatus(await admin.post('/api/admin/content/page', { data: { title } }), 201).json<EntryBody>();
  const deliver = (id: string) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/content/pages/${id}`,
      headers: { authorization: `Bearer ${deliveryToken}` },
    });
  const createSet = async (title: string) =>
    expectStatus(await admin.post('/api/admin/change-sets', { title }), 201).json<ChangeSet>();
  const getSet = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSet>();
  const addItem = async (setId: string, entryId: string, action = 'publish') =>
    expectStatus(
      await admin.post(`/api/admin/change-sets/${setId}/items`, { modelKey: 'page', entryId, action }),
      200,
    ).json<ChangeSet>();
  const patch = (url: string, payload: unknown) =>
    admin.request({ method: 'PATCH', url, payload: payload as Record<string, unknown> });
  const ship = async (set: { id: string }, body: Record<string, unknown> = {}) => {
    const current = await getSet(set.id);
    return admin.post(`/api/admin/change-sets/${set.id}/ship`, { expectedVersion: current.version, ...body });
  };
  const publicationCount = async () =>
    Number(
      (
        await database.current.db
          .selectFrom('publication_log')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
  const eventsOf = (type: string) =>
    database.current.db.selectFrom('outbox_events').selectAll().where('type', '=', type).execute();

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    deliveryToken = await createDeliveryToken(database.current.db, [{ modelId: page.definition.id }]);
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.stop(500)));
    await testApp.app.close();
  });

  it('ships every item in one transaction as ONE snapshot, with one ledger row and one event', async () => {
    const first = await createEntry('First');
    const second = await createEntry('Second');
    const retired = await createEntry('Retired');
    expectStatus(await admin.post(`/api/admin/content/page/${retired.id}/publish`, {}), 200);

    const set = await createSet('Launch');
    expect(set).toMatchObject({ status: 'open', shippedSnapshot: null, items: [] });
    await addItem(set.id, first.id);
    await addItem(set.id, second.id);
    const withItems = await addItem(set.id, retired.id, 'unpublish');
    expect(withItems.items).toHaveLength(3);
    expect(
      (
        await admin.post(`/api/admin/change-sets/${set.id}/items`, {
          modelKey: 'page',
          entryId: first.id,
          action: 'publish',
        })
      ).statusCode,
    ).toBe(409);

    const shipped = expectStatus(await ship(set), 200).json<ChangeSet>();
    expect(shipped).toMatchObject({ status: 'shipped', error: null });
    expect(shipped.items.every((item) => item.status === 'done')).toBe(true);
    const seq = shipped.shippedSnapshot as number;
    expect(seq).toEqual(expect.any(Number));
    // Both publications open at the snapshot, the unpublish closes at it: no other number was used.
    const rows = await database.current.db
      .selectFrom('publication_log')
      .selectAll()
      .where('entry_id', 'in', [first.id, second.id, retired.id])
      .execute();
    expect(rows.filter((row) => row.entry_id !== retired.id).map((row) => Number(row.from_seq))).toEqual([
      seq,
      seq,
    ]);
    expect(Number(rows.find((row) => row.entry_id === retired.id)?.to_seq)).toBe(seq);
    const ledger = await database.current.db
      .selectFrom('publication_snapshots')
      .selectAll()
      .where('seq', '=', String(seq))
      .executeTakeFirstOrThrow();
    expect(ledger).toMatchObject({ source: 'change_set', change_set_id: set.id, actor_type: 'token' });
    expect((await deliver(first.id)).statusCode).toBe(200);
    expect((await deliver(second.id)).statusCode).toBe(200);
    expect((await deliver(retired.id)).statusCode).toBe(404);
    const events = await eventsOf('change_set.shipped');
    expect(events.filter((event) => event.aggregate_id === set.id)).toHaveLength(1);
    expect(events.find((event) => event.aggregate_id === set.id)?.payload).toMatchObject({
      changeSetId: set.id,
      snapshot: seq,
    });
    const entryEvents = (await eventsOf('entry.published')).filter((event) =>
      [first.id, second.id].includes(event.aggregate_id),
    );
    expect(entryEvents.map((event) => (event.payload as { snapshot: number }).snapshot)).toEqual([seq, seq]);

    // A shipped set is history: it cannot ship again or change.
    expect((await ship(set)).statusCode).toBe(409);
    expect(
      (
        await admin.post(`/api/admin/change-sets/${set.id}/items`, {
          modelKey: 'page',
          entryId: second.id,
          action: 'unpublish',
        })
      ).statusCode,
    ).toBe(409);
    const snapshots = expectStatus(await admin.get('/api/admin/snapshots?limit=5'), 200).json<{
      current: number;
      items: Array<{ seq: number; source: string; changeSetId: string | null; changedEntries: number }>;
    }>();
    expect(snapshots.current).toBe(seq);
    expect(snapshots.items[0]).toMatchObject({
      seq,
      source: 'change_set',
      changeSetId: set.id,
      changedEntries: 3,
    });
  });

  it('ships nothing when one item fails, and says which item and why; reshipping after a fix works', async () => {
    const good = await createEntry('Good');
    const bad = await createEntry('Bad');
    // Autosave keeps a draft without its required title; publishing it must fail validation.
    expectStatus(
      await admin.put(`/api/admin/content/page/${bad.id}`, {
        expectedVersion: bad.version,
        data: { title: null },
        autosave: true,
      }),
      200,
    );
    const set = await createSet('Broken');
    await addItem(set.id, good.id);
    const item = (await addItem(set.id, bad.id)).items.find((candidate) => candidate.entryId === bad.id);
    const before = await publicationCount();
    const seqBefore = expectStatus(await admin.get('/api/admin/snapshots?limit=1'), 200).json<{
      current: number;
    }>().current;

    const result = expectStatus(await ship(set), 200).json<ChangeSet>();
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ code: 'CONTENT_INVALID', itemId: item?.id });
    expect(result.error?.message).toMatch(/title/i);
    expect(result.items.find((candidate) => candidate.id === item?.id)).toMatchObject({ status: 'failed' });
    expect(result.items.find((candidate) => candidate.entryId === good.id)).toMatchObject({
      status: 'pending',
    });
    expect(await publicationCount()).toBe(before);
    expect(
      expectStatus(await admin.get('/api/admin/snapshots?limit=1'), 200).json<{ current: number }>().current,
    ).toBe(seqBefore);
    expect((await deliver(good.id)).statusCode).toBe(404);
    expect(
      (await eventsOf('change_set.failed')).filter((event) => event.aggregate_id === set.id),
    ).toHaveLength(1);
    const audits = await database.current.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'change_set.ship')
      .where('target_id', '=', set.id)
      .execute();
    expect(audits).toEqual([expect.objectContaining({ outcome: 'failure' })]);

    const current = expectStatus(await admin.get(`/api/admin/content/page/${bad.id}`), 200).json<EntryBody>();
    expectStatus(
      await admin.put(`/api/admin/content/page/${bad.id}`, {
        expectedVersion: current.version,
        data: { title: 'Fixed' },
      }),
      200,
    );
    expect(expectStatus(await ship(set), 200).json<ChangeSet>().status).toBe('shipped');
    expect((await deliver(good.id)).statusCode).toBe(200);
    expect((await deliver(bad.id)).statusCode).toBe(200);
  });

  it('refuses a strict ship when a reviewed draft moved, and leaves the set open', async () => {
    const entry = await createEntry('Reviewed');
    const set = await createSet('Strict');
    await addItem(set.id, entry.id);
    const review = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/review`), 200).json<{
      entries: Array<{
        itemId: string;
        draftVersion: number;
        fields: Array<{ apiKey: string; after: unknown }>;
      }>;
    }>();
    expect(review.entries[0]?.fields).toEqual([
      expect.objectContaining({ apiKey: 'title', after: 'Reviewed' }),
    ]);
    const itemVersions = review.entries.map((item) => ({
      itemId: item.itemId,
      draftVersion: item.draftVersion,
    }));
    expectStatus(
      await admin.put(`/api/admin/content/page/${entry.id}`, {
        expectedVersion: entry.version,
        data: { title: 'Edited' },
      }),
      200,
    );
    const refused = await ship(set, { itemVersions });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('CHANGE_SET_STALE');
    expect((await getSet(set.id)).status).toBe('open');
    expect((await deliver(entry.id)).statusCode).toBe(404);
  });

  it('edits, discards, and refuses stale versions and empty sets', async () => {
    const set = await createSet('Draft');
    const renamed = expectStatus(
      await patch(`/api/admin/change-sets/${set.id}`, { title: 'Renamed', expectedVersion: set.version }),
      200,
    ).json<ChangeSet & { title: string }>();
    expect(renamed.title).toBe('Renamed');
    expect(
      (await patch(`/api/admin/change-sets/${set.id}`, { title: 'x', expectedVersion: set.version }))
        .statusCode,
    ).toBe(409);
    expect((await ship(set)).statusCode).toBe(422);
    const discarded = expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/discard`, {}),
      200,
    ).json<ChangeSet>();
    expect(discarded.status).toBe('discarded');
    expect((await admin.post(`/api/admin/change-sets/${set.id}/discard`, {})).statusCode).toBe(409);
    const list = expectStatus(await admin.get('/api/admin/change-sets'), 200).json<{ items: ChangeSet[] }>();
    expect(list.items.some((item) => item.id === set.id)).toBe(false);
    const all = expectStatus(await admin.get('/api/admin/change-sets?status=discarded'), 200).json<{
      items: ChangeSet[];
    }>();
    expect(all.items.map((item) => item.id)).toContain(set.id);
    const timeline = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/timeline`), 200).json<{
      items: Array<{ kind: string }>;
    }>();
    expect(timeline.items.map((event) => event.kind)).toEqual(['created', 'updated', 'discarded']);
  });

  it('lists drafts not in any active set as unassigned', async () => {
    const loose = await createEntry('Loose draft');
    const assigned = await createEntry('Assigned draft');
    const set = await createSet('Holds one');
    await addItem(set.id, assigned.id);
    const page = expectStatus(await admin.get('/api/admin/change-sets/unassigned?limit=200'), 200).json<{
      items: Array<{ entryId: string; status: string; title: string | null; modelKey: string }>;
    }>();
    expect(page.items).toContainEqual(
      expect.objectContaining({ entryId: loose.id, status: 'draft', title: 'Loose draft', modelKey: 'page' }),
    );
    expect(page.items.some((item) => item.entryId === assigned.id)).toBe(false);
  });

  it('ships a scheduled set once at its time with the latest drafts; rescheduling supersedes the old job', async () => {
    const entry = await createEntry('Scheduled set');
    const set = await createSet('Tomorrow');
    await addItem(set.id, entry.id);
    const scheduled = expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/schedule`, {
        at: new Date(Date.now() + 3_600_000).toISOString(),
        expectedVersion: (await getSet(set.id)).version,
      }),
      200,
    ).json<ChangeSet>();
    const rescheduled = expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/schedule`, {
        at: new Date(Date.now() + 7_200_000).toISOString(),
        expectedVersion: scheduled.version,
      }),
      200,
    ).json<ChangeSet>();
    expect(rescheduled.status).toBe('scheduled');
    // Edited after scheduling: a scheduled ship publishes the latest draft.
    expectStatus(
      await admin.put(`/api/admin/content/page/${entry.id}`, {
        expectedVersion: entry.version,
        data: { title: 'Later' },
      }),
      200,
    );

    const clock = createTestClock();
    const worker = createPublishingWorker({ db: database.current.db, app: testApp.app, now: clock.now });
    workers.push(worker);
    clock.advance(3_700_000);
    await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.changeSetShip], now: clock.now });
    expect((await deliver(entry.id)).statusCode).toBe(404);

    clock.advance(3_700_000);
    await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.changeSetShip], now: clock.now });
    const delivered = expectStatus(await deliver(entry.id), 200).json<{ data: { title: string } }>();
    expect(delivered.data.title).toBe('Later');
    const done = await getSet(set.id);
    expect(done.status).toBe('shipped');
    const timeline = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/timeline`), 200).json<{
      items: Array<{
        kind: string;
        item: { entryId: string; locale: string; fromVersion: number; toVersion: number } | null;
      }>;
    }>();
    expect(timeline.items.filter((event) => event.kind === 'item.changedAfterReview')).toEqual([
      expect.objectContaining({
        item: { entryId: entry.id, locale: 'en', fromVersion: entry.version, toVersion: entry.version + 1 },
      }),
    ]);
    const jobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'result'])
      .where('type', '=', PUBLISHING_JOBS.changeSetShip)
      .orderBy('created_at')
      .execute();
    expect(jobs.map((job) => job.result)).toEqual([
      { skipped: 'scheduled' },
      { changeSetId: set.id, status: 'shipped', snapshot: String(done.shippedSnapshot) },
    ]);
  });

  it('unschedules back to open', async () => {
    const entry = await createEntry('Unscheduled');
    const set = await createSet('Maybe');
    const withItem = await addItem(set.id, entry.id);
    expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/schedule`, {
        at: new Date(Date.now() + 3_600_000).toISOString(),
        expectedVersion: withItem.version,
      }),
      200,
    );
    const back = expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/unschedule`, {}),
      200,
    ).json<ChangeSet>();
    expect(back.status).toBe('open');
  });

  it('needs changes.manage', async () => {
    const readOnly = schemaClient(testApp.app, await createRoleToken(database.current.db, 'read-only'));
    expect((await readOnly.get('/api/admin/change-sets')).statusCode).toBe(403);
    expect((await readOnly.post('/api/admin/change-sets', { title: 'x' })).statusCode).toBe(403);
    expect((await readOnly.get('/api/admin/snapshots')).statusCode).toBe(403);
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect((await editor.get('/api/admin/change-sets')).statusCode).toBe(200);
  });

  describe('a scheduled set across a worker restart ships every item exactly once (brief §10)', () => {
    const LEASE_MS = 1500;
    const children: SpawnedProcess[] = [];

    const startChild = (workerId: string, hangAt: 'beforeCommit' | 'afterCommit' | 'never') => {
      const child = spawnTsProcess('test/fixtures/publishingWorker.ts', {
        DATABASE_URL: database.current.url,
        WORKER_ID: workerId,
        LEASE_MS: String(LEASE_MS),
        SIGNING_SECRET: testApp.app.signingSecret,
        HANG_AT: hangAt,
      });
      children.push(child);
      return child;
    };

    afterEach(async () => {
      await Promise.all(children.splice(0).map((child) => child.stop('SIGKILL')));
    });

    const scheduledSet = async (title: string) => {
      const entries = [];
      for (const name of [`${title} A`, `${title} B`, `${title} C`]) {
        entries.push(await createEntry(name));
      }
      const set = await createSet(title);
      for (const entry of entries) {
        await addItem(set.id, entry.id);
      }
      expectStatus(
        await admin.post(`/api/admin/change-sets/${set.id}/schedule`, {
          at: new Date(Date.now() + 1000).toISOString(),
          expectedVersion: (await getSet(set.id)).version,
        }),
        200,
      );
      return { set, entries };
    };
    const setRow = (id: string) =>
      database.current.db
        .selectFrom('change_sets')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
    const publicationsOf = (entryIds: string[]) =>
      database.current.db
        .selectFrom('publication_log')
        .selectAll()
        .where('entry_id', 'in', entryIds)
        .execute();
    const publishEventsOf = (entryIds: string[]) =>
      database.current.db
        .selectFrom('outbox_events')
        .select('aggregate_id')
        .where('type', '=', 'entry.published')
        .where('aggregate_id', 'in', entryIds)
        .execute();

    const expectShippedOnce = async (setId: string, entryIds: string[]) => {
      const publications = await publicationsOf(entryIds);
      expect(publications).toHaveLength(entryIds.length);
      const events = await publishEventsOf(entryIds);
      expect(events.map((event) => event.aggregate_id).sort()).toEqual([...entryIds].sort());
      expect(
        (await eventsOf('change_set.shipped')).filter((event) => event.aggregate_id === setId),
      ).toHaveLength(1);
      for (const id of entryIds) {
        expect((await deliver(id)).statusCode).toBe(200);
      }
      const done = await getSet(setId);
      expect(done.status).toBe('shipped');
      expect(new Set(publications.map((row) => Number(row.from_seq)))).toEqual(
        new Set([done.shippedSnapshot]),
      );
    };

    it('a worker killed inside the ship transaction ships nothing; the next one ships all once', async () => {
      const { set, entries } = await scheduledSet('Crash before commit');
      const entryIds = entries.map((entry) => entry.id);
      const first = startChild('set-crash-before', 'beforeCommit');
      await first.waitForLog(
        (line) => line.msg === 'published inside the transaction; hanging before commit',
      );
      expect(await first.stop('SIGKILL')).toBeNull();
      expect(await publicationsOf(entryIds)).toHaveLength(0);
      expect((await setRow(set.id)).status).toBe('scheduled');

      startChild('set-recover-before', 'never');
      await waitFor(async () => (await setRow(set.id)).status === 'shipped', { timeoutMs: 20_000 });
      await expectShippedOnce(set.id, entryIds);
    }, 60_000);

    it('a worker killed after the ship committed is not repeated by the next worker', async () => {
      const { set, entries } = await scheduledSet('Crash after commit');
      const entryIds = entries.map((entry) => entry.id);
      const jobId = (await setRow(set.id)).schedule_job_id ?? '';
      const first = startChild('set-crash-after', 'afterCommit');
      await first.waitForLog(
        (line) => line.msg === 'handler finished; hanging before the job is marked succeeded',
      );
      expect(await first.stop('SIGKILL')).toBeNull();
      expect((await setRow(set.id)).status).toBe('shipped');
      const job = () =>
        database.current.db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirstOrThrow();
      expect((await job()).status).toBe('running');

      startChild('set-recover-after', 'never');
      const finished = await waitFor(
        async () => {
          const current = await job();
          return current.status === 'succeeded' ? current : undefined;
        },
        { timeoutMs: 20_000 },
      );
      expect(finished.attempts).toBe(2);
      expect(finished.result).toEqual({ skipped: 'shipped' });
      await expectShippedOnce(set.id, entryIds);
    }, 60_000);
  });
});
