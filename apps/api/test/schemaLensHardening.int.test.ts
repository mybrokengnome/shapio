import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { AppError } from '../src/helpers/appError.js';
import type { UrlBuilder } from '../src/helpers/publicUrl.js';
import { enqueueJob } from '../src/jobs/queue.js';
import * as schemaActivationsRepository from '../src/repositories/schemaActivations.js';
import { getSchemaVersion } from '../src/repositories/schemaVersions.js';
import { LENS_BUILDS_PER_MINUTE, resetLensBuildBudgets } from '../src/schema/lens/budget.js';
import {
  backfillActivationHistory,
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
} from '../src/schema/lens/history.js';
import { clearLensCaches, loadRequestLens } from '../src/schema/lens/views.js';
import { loadSnapshot } from '../src/schema/loadSnapshot.js';
import { getOpenApiDocument } from '../src/services/apiDocs.js';
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

    await db.updateTable('jobs').set({ status: 'succeeded' }).where('id', '=', job.id).execute();
    const settled = await lensAt(db, await currentView(), atV);
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
    // Hits are free, other callers have their own bucket, and admin work is never limited.
    expect(await loadRequestLens(db, current, 1, key)).not.toBeNull();
    expect(await loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE + 1, 'token:other')).not.toBeNull();
    expect(await loadRequestLens(db, current, LENS_BUILDS_PER_MINUTE + 2, null)).not.toBeNull();
    resetLensBuildBudgets();
  });
});
