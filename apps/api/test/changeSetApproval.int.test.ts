import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  createTestClock,
  drainJobs,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Approval on change sets (plan approval): the transitions and who may make them, the fingerprint that makes
 * an approval outdated, the gates on ship and schedule when the site requires approval, approval after ship,
 * the list filter the Inbox reads, the timeline and the webhook events.
 */
type Approval = {
  status: string;
  note: string;
  requestedBy: { type: string } | null;
  approvedBy: { type: string } | null;
  outdated: boolean;
  approvedAtShip: boolean | null;
};
type ChangeSet = {
  id: string;
  status: string;
  version: number;
  error: { code: string } | null;
  approval: Approval;
};
type ErrorBody = { error: { code: string } };

describe('change set approval', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  const workers: Worker[] = [];

  const createEntry = async (title: string) =>
    expectStatus(await admin.post('/api/admin/content/page', { data: { title } }), 201).json<EntryBody>();
  const editEntry = async (entry: EntryBody, title: string) =>
    expectStatus(
      await admin.put(`/api/admin/content/page/${entry.id}`, {
        expectedVersion: entry.version,
        data: { title },
      }),
      200,
    ).json<EntryBody>();
  const getSet = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSet>();
  const setWithEntry = async (title: string) => {
    const entry = await createEntry(title);
    const set = expectStatus(await admin.post('/api/admin/change-sets', { title }), 201).json<ChangeSet>();
    expectStatus(
      await admin.post(`/api/admin/change-sets/${set.id}/items`, {
        modelKey: 'page',
        entryId: entry.id,
        action: 'publish',
      }),
      200,
    );
    return { set: await getSet(set.id), entry };
  };
  const approval = (client: SchemaClient, id: string, step: string, body: Record<string, unknown> = {}) =>
    client.post(`/api/admin/change-sets/${id}/approval/${step}`, body);
  const ship = async (id: string) =>
    admin.post(`/api/admin/change-sets/${id}/ship`, { expectedVersion: (await getSet(id)).version });
  const schedule = async (id: string, at: Date) =>
    admin.post(`/api/admin/change-sets/${id}/schedule`, {
      at: at.toISOString(),
      expectedVersion: (await getSet(id)).version,
    });
  const requireApproval = async (on: boolean) => {
    const current = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      version: number;
    }>();
    expectStatus(
      await admin.put('/api/admin/site/change-sets', {
        expectedVersion: current.version,
        requireApproval: on,
      }),
      200,
    );
  };
  const codeOf = (response: { json: <T>() => T }) => response.json<ErrorBody>().error.code;

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.stop(500)));
    await testApp.app.close();
  });

  it('stores the site setting with its version, needs site.settings, and shows it on the site', async () => {
    const before = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      version: number;
      requireApproval: boolean;
    }>();
    expect(before.requireApproval).toBe(false);
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect(
      (
        await editor.put('/api/admin/site/change-sets', {
          expectedVersion: before.version,
          requireApproval: true,
        })
      ).statusCode,
    ).toBe(403);
    await requireApproval(true);
    const stale = await admin.put('/api/admin/site/change-sets', {
      expectedVersion: before.version,
      requireApproval: false,
    });
    expect(stale.statusCode).toBe(409);
    const sites = expectStatus(await admin.get('/api/admin/sites'), 200).json<
      Array<{ requireApproval: boolean }>
    >();
    expect(sites[0]?.requireApproval).toBe(true);
    await requireApproval(false);
  });

  it('requests, approves and ships where approval is required; approval writes keep the set version', async () => {
    await requireApproval(true);
    const { set } = await setWithEntry('Approved launch');
    const refused = await ship(set.id);
    expect(refused.statusCode).toBe(409);
    expect(codeOf(refused)).toBe('CHANGE_SET_NOT_APPROVED');

    const requested = expectStatus(
      await approval(admin, set.id, 'request', { note: 'Please check the title' }),
      200,
    ).json<ChangeSet>();
    expect(requested.approval).toMatchObject({ status: 'requested', note: 'Please check the title' });
    expect(requested.approval.requestedBy).toMatchObject({ type: 'token' });
    expect(requested.version).toBe(set.version);

    const approved = expectStatus(
      await approval(admin, set.id, 'approve', { note: 'Looks good' }),
      200,
    ).json<ChangeSet>();
    expect(approved.approval).toMatchObject({ status: 'approved', note: 'Looks good', outdated: false });
    expect(approved.version).toBe(set.version);

    const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
    expect(shipped.status).toBe('shipped');
    expect(shipped.approval).toMatchObject({ status: 'approved', outdated: false, approvedAtShip: true });

    const events = await database.current.db
      .selectFrom('outbox_events')
      .select('type')
      .where('aggregate_id', '=', set.id)
      .execute();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['change_set.approval_requested', 'change_set.approved', 'change_set.shipped']),
    );
    const timeline = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/timeline`), 200).json<{
      items: Array<{ kind: string; message: string | null }>;
    }>();
    expect(timeline.items.filter((event) => event.kind.startsWith('approval.'))).toEqual([
      expect.objectContaining({ kind: 'approval.requested', message: 'Please check the title' }),
      expect.objectContaining({ kind: 'approval.approved', message: 'Looks good' }),
    ]);
    await requireApproval(false);
  });

  it('makes an approval outdated when a draft moves, refuses the ship, and keeps the set open', async () => {
    await requireApproval(true);
    const { set, entry } = await setWithEntry('Edited after approval');
    expectStatus(await approval(admin, set.id, 'approve'), 200);
    await editEntry(entry, 'Changed after approval');
    const view = await getSet(set.id);
    expect(view.approval).toMatchObject({ status: 'approved', outdated: true });
    const refused = await ship(set.id);
    expect(refused.statusCode).toBe(409);
    expect(codeOf(refused)).toBe('CHANGE_SET_APPROVAL_STALE');
    expect((await getSet(set.id)).status).toBe('open');

    // An unrelated write (the title) does not touch the approval.
    expectStatus(await approval(admin, set.id, 'approve'), 200);
    expectStatus(
      await admin.request({
        method: 'PATCH',
        url: `/api/admin/change-sets/${set.id}`,
        payload: { title: 'Renamed', expectedVersion: (await getSet(set.id)).version },
      }),
      200,
    );
    expect((await getSet(set.id)).approval.outdated).toBe(false);
    await requireApproval(false);
  });

  it('refuses ship and schedule after changes were requested, until it is approved; clear resets', async () => {
    await requireApproval(true);
    const { set } = await setWithEntry('Sent back');
    const sentBack = expectStatus(
      await approval(admin, set.id, 'request-changes', { note: 'Fix the title' }),
      200,
    ).json<ChangeSet>();
    expect(sentBack.approval).toMatchObject({ status: 'changes_requested', note: 'Fix the title' });
    expect((await approval(admin, set.id, 'request-changes', {})).statusCode).toBe(400);
    expect(codeOf(await ship(set.id))).toBe('CHANGE_SET_NOT_APPROVED');
    const scheduled = await schedule(set.id, new Date(Date.now() + 3_600_000));
    expect(scheduled.statusCode).toBe(409);
    expect(codeOf(scheduled)).toBe('CHANGE_SET_NOT_APPROVED');
    const cleared = expectStatus(await approval(admin, set.id, 'clear'), 200).json<ChangeSet>();
    expect(cleared.approval).toMatchObject({ status: 'none', note: '', requestedBy: null, approvedBy: null });
    await requireApproval(false);
  });

  it('fails a scheduled ship whose draft moved after approval, with the reason on the set', async () => {
    await requireApproval(true);
    const { set, entry } = await setWithEntry('Scheduled and edited');
    expectStatus(await approval(admin, set.id, 'approve'), 200);
    expectStatus(await schedule(set.id, new Date(Date.now() + 3_600_000)), 200);
    await editEntry(entry, 'Moved after approval');

    const clock = createTestClock();
    const worker = createPublishingWorker({ db: database.current.db, app: testApp.app, now: clock.now });
    workers.push(worker);
    clock.advance(3_700_000);
    await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.changeSetShip], now: clock.now });
    const failed = await getSet(set.id);
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('CHANGE_SET_APPROVAL_STALE');
    await requireApproval(false);
  });

  it('approves a shipped set afterwards, and that approval never goes stale', async () => {
    const { set, entry } = await setWithEntry('Shipped first');
    const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
    expect(shipped.approval).toMatchObject({ status: 'none', approvedAtShip: false });
    const approved = expectStatus(await approval(admin, set.id, 'approve'), 200).json<ChangeSet>();
    expect(approved.approval).toMatchObject({ status: 'approved', outdated: false, approvedAtShip: false });
    await editEntry(entry, 'Edited after ship');
    expect((await getSet(set.id)).approval).toMatchObject({ status: 'approved', outdated: false });
    // A shipped set cannot be sent for approval or back again.
    expect(codeOf(await approval(admin, set.id, 'request'))).toBe('CHANGE_SET_STATE');
    expect(codeOf(await approval(admin, set.id, 'request-changes', { note: 'x' }))).toBe('CHANGE_SET_STATE');
  });

  it('keeps an approval given before ship current after ship, whatever the drafts do', async () => {
    const { set, entry } = await setWithEntry('Approved then shipped');
    expectStatus(await approval(admin, set.id, 'approve'), 200);
    expectStatus(await ship(set.id), 200);
    await editEntry(entry, 'Edited later');
    expect((await getSet(set.id)).approval).toMatchObject({
      status: 'approved',
      outdated: false,
      approvedAtShip: true,
    });
  });

  it('lets changes.manage ask for approval and only changes.approve approve or send back', async () => {
    const grant = (action: string) => ({ action, modelId: null, condition: null, fieldIds: null });
    expectStatus(
      await admin.post('/api/admin/roles', {
        key: 'approval-preparer',
        name: 'Preparer',
        kind: 'admin',
        permissions: ['read', 'create', 'update', 'changes.manage'].map(grant),
      }),
      201,
    );
    const preparer = schemaClient(
      testApp.app,
      await createRoleToken(database.current.db, 'approval-preparer'),
    );
    const { set } = await setWithEntry('Needs an approver');
    expectStatus(await approval(preparer, set.id, 'request'), 200);
    expect((await approval(preparer, set.id, 'approve')).statusCode).toBe(403);
    expect((await approval(preparer, set.id, 'request-changes', { note: 'x' })).statusCode).toBe(403);
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expectStatus(await approval(editor, set.id, 'approve'), 200);
  });

  it('lists sets awaiting approval (the Inbox) and refuses transitions on discarded sets', async () => {
    const { set } = await setWithEntry('Awaiting approval');
    expectStatus(await approval(admin, set.id, 'request'), 200);
    const page = expectStatus(await admin.get('/api/admin/change-sets?approval=requested'), 200).json<{
      items: Array<{ id: string; approval: Approval }>;
    }>();
    expect(page.items.map((item) => item.id)).toContain(set.id);
    expect(page.items.every((item) => item.approval.status === 'requested')).toBe(true);
    expect((await admin.get('/api/admin/change-sets?approval=maybe')).statusCode).toBe(400);

    expectStatus(await admin.post(`/api/admin/change-sets/${set.id}/discard`, {}), 200);
    expect(codeOf(await approval(admin, set.id, 'approve'))).toBe('CHANGE_SET_STATE');
  });
});
