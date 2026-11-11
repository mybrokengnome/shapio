import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { AppError } from '../src/helpers/appError.js';
import type { UrlBuilder } from '../src/helpers/publicUrl.js';
import {
  LENS_HISTORY_REQUEUE_AFTER_MS,
  requeueDeadLensHistoryBackfill,
} from '../src/jobs/handlers/lensHistoryBackfill.js';
import { enqueueJob } from '../src/jobs/queue.js';
import * as schemaActivationsRepository from '../src/repositories/schemaActivations.js';
import { getSchemaVersion } from '../src/repositories/schemaVersions.js';
import {
  LENS_BUILDS_PER_MINUTE,
  resetLensBuildBudgets,
  takeLensBuildBudget,
} from '../src/schema/lens/budget.js';
import {
  backfillActivationHistory,
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
} from '../src/schema/lens/history.js';
import { clearLensCaches, loadRequestLens, SETTLE_CHECK_TTL_MS } from '../src/schema/lens/views.js';
import { loadSnapshot } from '../src/schema/loadSnapshot.js';
import { API_DOCS_CACHE_SIZE, getOpenApiDocument } from '../src/services/apiDocs.js';
import { expectStatus, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, runSchemaJobs, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const collection = (apiKey: string, fields: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: 'collection',
  apiKey,
  label: apiKey,
  fields,
  ...extra,
});

const appErrorOf = async (work: () => unknown): Promise<AppError> => {
  try {
    await work();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an AppError');
};

const URLS = { absoluteUrl: (path: string) => `http://localhost${path}` } as unknown as UrlBuilder;

/**
 * Review findings on activation history and lens views (plan schema-lenses, WP2 hardening): a view stays
 * consistent when history is not, compiled lenses see every revision they read, an impossible history
 * conflict is not reported as a taken API ID, views are cached while the backfill runs and dropped when it
 * finishes (generated contracts included), and the backfill repairs the rows an earlier run wrote.
 */

/** A lens load that no budget limits (these tests are about history and caching, not the limiter). */
const lensAt = (
  ...args: Parameters<typeof loadRequestLens> extends [...infer Head, unknown] ? Head : never
) => loadRequestLens(...args, null);

describe('schema lens hardening', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  const headers = { [SITE_HEADER]: 'default' };
  const getModel = async (kind: 'models' | 'components', id: string) =>
    expectStatus(
      await admin.request({ method: 'GET', url: `/api/admin/${kind}/${id}`, headers }),
      200,
    ).json<ModelBody>();
  const create = async (definition: Record<string, unknown>, kind: 'models' | 'components' = 'models') => {
    const created = expectStatus(
      await admin.request({ method: 'POST', url: `/api/admin/${kind}`, payload: { definition }, headers }),
      201,
    ).json<{ definitionId: string }>();
    return getModel(kind, created.definitionId);
  };
  const update = (
    model: ModelBody,
    definition: Record<string, unknown>,
    kind: 'models' | 'components' = 'models',
  ) =>
    admin.request({
      method: 'PUT',
      url: `/api/admin/${kind}/${model.definition.id}`,
      payload: {
        definition,
        expectedVersion: model.version,
        acknowledgeBreaking: true,
        acknowledgeDestructive: true,
      },
      headers,
    });
  const updateOk = async (
    model: ModelBody,
    definition: Record<string, unknown>,
    kind: 'models' | 'components' = 'models',
  ) => {
    const response = await update(model, definition, kind);
    if (response.statusCode === 202) {
      await runSchemaJobs(database.current.db);
    } else {
      expectStatus(response, 200);
    }
    return getModel(kind, model.definition.id);
  };
  const currentView = async () => (await loadSnapshot(database.current.db)).forSite(PRIMARY_SITE_ID);
  const version = () => getSchemaVersion(database.current.db);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('reports a history row conflict as an internal error, not as a taken API ID', async () => {
    const model = await create(collection('conflicted', [{ apiKey: 'name', label: 'Name', type: 'string' }]));
    await database.current.db
      .insertInto('schema_activations')
      .values({
        model_id: model.definition.id,
        schema_version: (await version()) + 1,
        site_id: PRIMARY_SITE_ID,
        revision_id: null,
      })
      .execute();
    const response = await update(model, { ...model.definition, label: 'Conflicted' });
    expect(response.statusCode, response.body).toBe(500);
    expect(response.body).not.toContain('API_KEY_TAKEN');
    await database.current.db
      .deleteFrom('schema_activations')
      .where('model_id', '=', model.definition.id)
      .where('revision_id', 'is', null)
      .execute();
  });

  it("recompiles a lens when a component only the client's version embeds changes today", async () => {
    const hero = await create(
      {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      'components',
    );
    const quote = await create(
      {
        kind: 'component',
        apiKey: 'quote',
        label: 'Quote',
        fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
      },
      'components',
    );
    let page = await create(
      collection('page', [
        {
          apiKey: 'sections',
          label: 'Sections',
          type: 'dynamiczone',
          settings: { components: [hero.definition.id, quote.definition.id] },
        },
      ]),
    );
    const atV = await version();
    page = await updateOk(page, {
      ...page.definition,
      fields: page.definition.fields.map((field) => ({
        ...field,
        settings: { components: [quote.definition.id] },
      })),
    });
    const before = (await lensAt(database.current.db, await currentView(), atV))?.lensFor(page.definition.id);
    const heroBefore =
      before?.fields[0]?.kind === 'null'
        ? undefined
        : before?.fields[0]?.nested?.components.get(hero.definition.id);
    expect(heroBefore?.status).toBe('identity');

    await updateOk(
      hero,
      {
        ...hero.definition,
        fields: hero.definition.fields.map((field) => ({ ...field, apiKey: 'headline' })),
      },
      'components',
    );
    const after = (await lensAt(database.current.db, await currentView(), atV))?.lensFor(page.definition.id);
    const heroAfter =
      after?.fields[0]?.kind === 'null'
        ? undefined
        : after?.fields[0]?.nested?.components.get(hero.definition.id);
    expect(heroAfter?.status).toBe('lensed');
  });

  it('keeps a view consistent: a kind whose parent is missing at the version is unavailable, not served', async () => {
    const product = await create(
      collection('product', [{ apiKey: 'name', label: 'Name', type: 'string' }], {
        pluralApiKey: 'products',
      }),
    );
    const digital = await create(
      collection('digitalProduct', [{ apiKey: 'url', label: 'URL', type: 'string' }], {
        pluralApiKey: 'digital',
        extends: product.definition.id,
      }),
    );
    const atV = await version();
    await create(collection('later', [{ apiKey: 'name', label: 'Name', type: 'string' }]));
    // What a wrong backfill wrote: the parent placed in another scope at the version.
    const otherSite = expectStatus(
      await admin.request({
        method: 'POST',
        url: '/api/admin/sites',
        payload: { key: 'other', name: 'Other' },
        headers,
      }),
      201,
    ).json<{ id: string }>();
    await database.current.db
      .updateTable('schema_activations')
      .set({ site_id: otherSite.id, backfilled: true })
      .where('model_id', '=', product.definition.id)
      .execute();
    clearLensCaches();

    const lens = await lensAt(database.current.db, await currentView(), atV);
    expect(lens?.view.modelsByApiKey.has('digitalProduct')).toBe(false);
    expect([...(lens?.view.modelsByRouteKey.keys() ?? [])]).not.toContain('digital');
    expect(await appErrorOf(() => lens?.lensFor(digital.definition.id))).toMatchObject({
      statusCode: 409,
      code: 'SCHEMA_VERSION_UNAVAILABLE',
    });
    // Left out of the view, but named: by ID and by the route it had, so it answers 409 rather than 404.
    const expected = {
      definitionId: digital.definition.id,
      apiKey: 'digitalProduct',
      oldestVersion: lens?.current,
    };
    expect(lens?.unavailable?.get('products/digital')).toEqual(expected);
    expect(lens?.unavailable?.get(digital.definition.id)).toEqual(expected);

    // The backfill repairs what it wrote (backfilled rows), from the audit log.
    await backfillActivationHistory(database.current.db);
    const rows = await database.current.db
      .selectFrom('schema_activations')
      .select('site_id')
      .where('model_id', '=', product.definition.id)
      .execute();
    expect(rows.map((row) => row.site_id)).toEqual([PRIMARY_SITE_ID]);
    clearLensCaches();
    const repaired = await lensAt(database.current.db, await currentView(), atV);
    expect(repaired?.view.modelsByRouteKey.has('products/digital')).toBe(true);
  });

  it('never replaces rows activation wrote', async () => {
    const model = await create(collection('kept', [{ apiKey: 'name', label: 'Name', type: 'string' }]));
    const otherSite = await database.current.db
      .selectFrom('sites')
      .select('id')
      .where('key', '=', 'other')
      .executeTakeFirstOrThrow();
    // A live row that disagrees with the audit log stays as activation wrote it.
    await database.current.db
      .updateTable('schema_activations')
      .set({ site_id: otherSite.id })
      .where('model_id', '=', model.definition.id)
      .execute();
    await backfillActivationHistory(database.current.db);
    const rows = await database.current.db
      .selectFrom('schema_activations')
      .select(['site_id', 'backfilled'])
      .where('model_id', '=', model.definition.id)
      .execute();
    expect(rows).toEqual([{ site_id: otherSite.id, backfilled: false }]);
    await database.current.db
      .updateTable('schema_activations')
      .set({ site_id: PRIMARY_SITE_ID })
      .where('model_id', '=', model.definition.id)
      .execute();
  });

  it('caches views while the backfill runs and drops them, generated contracts included, when it settles', async () => {
    const { db } = database.current;
    clearLensCaches();
    const atV = (await version()) - 1;
    const { job } = await enqueueJob(
      { type: LENS_HISTORY_BACKFILL_JOB, idempotencyKey: LENS_HISTORY_BACKFILL_KEY, maxAttempts: 5 },
      db,
    );
    const first = await lensAt(db, await currentView(), atV);
    const second = await lensAt(db, await currentView(), atV);
    expect(second?.view).toBe(first?.view);
    const documentBefore = getOpenApiDocument(first?.view as NonNullable<typeof first>['view'], URLS);

    // A job that failed for good has not rebuilt anything: nothing counts as final yet.
    await db.updateTable('jobs').set({ status: 'dead' }).where('id', '=', job.id).execute();
    expect((await lensAt(db, await currentView(), atV))?.view).toBe(first?.view);

    await db.updateTable('jobs').set({ status: 'succeeded' }).where('id', '=', job.id).execute();
    // The job is read at most once per SETTLE_CHECK_TTL_MS, not on every lensed request.
    expect((await lensAt(db, await currentView(), atV))?.view).toBe(first?.view);
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + SETTLE_CHECK_TTL_MS + 1);
    const settled = await lensAt(db, await currentView(), atV);
    clock.mockRestore();
    expect(settled?.view).not.toBe(first?.view);
    expect(getOpenApiDocument(settled?.view as NonNullable<typeof settled>['view'], URLS)).not.toBe(
      documentBefore,
    );
    await db.deleteFrom('jobs').where('id', '=', job.id).execute();
  });

  it("reads only the request's workspace and the shared definitions at a version", async () => {
    const { db } = database.current;
    const other = await db
      .selectFrom('sites')
      .select('id')
      .where('key', '=', 'other')
      .executeTakeFirstOrThrow();
    await admin.request({
      method: 'POST',
      url: '/api/admin/models',
      payload: { definition: collection('elsewhere', [{ apiKey: 'name', label: 'Name', type: 'string' }]) },
      headers: { [SITE_HEADER]: 'other' },
    });
    const now = await version();
    const scoped = await schemaActivationsRepository.findAt(now, db, { siteId: PRIMARY_SITE_ID });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((row) => row.siteId === null || row.siteId === PRIMARY_SITE_ID)).toBe(true);
    const all = await schemaActivationsRepository.findAt(now, db);
    expect(all.some((row) => row.siteId === other.id)).toBe(true);
    expect(
      (await schemaActivationsRepository.findAt(now, db, { siteId: null })).every(
        (row) => row.siteId === null,
      ),
    ).toBe(true);
  });

  it('charges cache-miss builds to the caller and answers 429 when its bucket is empty', async () => {
    const { db } = database.current;
    clearLensCaches();
    resetLensBuildBudgets();
    // Enough older versions for one more miss than a minute's budget.
    let model = await create(collection('churn', [{ apiKey: 'name', label: 'Name', type: 'string' }]));
    while ((await version()) <= LENS_BUILDS_PER_MINUTE + 2) {
      model = await updateOk(model, { ...model.definition, label: `Churn ${model.version}` });
    }
    const current = await currentView();
    const key = 'token:budget-test';
    for (let miss = 1; miss <= LENS_BUILDS_PER_MINUTE; miss += 1) {
      await loadRequestLens(db, current, miss, key);
    }
    expect(
      await appErrorOf(() => loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE + 1, key)),
    ).toMatchObject({
      statusCode: 429,
      code: 'LENS_BUDGET_EXCEEDED',
    });
    // Hits are free (the last version read is still cached; one-off versions churn among themselves),
    // other callers have their own bucket, and admin work is never limited.
    expect(await loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE, key)).not.toBeNull();
    expect(await loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE + 1, 'token:other')).not.toBeNull();
    expect(await loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE + 2, null)).not.toBeNull();
    resetLensBuildBudgets();
  });

  it("keeps each workspace's cached history apart, and a refused miss evicts nothing", async () => {
    const { db } = database.current;
    clearLensCaches();
    resetLensBuildBudgets();
    const now = await version();
    const atV = now - 1;
    const first = await loadRequestLens(db, await currentView(), atV, null);
    // A caller with no budget left can only be served from caches.
    const key = 'token:exhausted';
    while (takeLensBuildBudget(key)) {
      // drain
    }
    // Another workspace walks more versions than a workspace's caches hold.
    const otherId = (
      await db.selectFrom('sites').select('id').where('key', '=', 'other').executeTakeFirstOrThrow()
    ).id;
    const other = (await loadSnapshot(db)).forSite(otherId);
    for (let older = 1; older < now; older += 1) {
      await loadRequestLens(db, other, older, null);
    }
    const today = await currentView();
    expect((await loadRequestLens(db, today, atV, key))?.view).toBe(first?.view);
    expect(await appErrorOf(() => loadRequestLens(db, today, 1, key))).toMatchObject({
      code: 'LENS_BUDGET_EXCEEDED',
    });
    expect((await loadRequestLens(db, today, atV, key))?.view).toBe(first?.view);
    resetLensBuildBudgets();
  });

  it('keeps versions real clients read again cached while a caller walks one-off versions', async () => {
    const { db } = database.current;
    clearLensCaches();
    resetLensBuildBudgets();
    const now = await version();
    const atV = now - 1;
    const today = await currentView();
    // A real client reads its version twice: it is promoted.
    const first = await loadRequestLens(db, today, atV, null);
    await loadRequestLens(db, today, atV, null);
    // Another caller in the same workspace walks every other version, more than the caches hold.
    for (let older = 1; older < atV; older += 1) {
      await loadRequestLens(db, today, older, null);
    }
    // The real client, with no budget left, is still served from cache.
    const key = 'token:real-client';
    while (takeLensBuildBudget(key)) {
      // drain
    }
    expect((await loadRequestLens(db, today, atV, key))?.view).toBe(first?.view);
    resetLensBuildBudgets();
  });

  it('queues a dead history rebuild again once a day, never sooner', async () => {
    const { db } = database.current;
    const { job } = await enqueueJob(
      { type: LENS_HISTORY_BACKFILL_JOB, idempotencyKey: LENS_HISTORY_BACKFILL_KEY, maxAttempts: 5 },
      db,
    );
    const diedAt = new Date('2026-11-01T00:00:00Z');
    await db
      .updateTable('jobs')
      .set({ status: 'dead', attempts: 5, finished_at: diedAt, last_error: 'boom' })
      .where('id', '=', job.id)
      .execute();
    expect(await requeueDeadLensHistoryBackfill(db, new Date(diedAt.getTime() + 60_000))).toBe(false);
    expect(
      await requeueDeadLensHistoryBackfill(db, new Date(diedAt.getTime() + LENS_HISTORY_REQUEUE_AFTER_MS)),
    ).toBe(true);
    expect(await db.selectFrom('jobs').selectAll().where('id', '=', job.id).executeTakeFirst()).toMatchObject(
      {
        status: 'pending',
        attempts: 0,
        last_error: 'Queued again a day after: boom',
      },
    );
    // Not dead: nothing to do.
    expect(
      await requeueDeadLensHistoryBackfill(
        db,
        new Date(diedAt.getTime() + 2 * LENS_HISTORY_REQUEUE_AFTER_MS),
      ),
    ).toBe(false);
    await db.deleteFrom('jobs').where('id', '=', job.id).execute();
  });

  it("keeps every workspace's current contract however many workspaces read older versions", async () => {
    const network = await loadSnapshot(database.current.db);
    const views = Array.from({ length: API_DOCS_CACHE_SIZE + 4 }, () => network.forSite(randomUUID()));
    const first = getOpenApiDocument(views[0] as (typeof views)[number], URLS);
    for (const view of views.slice(1)) {
      getOpenApiDocument(view, URLS);
    }
    expect(getOpenApiDocument(views[0] as (typeof views)[number], URLS)).toBe(first);
  });
});
