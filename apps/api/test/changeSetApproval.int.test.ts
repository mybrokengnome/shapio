import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import type { Worker } from '../src/jobs/worker.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
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
 * Approval workflows on change sets (plan approval-workflows): the instance default a site inherits, a site
 * switching approval off or keeping its own workflow, stages with roles and required sign-offs, who may sign
 * (role on the site or on every site, self-approval, already signed), outdated rounds, the gates on ship and
 * schedule, `awaitingMe`, role deletion, the timeline and the webhook events.
 */
type Stage = { id: string; name: string; roleIds: string[]; required: number };
type Workflow = { stages: Stage[]; selfApproval: boolean };
type Approval = {
  status: string;
  note: string;
  round: number;
  outdated: boolean;
  approvedAtShip: boolean | null;
  eligible: boolean;
  eligibleReason: string | null;
  stage: { index: number; name: string; signed: number; required: number } | null;
  workflow: { stages: Array<Stage & { roleNames: string[] }> } | null;
  signoffs: Array<{ round: number; stageIndex: number; decision: string; current: boolean }>;
  approvedBy: { type: string } | null;
};
type ChangeSet = {
  id: string;
  status: string;
  version: number;
  error: { code: string } | null;
  approval: Approval;
};
type ErrorBody = { error: { code: string; details?: Record<string, unknown> } };
type WorkflowInput = { stages: Array<Omit<Stage, 'id'>>; selfApproval?: boolean };

const grant = (action: string) => ({ action, modelId: null, condition: null, fieldIds: null });
const REVIEWER_ACTIONS = ['read', 'create', 'update', 'publish', 'changes.manage', 'changes.approve'];

/** A client that signs requests with an admin session (cookie and CSRF header). */
const sessionClient = (app: TestApp['app'], session: TestSession): SchemaClient => {
  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: session.headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return {
    request: (options) => app.inject({ ...options, headers: { ...session.headers, ...options.headers } }),
    get: (url) => send('GET', url),
    post: (url, payload) => send('POST', url, payload),
    put: (url, payload) => send('PUT', url, payload),
    delete: (url) => send('DELETE', url),
  };
};

describe('change set approval workflows', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let siteId: string;
  const roles: Record<'editorial' | 'legal' | 'other', string> = { editorial: '', legal: '', other: '' };
  const people: Record<'editor1' | 'legal1' | 'legal2' | 'other1', SchemaClient> = {} as never;
  const workers: Worker[] = [];

  const codeOf = (response: LightMyRequestResponse) => response.json<ErrorBody>().error.code;
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
  const getSet = async (id: string, client = admin) =>
    expectStatus(await client.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSet>();
  const setWithEntry = async (title: string, creator = admin) => {
    const entry = await createEntry(title);
    const set = expectStatus(await creator.post('/api/admin/change-sets', { title }), 201).json<ChangeSet>();
    expectStatus(
      await creator.post(`/api/admin/change-sets/${set.id}/items`, {
        modelKey: 'page',
        entryId: entry.id,
        action: 'publish',
      }),
      200,
    );
    return { set: await getSet(set.id), entry };
  };
  const step = (client: SchemaClient, id: string, name: string, body: Record<string, unknown> = {}) =>
    client.post(`/api/admin/change-sets/${id}/approval/${name}`, body);
  const sign = async (client: SchemaClient, id: string) =>
    expectStatus(await step(client, id, 'approve'), 200).json<ChangeSet>();
  const ship = async (id: string) =>
    admin.post(`/api/admin/change-sets/${id}/ship`, { expectedVersion: (await getSet(id)).version });
  const schedule = async (id: string, at: Date) =>
    admin.post(`/api/admin/change-sets/${id}/schedule`, {
      at: at.toISOString(),
      expectedVersion: (await getSet(id)).version,
    });
  const setDefault = async (workflow: WorkflowInput | null) => {
    const current = expectStatus(await admin.get('/api/admin/network/approval'), 200).json<{
      version: number;
    }>();
    return expectStatus(
      await admin.put('/api/admin/network/approval', { expectedVersion: current.version, workflow }),
      200,
    ).json<{ version: number; workflow: Workflow | null }>();
  };
  const setSiteMode = async (mode: 'inherit' | 'off' | 'custom', workflow?: WorkflowInput) => {
    const current = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      version: number;
    }>();
    return expectStatus(
      await admin.put('/api/admin/site/change-sets', {
        expectedVersion: current.version,
        mode,
        ...(workflow ? { workflow } : {}),
      }),
      200,
    ).json<{ mode: string; effective: Workflow | null }>();
  };
  const awaiting = async (client: SchemaClient) =>
    expectStatus(
      await client.get('/api/admin/change-sets?status=open,failed&approval=requested&awaitingMe=true'),
      200,
    )
      .json<{ items: Array<{ id: string; approval: Approval }> }>()
      .items.map((item) => item.id);
  const twoStages = (): WorkflowInput => ({
    stages: [
      { name: 'Editorial', roleIds: [roles.editorial], required: 1 },
      { name: 'Legal', roleIds: [roles.legal], required: 2 },
    ],
  });
  const openToAdmin = (): WorkflowInput => ({
    stages: [{ name: 'Review', roleIds: [], required: 1 }],
    selfApproval: true,
  });

  const createRole = async (key: string) =>
    expectStatus(
      await admin.post('/api/admin/roles', {
        key,
        name: key[0]?.toUpperCase() + key.slice(1),
        kind: 'admin',
        permissions: REVIEWER_ACTIONS.map(grant),
      }),
      201,
    ).json<{ id: string }>().id;

  /** An admin holding `roleId` on this site only (`onSite`) or on every site. */
  const person = async (roleId: string, onSite: boolean) => {
    const created = await createAdmin(database.current.db, { roleKeys: [] });
    await database.current.db
      .insertInto('admin_user_roles')
      .values({ admin_user_id: created.id, role_id: roleId, site_id: onSite ? siteId : null })
      .execute();
    return sessionClient(testApp.app, await login(testApp.app, created));
  };

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    siteId =
      expectStatus(await admin.get('/api/admin/sites'), 200).json<Array<{ id: string }>>()[0]?.id ?? '';
    roles.editorial = await createRole('editorial');
    roles.legal = await createRole('legal');
    roles.other = await createRole('other');
    people.editor1 = await person(roles.editorial, true);
    people.legal1 = await person(roles.legal, false);
    people.legal2 = await person(roles.legal, true);
    people.other1 = await person(roles.other, true);
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.stop(500)));
    await testApp.app.close();
  });

  it('stores the instance default with its version, needs sites.manage, and every site inherits it', async () => {
    const initial = expectStatus(await admin.get('/api/admin/network/approval'), 200).json<{
      version: number;
      workflow: Workflow | null;
      sites: { inheriting: number; custom: unknown[]; off: unknown[] };
    }>();
    expect(initial).toMatchObject({
      version: 0,
      workflow: null,
      sites: { inheriting: 1, custom: [], off: [] },
    });
    const site = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<
      Record<string, unknown>
    >();
    expect(site).toMatchObject({ mode: 'inherit', inherited: null, effective: null });

    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    expect((await editor.get('/api/admin/network/approval')).statusCode).toBe(403);
    expect(
      (await editor.put('/api/admin/network/approval', { expectedVersion: 0, workflow: twoStages() }))
        .statusCode,
    ).toBe(403);

    const unknownRole = await admin.put('/api/admin/network/approval', {
      expectedVersion: 0,
      workflow: { stages: [{ name: 'X', roleIds: ['00000000-0000-4000-8000-000000000000'], required: 1 }] },
    });
    expect(unknownRole.statusCode).toBe(400);
    expect(codeOf(unknownRole)).toBe('APPROVAL_UNKNOWN_ROLE');
    const tooMany = await admin.put('/api/admin/network/approval', {
      expectedVersion: 0,
      workflow: { stages: [{ name: 'X', roleIds: [], required: 21 }] },
    });
    expect(tooMany.statusCode).toBe(400);

    const saved = await setDefault(twoStages());
    expect(saved.version).toBe(1);
    expect(saved.workflow?.stages.map((stage) => stage.name)).toEqual(['Editorial', 'Legal']);
    expect(saved.workflow?.stages.every((stage) => stage.id.length > 0)).toBe(true);
    const stale = await admin.put('/api/admin/network/approval', { expectedVersion: 0, workflow: null });
    expect(stale.statusCode).toBe(409);

    const inherited = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      effective: Workflow | null;
    }>();
    expect(inherited.effective?.stages).toHaveLength(2);
    const sites = expectStatus(await admin.get('/api/admin/sites'), 200).json<
      Array<{ requireApproval: boolean }>
    >();
    expect(sites[0]?.requireApproval).toBe(true);
  });

  it('runs two stages to approval: roles, required sign-offs, signed twice, awaitingMe, events and timeline', async () => {
    await setDefault(twoStages());
    const { set } = await setWithEntry('Two stage launch');
    expect(codeOf(await ship(set.id))).toBe('CHANGE_SET_NOT_APPROVED');

    const requested = expectStatus(
      await step(admin, set.id, 'request', { note: 'Please review' }),
      200,
    ).json<ChangeSet>();
    expect(requested.version).toBe(set.version);
    expect(requested.approval).toMatchObject({
      status: 'requested',
      round: 1,
      note: 'Please review',
      stage: { index: 0, name: 'Editorial', signed: 0, required: 1 },
    });
    expect(requested.approval.workflow?.stages.map((stage) => stage.roleNames)).toEqual([
      ['Editorial'],
      ['Legal'],
    ]);
    expect(await awaiting(people.editor1)).toContain(set.id);
    expect(await awaiting(people.legal1)).not.toContain(set.id);

    const legalTooEarly = await step(people.legal1, set.id, 'approve');
    expect(legalTooEarly.statusCode).toBe(403);
    expect(legalTooEarly.json<ErrorBody>().error).toMatchObject({
      code: 'CHANGE_SET_APPROVAL_NOT_ELIGIBLE',
      details: { reason: 'role' },
    });
    expect((await getSet(set.id, people.legal1)).approval).toMatchObject({
      eligible: false,
      eligibleReason: 'role',
    });

    const afterEditorial = await sign(people.editor1, set.id);
    expect(afterEditorial.approval.stage).toMatchObject({ index: 1, name: 'Legal', signed: 0, required: 2 });
    expect(await awaiting(people.legal1)).toContain(set.id);
    expect(await awaiting(people.editor1)).not.toContain(set.id);

    const other = await step(people.other1, set.id, 'approve');
    expect(other.statusCode).toBe(403);
    expect(other.json<ErrorBody>().error.details).toMatchObject({ reason: 'role' });

    // legal1 holds Legal on every site, legal2 on this site only: both count.
    const oneOfTwo = await sign(people.legal1, set.id);
    expect(oneOfTwo.approval).toMatchObject({
      status: 'requested',
      stage: { index: 1, signed: 1, required: 2 },
    });
    const twice = await step(people.legal1, set.id, 'approve');
    expect(twice.statusCode).toBe(403);
    expect(twice.json<ErrorBody>().error.details).toMatchObject({ reason: 'signed' });
    expect(await awaiting(people.legal1)).not.toContain(set.id);
    expect(await awaiting(people.legal2)).toContain(set.id);

    const approved = await sign(people.legal2, set.id);
    expect(approved.version).toBe(set.version);
    expect(approved.approval).toMatchObject({ status: 'approved', outdated: false, stage: null });
    expect(approved.approval.approvedBy).toMatchObject({ type: 'admin' });
    expect(approved.approval.signoffs.map((signoff) => [signoff.stageIndex, signoff.current])).toEqual([
      [0, true],
      [1, true],
      [1, true],
    ]);
    const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
    expect(shipped.approval).toMatchObject({ status: 'approved', approvedAtShip: true });

    const events = await database.current.db
      .selectFrom('outbox_events')
      .select(['type', 'payload'])
      .where('aggregate_id', '=', set.id)
      .orderBy('id')
      .execute();
    const approvalEvents = events.filter((event) => event.type !== 'change_set.shipped');
    expect(approvalEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'change_set.approval_requested',
        'change_set.approval_stage_completed',
        'change_set.approved',
      ]),
    );
    const stages = events
      .filter((event) => event.type === 'change_set.approval_stage_completed')
      .map((event) => (event.payload as { stage: { name: string } }).stage.name);
    expect(stages).toEqual(['Editorial', 'Legal']);

    const timeline = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/timeline`), 200).json<{
      items: Array<{ kind: string; approval: { stage: string | null; signed: number | null } | null }>;
    }>();
    expect(
      timeline.items.filter((event) => event.kind.startsWith('approval.')).map((event) => event.kind),
    ).toEqual([
      'approval.requested',
      'approval.signed',
      'approval.stageCompleted',
      'approval.signed',
      'approval.signed',
      'approval.stageCompleted',
      'approval.approved',
    ]);
    expect(timeline.items.find((event) => event.kind === 'approval.signed')?.approval).toMatchObject({
      stage: 'Editorial',
      signed: 1,
    });
  });

  it('refuses the creator or requester unless the workflow allows approving your own work', async () => {
    await setDefault(twoStages());
    const { set } = await setWithEntry('Created by an editor', people.editor1);
    expectStatus(await step(admin, set.id, 'request'), 200);
    const own = await step(people.editor1, set.id, 'approve');
    expect(own.statusCode).toBe(403);
    expect(own.json<ErrorBody>().error.details).toMatchObject({ reason: 'self' });
    expect(await awaiting(people.editor1)).not.toContain(set.id);

    await setDefault({ ...twoStages(), selfApproval: true });
    // The frozen workflow still forbids it until approval is asked for again.
    expect((await step(people.editor1, set.id, 'approve')).statusCode).toBe(403);
    expectStatus(await step(admin, set.id, 'request'), 200);
    expect((await sign(people.editor1, set.id)).approval.stage?.name).toBe('Legal');
  });

  it('makes a review outdated when a draft moves mid-round; asking again starts round 2 at stage 1', async () => {
    await setDefault(twoStages());
    const { set, entry } = await setWithEntry('Edited mid review');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await sign(people.editor1, set.id);
    await editEntry(entry, 'Changed mid review');
    const view = await getSet(set.id, people.legal1);
    expect(view.approval).toMatchObject({
      status: 'requested',
      outdated: true,
      eligible: false,
      eligibleReason: 'outdated',
    });
    const refused = await step(people.legal1, set.id, 'approve');
    expect(refused.statusCode).toBe(409);
    expect(codeOf(refused)).toBe('CHANGE_SET_APPROVAL_STALE');
    expect(await awaiting(people.legal1)).not.toContain(set.id);

    const again = expectStatus(await step(admin, set.id, 'request'), 200).json<ChangeSet>();
    expect(again.approval).toMatchObject({
      round: 2,
      outdated: false,
      stage: { index: 0, name: 'Editorial' },
    });
    expect(again.approval.signoffs).toEqual([
      expect.objectContaining({ round: 1, stageIndex: 0, current: false }),
    ]);
  });

  it('ends the round when changes are requested at stage 2; ship and schedule are refused; clear resets', async () => {
    await setDefault(twoStages());
    const { set } = await setWithEntry('Sent back by legal');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await sign(people.editor1, set.id);
    expect((await step(people.legal1, set.id, 'request-changes', {})).statusCode).toBe(400);
    const sentBack = expectStatus(
      await step(people.legal1, set.id, 'request-changes', { note: 'Fix the title' }),
      200,
    ).json<ChangeSet>();
    expect(sentBack.approval).toMatchObject({
      status: 'changes_requested',
      note: 'Fix the title',
      stage: null,
    });
    expect(codeOf(await ship(set.id))).toBe('CHANGE_SET_NOT_APPROVED');
    expect(codeOf(await schedule(set.id, new Date(Date.now() + 3_600_000)))).toBe('CHANGE_SET_NOT_APPROVED');
    expect(codeOf(await step(people.legal2, set.id, 'approve'))).toBe('CHANGE_SET_APPROVAL_NOT_REQUESTED');
    const cleared = expectStatus(await step(admin, set.id, 'clear'), 200).json<ChangeSet>();
    expect(cleared.approval).toMatchObject({ status: 'none', note: '', requestedBy: null });
    expect(cleared.approval.signoffs).toHaveLength(2);
  });

  it('lets a site switch approval off (ships, refuses requests) or keep its own workflow', async () => {
    await setDefault(twoStages());
    const off = await setSiteMode('off');
    expect(off.effective).toBeNull();
    const { set } = await setWithEntry('No approval here');
    const notConfigured = await step(admin, set.id, 'request');
    expect(notConfigured.statusCode).toBe(409);
    expect(codeOf(notConfigured)).toBe('CHANGE_SET_APPROVAL_NOT_CONFIGURED');
    expectStatus(await ship(set.id), 200);
    const network = expectStatus(await admin.get('/api/admin/network/approval'), 200).json<{
      sites: { inheriting: number; off: Array<{ id: string }> };
    }>();
    expect(network.sites).toMatchObject({ inheriting: 0, off: [{ id: siteId }] });

    const noWorkflow = await admin.put('/api/admin/site/change-sets', {
      expectedVersion: 99,
      mode: 'custom',
    });
    expect(codeOf(noWorkflow)).toBe('APPROVAL_WORKFLOW_REQUIRED');
    const stale = await admin.put('/api/admin/site/change-sets', { expectedVersion: 1, mode: 'off' });
    expect(codeOf(stale)).toBe('VERSION_CONFLICT');
    const custom = await setSiteMode('custom', openToAdmin());
    expect(custom.effective?.stages.map((stage) => stage.name)).toEqual(['Review']);
    const { set: own } = await setWithEntry('Own workflow');
    const requested = expectStatus(await step(admin, own.id, 'request'), 200).json<ChangeSet>();
    expect(requested.approval.stage?.name).toBe('Review');
    expect((await sign(admin, own.id)).approval.status).toBe('approved');
    expectStatus(await ship(own.id), 200);
    // Switching away keeps the site's workflow for later.
    const back = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      version: number;
    }>();
    expectStatus(
      await admin.put('/api/admin/site/change-sets', { expectedVersion: back.version, mode: 'inherit' }),
      200,
    );
    const kept = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      workflow: Workflow | null;
      effective: Workflow | null;
    }>();
    expect(kept.workflow?.stages[0]?.name).toBe('Review');
    expect(kept.effective?.stages).toHaveLength(2);
  });

  it('keeps a frozen review when the default changes; turning approval off lets it ship and ends the review', async () => {
    await setSiteMode('inherit');
    await setDefault(twoStages());
    const { set } = await setWithEntry('Frozen review');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await setDefault(openToAdmin());
    const view = await getSet(set.id);
    expect(view.approval.workflow?.stages.map((stage) => stage.name)).toEqual(['Editorial', 'Legal']);
    expect(view.approval.stage?.name).toBe('Editorial');

    await setDefault(null);
    expect(expectStatus(await ship(set.id), 200).json<ChangeSet>().approval).toMatchObject({
      status: 'none',
      approvedAtShip: false,
    });
  });

  it('refuses deleting a role a workflow names, and fails closed when a frozen stage lost all its roles', async () => {
    const deletable = await createRole('deletable');
    await setDefault({ stages: [{ name: 'Gone soon', roleIds: [deletable], required: 1 }] });
    const inUse = await admin.delete(`/api/admin/roles/${deletable}`);
    expect(inUse.statusCode).toBe(409);
    expect(codeOf(inUse)).toBe('ROLE_IN_USE');

    const { set } = await setWithEntry('Orphaned stage');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await setDefault(openToAdmin());
    expect((await admin.delete(`/api/admin/roles/${deletable}`)).statusCode).toBe(204);
    const view = await getSet(set.id);
    expect(view.approval).toMatchObject({ eligible: false, eligibleReason: 'rolesDeleted' });
    expect(view.approval.workflow?.stages[0]?.roleNames).toEqual([]);
    const closed = await step(admin, set.id, 'approve');
    expect(closed.statusCode).toBe(403);
    expect(closed.json<ErrorBody>().error.details).toMatchObject({ reason: 'rolesDeleted' });
    // The way out: ask again under the current workflow.
    expectStatus(await step(admin, set.id, 'request'), 200);
    expect((await sign(admin, set.id)).approval.status).toBe('approved');
    await setDefault(null);
  });

  it('fails a scheduled ship whose draft moved after approval, with the reason on the set', async () => {
    await setDefault(openToAdmin());
    const { set, entry } = await setWithEntry('Scheduled and edited');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await sign(admin, set.id);
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
    await setDefault(null);
  });

  it('keeps an approval given before ship current after ship, whatever the drafts do', async () => {
    await setDefault(openToAdmin());
    const { set, entry } = await setWithEntry('Approved then shipped');
    expectStatus(await step(admin, set.id, 'request'), 200);
    await sign(admin, set.id);
    expectStatus(await ship(set.id), 200);
    await editEntry(entry, 'Edited later');
    expect((await getSet(set.id)).approval).toMatchObject({
      status: 'approved',
      outdated: false,
      approvedAtShip: true,
    });
    // Shipped: no new review.
    expect(codeOf(await step(admin, set.id, 'request'))).toBe('CHANGE_SET_STATE');
    expect(codeOf(await step(admin, set.id, 'approve'))).toBe('CHANGE_SET_STATE');
    await setDefault(null);
  });

  it('needs changes.approve to sign off, and refuses steps on discarded sets and unknown filters', async () => {
    await setDefault(openToAdmin());
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
    expectStatus(await step(preparer, set.id, 'request'), 200);
    expect((await step(preparer, set.id, 'approve')).statusCode).toBe(403);
    expect((await getSet(set.id, preparer)).approval.eligible).toBe(false);
    expect(await awaiting(preparer)).not.toContain(set.id);
    expect((await admin.get('/api/admin/change-sets?approval=maybe')).statusCode).toBe(400);

    expectStatus(await admin.post(`/api/admin/change-sets/${set.id}/discard`, {}), 200);
    expect(codeOf(await step(admin, set.id, 'approve'))).toBe('CHANGE_SET_STATE');
    await setDefault(null);
  });

  it('refuses switching a site to its own workflow when that stored workflow names a deleted role', async () => {
    await setDefault(null);
    const gone = await createRole('stored-gone');
    await setSiteMode('custom', { stages: [{ name: 'Stored', roleIds: [gone], required: 1 }] });
    await setSiteMode('inherit');
    // Allowed: no default and no custom site names it now; the site only keeps it stored.
    expect((await admin.delete(`/api/admin/roles/${gone}`)).statusCode).toBe(204);
    const current = expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{
      version: number;
    }>();
    const refused = await admin.put('/api/admin/site/change-sets', {
      expectedVersion: current.version,
      mode: 'custom',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<ErrorBody>().error).toMatchObject({
      code: 'APPROVAL_UNKNOWN_ROLE',
      details: { roleIds: [gone] },
    });
    expect(
      expectStatus(await admin.get('/api/admin/site/change-sets'), 200).json<{ mode: string }>().mode,
    ).toBe('inherit');
  });
});
