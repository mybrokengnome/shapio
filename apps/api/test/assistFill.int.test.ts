import { randomUUID } from 'node:crypto';
import { SEO_COMPONENT_ID } from '@shapio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssistRuntime } from '../src/assist/runtime.js';
import { ASSIST_CONTENT_OPS_JOB } from '../src/constants/assist.js';
import { createContentPorts } from '../src/content/ports.js';
import { createUrlBuilder } from '../src/helpers/publicUrl.js';
import { createAssistJobHandlers } from '../src/jobs/assistContentOps.js';
import {
  CONTENT_HEALTH_JOBS,
  contentHealthOutboxSubscriber,
  createContentHealthJobHandlers,
} from '../src/jobs/contentHealth.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createMediaStorage } from '../src/media/storage.js';
import { createPublishingJobEnvironment } from '../src/publishing/jobEnvironment.js';
import { createPublishingRuntime } from '../src/publishing/runtime.js';
import { createSchemaJobHandlers } from '../src/schema/planner/changeJob.js';
import { SCHEMA_CHANGE_JOB, SCHEMA_FOLLOW_UP_JOB } from '../src/schema/planner/prerequisites.js';
import { startFakeLlm, type FakeLlm, type FakeLlmCall } from './fixtures/fakeLlm.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { drainJobs } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Proposal = {
  key: string;
  entryId: string;
  modelKey: string;
  entryTitle: string | null;
  locale: string;
  fieldPath: string;
  fieldLabel: string;
  fieldType: string;
  proposedValue: string | string[];
  entryVersion: number;
};
type Skip = { key: string; entryId?: string; reason: string; detail?: unknown };
type FillRun = {
  status: string;
  rule: string;
  error: { code: string } | null;
  result: { rule: string; proposals: Proposal[]; skipped: Skip[]; scanCapped: boolean } | null;
};
type Accepted = {
  entryId: string;
  locale: string;
  version: number;
  changeSet: { added: boolean; id: string | null; reason?: string };
};
type ChangeSetView = {
  id: string;
  title: string;
  source: string;
  items: { entryId: string; locale: string; action: string }[];
};

const JOB_TYPES = [
  ...Object.values(CONTENT_HEALTH_JOBS),
  ASSIST_CONTENT_OPS_JOB,
  SCHEMA_CHANGE_JOB,
  SCHEMA_FOLLOW_UP_JOB,
];

/** Answers the suggest prompt by the field it names. */
const suggestions = (call: FakeLlmCall) => {
  if (!call.system.startsWith('You suggest a value for a field')) {
    return { text: 'unexpected' };
  }
  const answers: [string, string][] = [
    ['"Keywords"', 'harbour, boats'],
    ['"Summary"', 'A short summary.'],
    ['"Subtitle"', 'A subtitle'],
    ['"SEO › Title"', 'An SEO title'],
    ['"Note"', 'A note'],
    ['"Topics"', JSON.stringify({ values: ['travel'] })],
  ];
  return { text: answers.find(([label]) => call.system.includes(label))?.[1] ?? 'value' };
};

/** Fill runs (plan write-and-fill): proposals for empty fields, accepted into drafts and one change set. */
describe('assist fill', () => {
  const database = useTestDatabase();
  let fake: FakeLlm;
  let testApp: TestApp;
  let owner: SchemaClient;
  let worker: Worker;
  let page: ModelBody;
  let card: ModelBody;
  const entries: Record<string, EntryBody> = {};

  const drain = () => drainJobs(worker, database.current.db, { types: JOB_TYPES });
  const codeOf = (response: { json: <T>() => T }) => response.json<{ error: { code: string } }>().error.code;

  const runFill = async (body: Record<string, unknown>, client = owner) => {
    const { runId } = expectStatus(
      await client.post('/api/admin/assist/content-ops/propose', body),
      202,
    ).json<{
      runId: string;
    }>();
    await drain();
    const run = expectStatus(await client.get(`/api/admin/assist/content-ops/${runId}`), 200).json<FillRun>();
    expect(run).toMatchObject({ status: 'succeeded', error: null });
    return { runId, result: run.result as NonNullable<FillRun['result']> };
  };
  const accept = (runId: string, items: { key: string; value: unknown }[], client = owner) =>
    client.post(`/api/admin/assist/content-ops/${runId}/accept`, { items });
  const proposalsOf = (result: NonNullable<FillRun['result']>, entryId: string) =>
    result.proposals.filter((proposal) => proposal.entryId === entryId);
  const asItems = (proposals: readonly Proposal[]) =>
    proposals.map((proposal) => ({ key: proposal.key, value: proposal.proposedValue }));
  const create = async (modelKey: string, data: Record<string, unknown>, publish: boolean) => {
    const created = expectStatus(
      await owner.post(`/api/admin/content/${modelKey}`, { data }),
      201,
    ).json<EntryBody>();
    if (publish) {
      expectStatus(await owner.post(`/api/admin/content/${modelKey}/${created.id}/publish`, {}), 200);
    }
    return created;
  };
  const draftOf = async (modelKey: string, id: string) =>
    expectStatus(await owner.get(`/api/admin/content/${modelKey}/${id}`), 200).json<EntryBody>();
  const makeRequired = async (model: ModelBody, apiKeys: readonly string[]) => {
    const current = expectStatus(
      await owner.get(`/api/admin/models/${model.definition.id}`),
      200,
    ).json<ModelBody>();
    const changed = await owner.put(`/api/admin/models/${model.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map((field) =>
          apiKeys.includes(field.apiKey) ? { ...field, required: true } : field,
        ),
      },
      expectedVersion: current.version,
    });
    expect(changed.statusCode, changed.body).toBe(202);
    await drain();
  };

  beforeAll(async () => {
    fake = await startFakeLlm(suggestions);
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: {
        AI_PROVIDER: 'anthropic',
        AI_MODEL: 'fake-model-1',
        AI_API_KEY: 'sk-test-secret',
        AI_BASE_URL: fake.baseUrl,
        AI_RATE_LIMIT_MAX: '1000',
      },
    });
    owner = schemaClient(testApp.app, await createRoleToken(database.current.db, 'owner'));
    const runtime = createPublishingRuntime({
      db: database.current.db,
      signingSecret: testApp.app.signingSecret,
      urls: createUrlBuilder(testApp.config.server),
      config: testApp.config.publishing,
      log: silentLogger,
    });
    worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers([
        ...createContentHealthJobHandlers({ db: database.current.db, staleDays: 14, log: silentLogger }),
        ...createSchemaJobHandlers({
          db: database.current.db,
          ports: createContentPorts(database.current.db),
        }),
        ...createAssistJobHandlers({
          environment: createPublishingJobEnvironment(runtime),
          assist: createAssistRuntime(testApp.config.assist, runtime.resolve),
          storage: await createMediaStorage(testApp.config.storage, {
            urls: createUrlBuilder(testApp.config.server),
          }),
        }),
      ]),
      subscribers: [contentHealthOutboxSubscriber],
      workerId: `test-${randomUUID()}`,
      concurrency: 2,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
    expectStatus(await owner.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    expectStatus(await owner.post('/api/admin/components/builtin/seo/ensure', {}), 201);
    page = await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true, localized: true },
        { apiKey: 'summary', label: 'Summary', type: 'text', localized: true },
        { apiKey: 'keywords', label: 'Keywords', type: 'string', localized: true },
        { apiKey: 'subtitle', label: 'Subtitle', type: 'string', localized: true },
        {
          apiKey: 'seo',
          label: 'SEO',
          type: 'component',
          localized: true,
          settings: { component: SEO_COMPONENT_ID },
        },
      ],
    });
    card = await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'card',
      label: 'Card',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'image', label: 'Image', type: 'media', settings: { allowedKinds: ['image'] } },
        { apiKey: 'tagline', label: 'Tagline', type: 'string' },
      ],
    });
    entries.alpha = await create('page', { title: 'Alpha' }, true);
    entries.beta = await create('page', { title: 'Beta' }, false);
    entries.gamma = await create('page', { title: 'Gamma' }, true);
    const gamma = await draftOf('page', entries.gamma.id);
    expectStatus(
      await owner.put(`/api/admin/content/page/${gamma.id}`, {
        expectedVersion: gamma.version,
        data: { title: 'Gamma two' },
      }),
      200,
    );
    entries.kite = await create('card', { title: 'Kite' }, true);
    await makeRequired(page, ['summary', 'keywords']);
    await makeRequired(card, ['image', 'tagline']);
  });
  afterAll(async () => {
    await worker?.stop(1000);
    await testApp.app.close();
    await fake.close();
  });

  let required: { runId: string; result: NonNullable<FillRun['result']> };

  it('requiredEmpty: proposes values per entry locale and skips what no accept could save', async () => {
    fake.reset();
    const revisionsBefore = await database.current.db
      .selectFrom('content_revisions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    required = await runFill({ rule: 'requiredEmpty' });
    const { result } = required;
    expect(result.rule).toBe('requiredEmpty');
    expect(result.scanCapped).toBe(false);
    for (const name of ['alpha', 'beta', 'gamma']) {
      expect(
        proposalsOf(result, entries[name]?.id ?? '')
          .map((proposal) => proposal.fieldPath)
          .sort(),
      ).toEqual(['/keywords', '/summary']);
    }
    expect(
      result.proposals.find((proposal) => proposal.key === `entry:${entries.alpha?.id}:en:/keywords`),
    ).toEqual(
      expect.objectContaining({
        entryId: entries.alpha?.id,
        modelKey: 'page',
        entryTitle: 'Alpha',
        locale: 'en',
        fieldPath: '/keywords',
        fieldLabel: 'Keywords',
        fieldType: 'string',
        proposedValue: 'harbour, boats',
      }),
    );
    // The card's tagline could be proposed, but its required image can't be: no accept could save it.
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `entry:${entries.kite?.id}:en:/tagline`,
          reason: 'otherRequiredEmpty',
          detail: { paths: ['/image'] },
        }),
        expect.objectContaining({
          key: `entry:${entries.kite?.id}:en:/image`,
          reason: 'fieldNotSuggestible',
        }),
      ]),
    );
    expect(fake.calls).toHaveLength(6);
    // Nothing was written.
    const revisionsAfter = await database.current.db
      .selectFrom('content_revisions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    expect(revisionsAfter.count).toBe(revisionsBefore.count);
  });

  it('accepts all fields of an entry at once into one change set, never publishing', async () => {
    const { runId, result } = required;
    const alpha = proposalsOf(result, entries.alpha?.id ?? '');
    // One required field alone can't be saved while the other is still empty.
    const alone = expectStatus(await accept(runId, asItems(alpha.slice(0, 1))), 422);
    expect(codeOf(alone)).toBe('CONTENT_INVALID');

    const first = expectStatus(await accept(runId, asItems(alpha)), 200).json<Accepted>();
    expect(first).toMatchObject({ entryId: entries.alpha?.id, locale: 'en', changeSet: { added: true } });
    const setId = first.changeSet.id ?? '';
    // A repeated accept answers as the first did and writes nothing more.
    expect(expectStatus(await accept(runId, asItems(alpha)), 200).json<Accepted>()).toEqual(first);
    const draft = await draftOf('page', entries.alpha?.id ?? '');
    expect(draft.data).toMatchObject({ summary: 'A short summary.', keywords: 'harbour, boats' });
    expect(draft.version).toBe(first.version);

    const beta = expectStatus(
      await accept(runId, asItems(proposalsOf(result, entries.beta?.id ?? ''))),
      200,
    ).json<Accepted>();
    expect(beta.changeSet).toEqual({ added: false, id: setId, reason: 'neverPublished' });
    const gamma = expectStatus(
      await accept(runId, asItems(proposalsOf(result, entries.gamma?.id ?? ''))),
      200,
    ).json<Accepted>();
    expect(gamma.changeSet).toEqual({ added: false, id: setId, reason: 'unpublishedChanges' });

    const set = expectStatus(await owner.get(`/api/admin/change-sets/${setId}`), 200).json<ChangeSetView>();
    expect(set).toMatchObject({
      source: 'assist',
      title: 'Filled required fields, proposed by fake-model-1',
    });
    expect(set.items).toEqual([
      expect.objectContaining({ entryId: entries.alpha?.id, locale: 'en', action: 'publish' }),
    ]);
    const run = await database.current.db
      .selectFrom('assist_runs')
      .select('change_set_id')
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run.change_set_id).toBe(setId);
    // The published version is untouched until the set ships.
    const published = await database.current.db
      .selectFrom('entry_heads')
      .select('data')
      .where('entry_id', '=', entries.alpha?.id ?? '')
      .where('state', '=', 'published')
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(published.data)).not.toContain('A short summary.');
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select(['metadata', 'target_id'])
      .where('action', '=', 'assist.content_ops_accept')
      .execute();
    expect(audit).toHaveLength(4);
    const forAlpha = audit.filter((row) => row.target_id === entries.alpha?.id);
    expect(forAlpha).toHaveLength(2);
    expect(forAlpha[0]?.metadata).toMatchObject({
      runId,
      fields: alpha.map((proposal) => proposal.fieldPath),
      addedToChangeSet: true,
    });
  });

  it('refuses accepts that mix entries, name unknown proposals or have the wrong shape', async () => {
    const { runId, result } = required;
    const [alphaKeywords] = proposalsOf(result, entries.alpha?.id ?? '');
    const [betaSummary] = proposalsOf(result, entries.beta?.id ?? '');
    const mixed = expectStatus(await accept(runId, asItems([alphaKeywords!, betaSummary!])), 400);
    expect(codeOf(mixed)).toBe('ASSIST_ACCEPT_ITEMS_INVALID');
    const unknown = expectStatus(await accept(runId, [{ key: 'entry:nope:en:/title', value: 'x' }]), 404);
    expect(codeOf(unknown)).toBe('ASSIST_PROPOSAL_NOT_FOUND');
    const shape = expectStatus(await accept(runId, [{ key: alphaKeywords!.key, value: ['a'] }]), 400);
    expect(codeOf(shape)).toBe('ASSIST_ACCEPT_ITEMS_INVALID');
    expect(codeOf(expectStatus(await accept(randomUUID(), asItems([alphaKeywords!])), 404))).toBe(
      'ASSIST_RUN_NOT_FOUND',
    );
  });

  it('fieldEmpty: fills a single component field, skips unsaved work, reopens a discarded set', async () => {
    const delta = await create('page', { title: 'Delta', summary: 'S', keywords: 'K' }, true);
    const echo = await create('page', { title: 'Echo', summary: 'S', keywords: 'K' }, true);
    const gamma = await draftOf('page', entries.gamma?.id ?? '');
    expectStatus(
      await owner.put(`/api/admin/content/page/${gamma.id}`, {
        expectedVersion: gamma.version,
        autosave: true,
        data: { title: 'Gamma three' },
      }),
      200,
    );
    const { runId, result } = await runFill({
      rule: 'fieldEmpty',
      modelKey: 'page',
      fieldPath: '/seo/title',
    });
    expect(result.scanCapped).toBe(false);
    expect(result.proposals.map((proposal) => proposal.entryId).sort()).toEqual(
      [entries.alpha?.id, entries.beta?.id, delta.id, echo.id].sort(),
    );
    expect(result.proposals[0]).toMatchObject({ fieldPath: '/seo/title', fieldLabel: 'SEO › Title' });
    expect(result.skipped).toEqual([expect.objectContaining({ entryId: gamma.id, reason: 'unsavedWork' })]);

    const forDelta = expectStatus(
      await accept(runId, asItems(proposalsOf(result, delta.id))),
      200,
    ).json<Accepted>();
    expect(forDelta.changeSet.added).toBe(true);
    const deltaDraft = await draftOf('page', delta.id);
    expect(deltaDraft.data.seo).toMatchObject({ title: 'An SEO title' });
    const firstSet = forDelta.changeSet.id ?? '';
    const set = expectStatus(
      await owner.get(`/api/admin/change-sets/${firstSet}`),
      200,
    ).json<ChangeSetView>();
    expect(set.title).toBe('Filled SEO › Title, proposed by fake-model-1');
    expectStatus(await owner.post(`/api/admin/change-sets/${firstSet}/discard`, {}), 200);
    const forEcho = expectStatus(
      await accept(runId, asItems(proposalsOf(result, echo.id))),
      200,
    ).json<Accepted>();
    expect(forEcho.changeSet.added).toBe(true);
    expect(forEcho.changeSet.id).not.toBe(firstSet);
  });

  it('fieldEmpty: a field filled after the proposal is not overwritten', async () => {
    const { runId, result } = await runFill({ rule: 'fieldEmpty', modelKey: 'page', fieldPath: '/subtitle' });
    const beta = await draftOf('page', entries.beta?.id ?? '');
    expectStatus(
      await owner.put(`/api/admin/content/page/${beta.id}`, {
        expectedVersion: beta.version,
        data: { subtitle: 'Written by a person' },
      }),
      200,
    );
    const refused = expectStatus(await accept(runId, asItems(proposalsOf(result, beta.id))), 409);
    expect(codeOf(refused)).toBe('ASSIST_FIELD_FILLED_MEANWHILE');
    expect((await draftOf('page', beta.id)).data.subtitle).toBe('Written by a person');
  });

  it('fieldEmpty: accepts a one-value list for a multiple enum', async () => {
    await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'trip',
      label: 'Trip',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'topics',
          label: 'Topics',
          type: 'enum',
          settings: {
            multiple: true,
            values: [
              { value: 'travel', label: 'Travel' },
              { value: 'food', label: 'Food' },
            ],
          },
        },
      ],
    });
    const trip = await create('trip', { title: 'Lisbon' }, true);
    const { runId, result } = await runFill({ rule: 'fieldEmpty', modelKey: 'trip', fieldPath: '/topics' });
    expect(result.proposals).toEqual([
      expect.objectContaining({
        fieldType: 'enum',
        multiple: true,
        proposedValue: ['travel'],
        options: [
          { value: 'travel', label: 'Travel' },
          { value: 'food', label: 'Food' },
        ],
      }),
    ]);
    expectStatus(await accept(runId, asItems(result.proposals)), 200);
    expect((await draftOf('trip', trip.id)).data.topics).toEqual(['travel']);
  });

  it('caps a run at 50 entries', async () => {
    await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'memo',
      label: 'Memo',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'note', label: 'Note', type: 'string' },
      ],
    });
    for (let index = 0; index < 52; index += 1) {
      expectStatus(await owner.post('/api/admin/content/memo', { data: { title: `Memo ${index}` } }), 201);
    }
    const { result } = await runFill({ rule: 'fieldEmpty', modelKey: 'memo', fieldPath: '/note' });
    expect(result.proposals).toHaveLength(50);
  });

  it('checks the input and needs changes.manage to start and to accept', async () => {
    const refuse = async (body: Record<string, unknown>, code: string) =>
      expect(codeOf(expectStatus(await owner.post('/api/admin/assist/content-ops/propose', body), 400))).toBe(
        code,
      );
    await refuse({ rule: 'fieldEmpty', modelKey: 'page' }, 'ASSIST_CONTENT_OPS_INPUT_INVALID');
    await refuse({ rule: 'requiredEmpty', fieldPath: '/summary' }, 'ASSIST_CONTENT_OPS_INPUT_INVALID');
    await refuse(
      { rule: 'fieldEmpty', modelKey: 'card', fieldPath: '/image' },
      'ASSIST_FIELD_NOT_SUGGESTIBLE',
    );

    const readerRole = await createRole(database.current.db, 'admin', [{ action: 'read', modelId: null }]);
    const reader = schemaClient(testApp.app, await createTokenForRole(database.current.db, readerRole));
    expectStatus(await reader.post('/api/admin/assist/content-ops/propose', { rule: 'requiredEmpty' }), 403);
    const [proposal] = required.result.proposals;
    expectStatus(await accept(required.runId, asItems([proposal!]), reader), 403);
  });
});
