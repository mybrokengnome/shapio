import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUBLISHING_JOBS } from '../src/constants/publishing.js';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import type { Worker } from '../src/jobs/worker.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import {
  createPublishingTestApp,
  createPublishingWorker,
  drainJobs,
  startReceiver,
} from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Change sets with schema items (developer-face plan §5): drafts, the review, a ship that activates the
 * schema and publishes entries in ONE transaction and ONE snapshot (inline, and through the prerequisite
 * job with value conversions), prerequisite failure, restore to an earlier snapshot, and ship-with-deploy.
 */
type ChangeSet = {
  id: string;
  status: string;
  shipPhase: string | null;
  version: number;
  shippedSnapshot: number | null;
  schemaVersionAfter: number | null;
  deploymentRunId: string | null;
  error: { code: string; message: string } | null;
  items: Array<{
    id: string;
    kind: string;
    entryId?: string;
    definitionId?: string;
    status: string;
    action?: string;
  }>;
};

type Draft = { id: string; version: number; operation: string; baseVersion: number | null };

describe('change sets (schema + content)', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let worker: Worker;
  let deliveryToken: string;
  let article: ModelBody;

  const reloadModel = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/models/${id}`), 200).json<ModelBody>();
  /** `body` is plain text until the conversion test makes it rich text. */
  const createArticle = async (title: string, body?: string) =>
    expectStatus(
      await admin.post('/api/admin/content/article', {
        data: { title, ...(body === undefined ? {} : { body }) },
      }),
      201,
    ).json<EntryBody>();
  const publish = async (id: string) =>
    expectStatus(await admin.post(`/api/admin/content/article/${id}/publish`, {}), 200);
  const edit = async (id: string, data: Record<string, unknown>) => {
    const current = expectStatus(await admin.get(`/api/admin/content/article/${id}`), 200).json<EntryBody>();
    return expectStatus(
      await admin.put(`/api/admin/content/article/${id}`, { expectedVersion: current.version, data }),
      200,
    );
  };
  const deliver = (id: string, query = '') =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/content/articles/${id}${query}`,
      headers: { authorization: `Bearer ${deliveryToken}` },
    });
  const createSet = async (title: string) =>
    expectStatus(await admin.post('/api/admin/change-sets', { title }), 201).json<ChangeSet>();
  const getSet = async (id: string) =>
    expectStatus(await admin.get(`/api/admin/change-sets/${id}`), 200).json<ChangeSet>();
  const addItem = async (setId: string, entryId: string, action = 'publish') =>
    expectStatus(
      await admin.post(`/api/admin/change-sets/${setId}/items`, { modelKey: 'article', entryId, action }),
      200,
    ).json<ChangeSet>();
  const putDraft = (
    setId: string,
    model: ModelBody,
    definition: unknown,
    extra: Record<string, unknown> = {},
  ) =>
    admin.put(`/api/admin/change-sets/${setId}/schema/${model.definition.id}`, {
      category: 'model',
      definition,
      baseVersion: model.version,
      ...extra,
    });
  const ship = async (setId: string, body: Record<string, unknown> = {}) =>
    admin.post(`/api/admin/change-sets/${setId}/ship`, {
      expectedVersion: (await getSet(setId)).version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
      ...body,
    });
  const drain = () =>
    drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.changeSetShip, 'schema.followUp'] });
  const fieldsWith = (model: ModelBody, extra: unknown[]) => ({
    ...model.definition,
    fields: [...model.definition.fields, ...extra],
  });

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    worker = createPublishingWorker({ db: database.current.db, app: testApp.app });
    article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'body', label: 'Body', type: 'text' },
      ],
    });
    deliveryToken = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
  });

  afterAll(async () => {
    await worker.stop(500);
    await testApp.app.close();
  });

  it('stores schema drafts with optimistic concurrency and validates them like the builder', async () => {
    const set = await createSet('Drafts');
    const proposal = fieldsWith(article, [{ apiKey: 'note', label: 'Note', type: 'string' }]);
    const draft = expectStatus(await putDraft(set.id, article, proposal), 200).json<Draft>();
    expect(draft).toMatchObject({ version: 1, operation: 'update', baseVersion: article.version });
    expect((await putDraft(set.id, article, proposal)).statusCode).toBe(409);
    expect(
      expectStatus(await putDraft(set.id, article, proposal, { expectedDraftVersion: 1 }), 200).json<Draft>()
        .version,
    ).toBe(2);
    expect((await putDraft(set.id, article, proposal, { expectedDraftVersion: 1 })).statusCode).toBe(409);
    const invalid = await putDraft(
      set.id,
      article,
      fieldsWith(article, [{ apiKey: '1bad', label: 'Bad', type: 'string' }]),
      {
        expectedDraftVersion: 2,
      },
    );
    expect(invalid.statusCode).toBe(422);
    expect(
      (
        await admin.put(`/api/admin/change-sets/${set.id}/schema/${article.definition.id}`, {
          category: 'model',
          definition: proposal,
          baseVersion: article.version - 1,
          expectedDraftVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
    const fetched = expectStatus(
      await admin.get(`/api/admin/change-sets/${set.id}/schema/${article.definition.id}`),
      200,
    ).json<Draft & { definition: { fields: Array<{ apiKey: string }> } }>();
    expect(fetched.definition.fields.map((field) => field.apiKey)).toEqual(['title', 'body', 'note']);
    expect((await getSet(set.id)).items).toEqual([
      expect.objectContaining({ kind: 'schema', definitionId: article.definition.id }),
    ]);
    expect(
      expectStatus(
        await admin.delete(`/api/admin/change-sets/${set.id}/schema/${article.definition.id}`),
        200,
      ).json<ChangeSet>().items,
    ).toEqual([]);
    expectStatus(await admin.post(`/api/admin/change-sets/${set.id}/discard`, {}), 200);
  });

  it('ships an additive schema change and entries in one transaction and one snapshot (no prerequisites)', async () => {
    const entry = await createArticle('Inline', 'plain');
    const set = await createSet('Add subtitle');
    expectStatus(
      await putDraft(
        set.id,
        article,
        fieldsWith(article, [{ apiKey: 'subtitle', label: 'Subtitle', type: 'string' }]),
      ),
      200,
    );
    await addItem(set.id, entry.id);

    const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
    expect(shipped.status).toBe('shipped');
    const seq = shipped.shippedSnapshot as number;
    article = await reloadModel(article.definition.id);
    expect(article.definition.fields.map((field) => field.apiKey)).toContain('subtitle');
    const schemaVersion = await database.current.db
      .selectFrom('system_versions')
      .select('schema_version')
      .executeTakeFirstOrThrow();
    expect(shipped.schemaVersionAfter).toBe(schemaVersion.schema_version);
    const ledger = await database.current.db
      .selectFrom('publication_snapshots')
      .selectAll()
      .where('seq', '=', String(seq))
      .executeTakeFirstOrThrow();
    expect(ledger).toMatchObject({
      source: 'change_set',
      change_set_id: set.id,
      schema_version: schemaVersion.schema_version,
    });
    const log = await database.current.db
      .selectFrom('publication_log')
      .selectAll()
      .where('entry_id', '=', entry.id)
      .executeTakeFirstOrThrow();
    expect(Number(log.from_seq)).toBe(seq);
    const delivered = expectStatus(await deliver(entry.id), 200).json<{ data: Record<string, unknown> }>();
    expect(delivered.data).toMatchObject({ title: 'Inline', subtitle: null });
    const activated = await database.current.db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'schema.activate')
      .where('target_id', '=', article.definition.id)
      .orderBy('occurred_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(activated.metadata).toMatchObject({ changeSetId: set.id });
  });

  it('a metadata-only activation outside a change set takes no snapshot number (brief §10)', async () => {
    const before = await database.current.db
      .selectFrom('publication_state')
      .select('last_seq')
      .executeTakeFirstOrThrow();
    expectStatus(
      await admin.put(`/api/admin/models/${article.definition.id}`, {
        definition: { ...article.definition, label: 'Articles' },
        expectedVersion: article.version,
      }),
      200,
    );
    article = await reloadModel(article.definition.id);
    const after = await database.current.db
      .selectFrom('publication_state')
      .select('last_seq')
      .executeTakeFirstOrThrow();
    expect(after.last_seq).toBe(before.last_seq);
  });

  it('reviews and ships a conversion with entry edits as ONE snapshot; converted heads roll to conversion revisions', async () => {
    const entries = [];
    for (const title of ['One', 'Two', 'Three', 'Untouched']) {
      const entry = await createArticle(title, `${title} body`);
      await publish(entry.id);
      entries.push(entry);
    }
    const [one, two, three, untouched] = entries as [EntryBody, EntryBody, EntryBody, EntryBody];
    for (const entry of [one, two, three]) {
      await edit(entry.id, { title: `${String(entry.data.title)} (edited)` });
    }
    const bodyId = fieldIdOf(article, 'body');
    // The site's delivery token read `body` this week (usage counters, feature 2).
    const tokenId = (
      await database.current.db
        .selectFrom('api_tokens')
        .innerJoin('admin_roles', 'admin_roles.id', 'api_tokens.role_id')
        .select('api_tokens.id')
        .where('admin_roles.kind', '=', 'delivery')
        .executeTakeFirstOrThrow()
    ).id;
    await database.current.db
      .insertInto('field_reads')
      .values({
        day: new Date().toISOString().slice(0, 10),
        site_id: PRIMARY_SITE_ID,
        model_id: article.definition.id,
        field_path: bodyId,
        principal_key: `token:${tokenId}`,
        selection: 'explicit',
        reads: '1204',
        last_read_at: new Date(),
      })
      .execute();

    const set = await createSet('Rich bodies');
    const converted = {
      ...article.definition,
      fields: article.definition.fields.map((field) =>
        field.id === bodyId ? { ...field, type: 'richtext', settings: {}, editor: undefined } : field,
      ),
    };
    expectStatus(await putDraft(set.id, article, converted), 200);
    for (const entry of [one, two, three]) {
      await addItem(set.id, entry.id);
    }

    const review = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/review`), 200).json<{
      entries: Array<{
        itemId: string;
        draftVersion: number;
        entryId: string;
        fields: Array<{ apiKey: string; before: unknown; after: unknown }>;
        issues: unknown[];
      }>;
      schema: Array<{
        plan: { summary: { breaking: boolean }; prerequisites: Array<{ kind: string }> };
        impact: { affectedHeads: number };
        stale: boolean;
      }>;
      consumers: Array<{ fieldId: string; consumers: Array<{ principalKey: string; reads: number }> }>;
      checks: { breaking: boolean; blocking: unknown[] };
      notices: string[];
    }>();
    expect(review.checks).toMatchObject({ breaking: true, blocking: [] });
    expect(review.schema[0]?.stale).toBe(false);
    expect(review.schema[0]?.plan.prerequisites.map((step) => step.kind)).toContain('convert');
    expect(review.entries.find((item) => item.entryId === one.id)?.fields).toEqual([
      expect.objectContaining({
        apiKey: 'title',
        before: 'One',
        after: 'One (edited)',
        summary: { before: 'One', after: 'One (edited)' },
      }),
    ]);
    expect(review.consumers).toEqual([
      expect.objectContaining({
        fieldId: bodyId,
        consumers: [expect.objectContaining({ principalKey: `token:${tokenId}`, reads: 1204 })],
      }),
    ]);
    expect(review.notices).toEqual(expect.arrayContaining(['NEW_FIELDS_AFTER_SHIP', 'CONVERTED_ON_SHIP']));
    expect(
      (
        await admin.post(`/api/admin/change-sets/${set.id}/ship`, {
          expectedVersion: (await getSet(set.id)).version,
        })
      ).statusCode,
    ).toBe(409);

    // Strict: a draft that moved since the review refuses the ship before any job starts.
    const reviewed = review.entries[0] as { itemId: string; draftVersion: number };
    const stale = await ship(set.id, {
      itemVersions: [{ itemId: reviewed.itemId, draftVersion: reviewed.draftVersion - 1 }],
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('CHANGE_SET_STALE');
    expect((await getSet(set.id)).status).toBe('open');
    expect(
      await database.current.db
        .selectFrom('schema_change_jobs')
        .select('id')
        .where('change_set_id', '=', set.id)
        .execute(),
    ).toEqual([]);

    const shipping = await ship(set.id, {
      itemVersions: review.entries.map((item) => ({ itemId: item.itemId, draftVersion: item.draftVersion })),
    });
    expect(shipping.statusCode).toBe(202);
    expect(shipping.json<ChangeSet>()).toMatchObject({ status: 'shipping', shipPhase: 'preparing' });
    // While it ships, the definition cannot change elsewhere.
    expect(
      (
        await admin.put(`/api/admin/models/${article.definition.id}`, {
          definition: { ...article.definition, label: 'Busy' },
          expectedVersion: article.version,
        })
      ).statusCode,
    ).toBe(409);
    await drain();
    const shipped = await getSet(set.id);
    expect(shipped).toMatchObject({ status: 'shipped', shipPhase: null });
    const seq = shipped.shippedSnapshot as number;

    for (const entry of [one, two, three, untouched]) {
      const live = expectStatus(await deliver(entry.id), 200).json<{ data: { body: unknown } }>();
      expect(live.data.body).toMatchObject({ format: 'shapio-richtext', doc: { type: 'doc' } });
      // The snapshot reads the revision the log points at: converted too.
      const pinned = expectStatus(await deliver(entry.id, `?snapshot=${seq}`), 200).json<{
        data: { body: unknown };
      }>();
      expect(pinned.data.body).toMatchObject({ format: 'shapio-richtext', doc: { type: 'doc' } });
      const open = await database.current.db
        .selectFrom('publication_log')
        .innerJoin('content_revisions', 'content_revisions.id', 'publication_log.revision_id')
        .select(['publication_log.from_seq', 'content_revisions.reason'])
        .where('publication_log.entry_id', '=', entry.id)
        .where('publication_log.to_seq', 'is', null)
        .executeTakeFirstOrThrow();
      expect(Number(open.from_seq)).toBe(seq);
      // Every converted head has its own revision; the set's entries publish their converted drafts.
      expect(open.reason).toBe('conversion');
    }
    expect(expectStatus(await deliver(one.id), 200).json<{ data: { title: string } }>().data.title).toBe(
      'One (edited)',
    );
    // An entry the set did not touch stays "published": its draft and live heads share the conversion revision.
    expect(
      expectStatus(await admin.get(`/api/admin/content/article/${untouched.id}`), 200).json<EntryBody>()
        .status,
    ).toBe('published');
    const changes = await database.current.db
      .selectFrom('schema_change_jobs')
      .select(['status', 'change_set_id'])
      .where('change_set_id', '=', set.id)
      .execute();
    expect(changes).toEqual([{ status: 'activated', change_set_id: set.id }]);
    article = await reloadModel(article.definition.id);
  });

  it('a prerequisite failure fails the set and leaves schema and content as they were', async () => {
    const entry = await createArticle('No summary');
    await publish(entry.id);
    const versionBefore = article.version;
    const set = await createSet('Require summary');
    expectStatus(
      await putDraft(
        set.id,
        article,
        fieldsWith(article, [{ apiKey: 'summary', label: 'Summary', type: 'string', required: true }]),
      ),
      200,
    );
    const other = await createArticle('Waiting');
    await addItem(set.id, other.id);
    expect((await ship(set.id)).statusCode).toBe(202);
    await drain();
    const failed = await getSet(set.id);
    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('SCHEMA_PREREQUISITE_FAILED');
    expect((await reloadModel(article.definition.id)).version).toBe(versionBefore);
    expect((await deliver(other.id)).statusCode).toBe(404);
    const change = await database.current.db
      .selectFrom('schema_change_jobs')
      .select('status')
      .where('change_set_id', '=', set.id)
      .executeTakeFirstOrThrow();
    expect(change.status).toBe('failed');
    // Nothing is left in flight: the model can change again.
    expectStatus(
      await admin.put(`/api/admin/models/${article.definition.id}`, {
        definition: { ...article.definition, label: 'Articles again' },
        expectedVersion: versionBefore,
      }),
      200,
    );
    article = await reloadModel(article.definition.id);
  });

  it('creates a model from a one-item set ("Review & ship now")', async () => {
    const set = expectStatus(
      await admin.post('/api/admin/change-sets', { title: 'New model', source: 'builder' }),
      201,
    ).json<ChangeSet & { source: string }>();
    expect(set.source).toBe('builder');
    const definition = {
      id: '4a0e7a5c-3b7b-4f1e-9c55-1d3b1d6c0a11',
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
    };
    expectStatus(
      await admin.put(`/api/admin/change-sets/${set.id}/schema/${definition.id}`, {
        category: 'model',
        definition,
        baseVersion: null,
      }),
      200,
    );
    expect(expectStatus(await ship(set.id), 200).json<ChangeSet>().status).toBe('shipped');
    expectStatus(await admin.get(`/api/admin/models/${definition.id}`), 200);
  });

  it('ships with deploy: the connection runs after the set is live, linked to it', async () => {
    const site = await startReceiver();
    try {
      const connection = expectStatus(
        await admin.post('/api/admin/deployments/connections', {
          name: 'Site',
          provider: 'generic_webhook',
          settings: { url: `${site.url}/build` },
          secrets: {},
          triggerPolicy: [],
          debounceSeconds: 0,
          allowPrivateNetwork: true,
        }),
        201,
      ).json<{ connection: { id: string } }>().connection;
      const entry = await createArticle('Deployed');
      const set = await createSet('With deploy');
      const withItem = await addItem(set.id, entry.id);
      expectStatus(
        await admin.request({
          method: 'PATCH',
          url: `/api/admin/change-sets/${set.id}`,
          payload: { deploymentConnectionId: connection.id, expectedVersion: withItem.version },
        }),
        200,
      );
      const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
      expect(shipped.deploymentRunId).toEqual(expect.any(String));
      const run = await database.current.db
        .selectFrom('deployment_runs')
        .selectAll()
        .where('id', '=', shipped.deploymentRunId ?? '')
        .executeTakeFirstOrThrow();
      expect(run).toMatchObject({
        trigger: 'change_set',
        change_set_id: set.id,
        connection_id: connection.id,
      });
      await drainJobs(worker, database.current.db, { types: [PUBLISHING_JOBS.deploymentTrigger] });
      const triggered = await database.current.db
        .selectFrom('deployment_runs')
        .select('snapshot_seq')
        .where('id', '=', run.id)
        .executeTakeFirstOrThrow();
      expect(Number(triggered.snapshot_seq)).toBeGreaterThanOrEqual(shipped.shippedSnapshot as number);
      const timeline = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/timeline`), 200).json<{
        items: Array<{ kind: string }>;
      }>();
      expect(timeline.items.map((event) => event.kind)).toEqual(
        expect.arrayContaining(['shipped', 'deploy_queued']),
      );
    } finally {
      await site.close();
    }
  });

  it('restores an earlier snapshot as a reviewable set that ships as a new snapshot', async () => {
    const kept = await createArticle('Kept v1');
    await publish(kept.id);
    const doomed = await createArticle('Doomed');
    await publish(doomed.id);
    const at = Number(
      (await database.current.db.selectFrom('publication_state').select('last_seq').executeTakeFirstOrThrow())
        .last_seq,
    );
    await edit(kept.id, { title: 'Kept v2' });
    await publish(kept.id);
    const added = await createArticle('Added later');
    await publish(added.id);
    expectStatus(await admin.delete(`/api/admin/content/article/${doomed.id}`), 204);

    const set = expectStatus(await admin.post(`/api/admin/snapshots/${at}/restore`, {}), 201).json<
      ChangeSet & {
        source: string;
        restoreOfSnapshot: number;
      }
    >();
    expect(set).toMatchObject({ status: 'open', source: 'restore', restoreOfSnapshot: at });
    expect(set.items.map((item) => [item.entryId, item.action]).sort()).toEqual(
      [
        [kept.id, 'publish'],
        [added.id, 'unpublish'],
      ].sort(),
    );
    const review = expectStatus(await admin.get(`/api/admin/change-sets/${set.id}/review`), 200).json<{
      notRestorable: Array<{ entryId: string; reason: string }>;
      entries: Array<{ entryId: string; fields: Array<{ apiKey: string; before: unknown; after: unknown }> }>;
    }>();
    expect(review.notRestorable).toEqual([
      expect.objectContaining({ entryId: doomed.id, reason: 'entry_deleted' }),
    ]);
    expect(review.entries.find((item) => item.entryId === kept.id)?.fields).toEqual([
      expect.objectContaining({
        apiKey: 'title',
        before: 'Kept v2',
        after: 'Kept v1',
        summary: { before: 'Kept v2', after: 'Kept v1' },
      }),
    ]);

    const shipped = expectStatus(await ship(set.id), 200).json<ChangeSet>();
    expect(shipped.status).toBe('shipped');
    expect((shipped.shippedSnapshot as number) > at).toBe(true);
    expect(expectStatus(await deliver(kept.id), 200).json<{ data: { title: string } }>().data.title).toBe(
      'Kept v1',
    );
    expect((await deliver(added.id)).statusCode).toBe(404);
    // The draft was left alone; the old snapshot still serves.
    expect(
      expectStatus(await admin.get(`/api/admin/content/article/${kept.id}`), 200).json<EntryBody>().data
        .title,
    ).toBe('Kept v2');
    expect((await deliver(kept.id, `?snapshot=${at}`)).statusCode).toBe(200);
    expect((await admin.post(`/api/admin/snapshots/${shipped.shippedSnapshot}/restore`, {})).statusCode).toBe(
      409,
    );
    expect((await admin.post(`/api/admin/snapshots/999999/restore`, {})).statusCode).toBe(404);
  });
});
