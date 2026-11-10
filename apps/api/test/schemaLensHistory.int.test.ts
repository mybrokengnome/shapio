import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { AppError } from '../src/helpers/appError.js';
import { enqueueJob } from '../src/jobs/queue.js';
import * as jobsRepository from '../src/repositories/jobs.js';
import * as schemaActivationsRepository from '../src/repositories/schemaActivations.js';
import { getSchemaId, getSchemaVersion } from '../src/repositories/schemaVersions.js';
import {
  backfillActivationHistory,
  LENS_HISTORY_BACKFILL_JOB,
  LENS_HISTORY_BACKFILL_KEY,
} from '../src/schema/lens/history.js';
import { clearLensCaches, loadRequestLens, parseSchemaVersionToken } from '../src/schema/lens/views.js';
import { loadSnapshot } from '../src/schema/loadSnapshot.js';
import { expectStatus, fieldIdOf, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, runSchemaJobs, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type HistoryRow = {
  model_id: string;
  schema_version: number;
  site_id: string | null;
  revision_id: string | null;
};

const collection = (apiKey: string, fields: unknown[]) => ({
  kind: 'collection',
  apiKey,
  label: apiKey,
  fields,
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

/**
 * Activation history and lens views (plan schema-lenses, WP2): every activation writes a history row in its
 * transaction (create, change, scope change, delete); `findAt` answers per version; the backfill rebuilds
 * the history from the audit log; `loadRequestLens` builds a workspace's view at an older version.
 */

/** A lens load that no budget limits (these tests are about history and caching, not the limiter). */
const lensAt = (
  ...args: Parameters<typeof loadRequestLens> extends [...infer Head, unknown] ? Head : never
) => loadRequestLens(...args, null);

describe('schema lens history', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let siteB: { id: string; key: string };

  const on = (siteKey: string) => {
    const headers = { [SITE_HEADER]: siteKey };
    return {
      get: (url: string) => network.request({ method: 'GET', url, headers }),
      post: (url: string, payload: unknown) =>
        network.request({ method: 'POST', url, payload: payload as object, headers }),
      put: (url: string, payload: unknown) =>
        network.request({ method: 'PUT', url, payload: payload as object, headers }),
      delete: (url: string) => network.request({ method: 'DELETE', url, headers }),
    };
  };
  const onA = on('default');
  const onB = on('b');
  type Site = typeof onA;

  const getModel = async (site: Site, id: string) =>
    expectStatus(await site.get(`/api/admin/models/${id}`), 200).json<ModelBody>();
  const create = async (site: Site, definition: Record<string, unknown>, scope?: 'network' | 'site') => {
    const created = expectStatus(
      await site.post('/api/admin/models', { definition, ...(scope ? { scope } : {}) }),
      201,
    ).json<{ definitionId: string }>();
    return getModel(site, created.definitionId);
  };
  const update = async (site: Site, model: ModelBody, definition: Record<string, unknown>) => {
    const response = await site.put(`/api/admin/models/${model.definition.id}`, {
      definition,
      expectedVersion: model.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    if (response.statusCode === 202) {
      await runSchemaJobs(database.current.db);
    } else {
      expectStatus(response, 200);
    }
    return getModel(site, model.definition.id);
  };
  const remove = async (site: Site, model: ModelBody) =>
    expectStatus(
      await site.delete(
        `/api/admin/models/${model.definition.id}?expectedVersion=${model.version}&acknowledgeBreaking=true`,
      ),
      200,
    );
  const historyOf = (modelId: string) =>
    database.current.db
      .selectFrom('schema_activations')
      .select(['model_id', 'schema_version', 'site_id', 'revision_id', 'backfilled'])
      .where('model_id', '=', modelId)
      .orderBy('schema_version')
      .execute();
  const revisionIdOf = async (modelId: string, version: number) =>
    (
      await database.current.db
        .selectFrom('schema_revisions')
        .select('id')
        .where('model_id', '=', modelId)
        .where('version', '=', version)
        .executeTakeFirstOrThrow()
    ).id;
  const currentView = async (siteId: string = PRIMARY_SITE_ID) =>
    (await loadSnapshot(database.current.db)).forSite(siteId);

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    siteB = expectStatus(await onA.post('/api/admin/sites', { key: 'b', name: 'Workspace B' }), 201).json<{
      id: string;
      key: string;
    }>();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('activation', () => {
    let model: ModelBody;
    const versions: number[] = [];

    it('writes a row for a create, a change, a scope change and a delete', async () => {
      model = await create(onA, collection('note', [{ apiKey: 'title', label: 'Title', type: 'string' }]));
      versions.push(await getSchemaVersion(database.current.db));
      model = await update(onA, model, {
        ...model.definition,
        fields: [...model.definition.fields, { apiKey: 'body', label: 'Body', type: 'text' }],
      });
      versions.push(await getSchemaVersion(database.current.db));
      const moved = expectStatus(
        await onA.put(`/api/admin/models/${model.definition.id}/scope`, {
          version: model.version,
          scope: 'network',
        }),
        200,
      );
      expect(moved.statusCode).toBe(200);
      model = await getModel(onA, model.definition.id);
      versions.push(await getSchemaVersion(database.current.db));
      await remove(onA, model);
      versions.push(await getSchemaVersion(database.current.db));

      const id = model.definition.id;
      expect(await historyOf(id)).toEqual([
        {
          model_id: id,
          schema_version: versions[0],
          site_id: PRIMARY_SITE_ID,
          revision_id: await revisionIdOf(id, 1),
          backfilled: false,
        },
        {
          model_id: id,
          schema_version: versions[1],
          site_id: PRIMARY_SITE_ID,
          revision_id: await revisionIdOf(id, 2),
          backfilled: false,
        },
        {
          model_id: id,
          schema_version: versions[2],
          site_id: null,
          revision_id: await revisionIdOf(id, 3),
          backfilled: false,
        },
        { model_id: id, schema_version: versions[3], site_id: null, revision_id: null, backfilled: false },
      ]);
    });

    it('findAt answers the revision active at each version', async () => {
      const id = model.definition.id;
      const at = async (version: number) =>
        (await schemaActivationsRepository.findAt(version, database.current.db)).find(
          (row) => row.modelId === id,
        );
      expect(await at((versions[0] as number) - 1)).toBeUndefined();
      expect(await at(versions[0] as number)).toMatchObject({
        revisionId: await revisionIdOf(id, 1),
        version: 1,
      });
      expect(await at(versions[1] as number)).toMatchObject({
        revisionId: await revisionIdOf(id, 2),
        version: 2,
        siteId: PRIMARY_SITE_ID,
      });
      expect(await at(versions[2] as number)).toMatchObject({
        revisionId: await revisionIdOf(id, 3),
        siteId: null,
      });
      expect((await at(versions[2] as number))?.definition).toMatchObject({ apiKey: 'note' });
      expect(await at(versions[3] as number)).toMatchObject({ revisionId: null, definition: null });
      expect(await at((versions[3] as number) + 100)).toMatchObject({ revisionId: null });
    });
  });

  describe('lens views', () => {
    let article: ModelBody;
    let atCreate: number;

    beforeAll(async () => {
      article = await create(
        onA,
        collection('article', [
          { apiKey: 'title', label: 'Title', type: 'string' },
          { apiKey: 'body', label: 'Body', type: 'text' },
        ]),
      );
      atCreate = await getSchemaVersion(database.current.db);
    });

    it('is null at the current version and refuses a version ahead of it', async () => {
      const current = await currentView();
      expect(await lensAt(database.current.db, current, current.version)).toBeNull();
      const ahead = await appErrorOf(() => lensAt(database.current.db, current, current.version + 1));
      expect(ahead).toMatchObject({ statusCode: 400, code: 'SCHEMA_VERSION_AHEAD' });
    });

    it('is an identity when only another workspace changed since the version', async () => {
      const other = await create(
        onB,
        collection('gadget', [{ apiKey: 'name', label: 'Name', type: 'string' }]),
      );
      const before = await getSchemaVersion(database.current.db);
      await update(onB, other, {
        ...other.definition,
        fields: other.definition.fields.map((field) => ({ ...field, apiKey: 'label' })),
      });
      const lensA = await lensAt(database.current.db, await currentView(), before);
      expect(lensA).toMatchObject({ identity: true, requested: before });
      expect(lensA?.view.version).toBe(before);
      const lensB = await lensAt(database.current.db, await currentView(siteB.id), before);
      expect(lensB?.identity).toBe(false);
      expect(
        lensB?.view.modelsByApiKey.get('gadget')?.definition.fields.map((field) => field.apiKey),
      ).toEqual(['name']);
    });

    it("returns the version's view: a renamed route and field are visible under their old names", async () => {
      const titleId = fieldIdOf(article, 'title');
      article = await update(onA, article, {
        ...article.definition,
        apiKey: 'story',
        pluralApiKey: 'stories',
        label: 'Story',
        fields: article.definition.fields.map((field) =>
          field.apiKey === 'title' ? { ...field, apiKey: 'headline' } : field,
        ),
      });
      const current = await currentView();
      expect(current.modelsByRouteKey.has('stories')).toBe(true);
      const lens = await lensAt(database.current.db, current, atCreate);
      expect(lens).not.toBeNull();
      expect(lens?.identity).toBe(false);
      expect(lens?.view.version).toBe(atCreate);
      expect(lens?.view.modelsByRouteKey.get('articles')?.definition.id).toBe(article.definition.id);
      expect(lens?.view.modelsByRouteKey.has('stories')).toBe(false);
      expect(
        lens?.view.modelsByApiKey.get('article')?.definition.fields.map((field) => field.apiKey),
      ).toEqual(['title', 'body']);
      // Models created since the version are not in its view.
      expect(lens?.view.modelsByApiKey.has('gadget')).toBe(false);
      const definitionLens = lens?.lensFor(article.definition.id);
      expect(definitionLens).toMatchObject({ status: 'lensed', apiKey: 'article', storedApiKey: 'story' });
      expect(definitionLens?.apiKeyToFieldId.get('title')).toBe(titleId);
    });
  });

  describe('schema version tokens', () => {
    it('reads <schemaId>:<version> and refuses another instance or a malformed value', async () => {
      const schemaId = await getSchemaId(database.current.db);
      expect(schemaId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(parseSchemaVersionToken(`${schemaId}:12`, schemaId)).toBe(12);
      expect(parseSchemaVersionToken(`${schemaId.toUpperCase()}:0`, schemaId)).toBe(0);
      expect(await appErrorOf(() => parseSchemaVersionToken(`${randomUUID()}:12`, schemaId))).toMatchObject({
        statusCode: 400,
        code: 'SCHEMA_VERSION_FOREIGN',
      });
      for (const malformed of [
        '12',
        `${schemaId}:`,
        `${schemaId}:-1`,
        `${schemaId}:1.5`,
        `${schemaId}:99999999999`,
      ]) {
        expect(await appErrorOf(() => parseSchemaVersionToken(malformed, schemaId)), malformed).toMatchObject(
          {
            statusCode: 400,
            code: 'SCHEMA_VERSION_INVALID',
          },
        );
      }
    });
  });

  describe('backfill', () => {
    const allRows = () =>
      database.current.db
        .selectFrom('schema_activations')
        .select(['model_id', 'schema_version', 'site_id', 'revision_id'])
        .orderBy('model_id')
        .orderBy('schema_version')
        .execute() as Promise<HistoryRow[]>;

    /** What the migration leaves: one backfilled row per live definition. */
    const truncateToBaseline = async () => {
      const { db } = database.current;
      await db.deleteFrom('schema_activations').execute();
      const pointers = await db
        .selectFrom('model_active_versions as active')
        .innerJoin('models', 'models.id', 'active.model_id')
        .select(['active.model_id', 'active.schema_version', 'active.revision_id', 'models.site_id'])
        .execute();
      await schemaActivationsRepository.insertMissing(
        pointers.map((row) => ({
          modelId: row.model_id,
          schemaVersion: row.schema_version,
          siteId: row.site_id,
          revisionId: row.revision_id,
          backfilled: true,
        })),
        db,
      );
    };

    it('rebuilds the history from the audit log and is idempotent', async () => {
      const before = await allRows();
      expect(before.length).toBeGreaterThan(5);
      await truncateToBaseline();
      const baseline = (await allRows()).length;
      expect(baseline).toBeLessThan(before.length);

      const { inserted } = await backfillActivationHistory(database.current.db);
      expect(inserted).toBe(before.length - baseline);
      expect(await allRows()).toEqual(before);
      expect((await backfillActivationHistory(database.current.db)).inserted).toBe(0);
    });

    it('runs as the schema.lensHistoryBackfill job', async () => {
      const before = await allRows();
      await truncateToBaseline();
      await enqueueJob(
        { type: LENS_HISTORY_BACKFILL_JOB, idempotencyKey: LENS_HISTORY_BACKFILL_KEY, maxAttempts: 5 },
        database.current.db,
      );
      await runSchemaJobs(database.current.db);
      expect(
        await jobsRepository.findByIdempotencyKey(LENS_HISTORY_BACKFILL_KEY, database.current.db),
      ).toMatchObject({
        status: 'succeeded',
      });
      expect(await allRows()).toEqual(before);
    });
  });

  describe('history that does not reach a version', () => {
    it('places the model in the view and answers 409 for its lens', async () => {
      const legacy = await create(
        onA,
        collection('legacy', [{ apiKey: 'name', label: 'Name', type: 'string' }]),
      );
      const created = await getSchemaVersion(database.current.db);
      await update(onA, legacy, {
        ...legacy.definition,
        fields: [...legacy.definition.fields, { apiKey: 'note', label: 'Note', type: 'string' }],
      });
      const changed = await getSchemaVersion(database.current.db);
      // What an install upgraded to 0.9.0 has when the audit log lacks the older rows: a backfilled baseline.
      const { db } = database.current;
      await db
        .deleteFrom('schema_activations')
        .where('model_id', '=', legacy.definition.id)
        .where('schema_version', '<', changed)
        .execute();
      await db
        .updateTable('schema_activations')
        .set({ backfilled: true })
        .where('model_id', '=', legacy.definition.id)
        .execute();
      clearLensCaches();

      const lens = await lensAt(db, await currentView(), created);
      expect(lens?.identity).toBe(false);
      expect(lens?.view.modelsByApiKey.has('legacy')).toBe(true);
      expect(await appErrorOf(() => lens?.lensFor(legacy.definition.id))).toMatchObject({
        statusCode: 409,
        code: 'SCHEMA_VERSION_UNAVAILABLE',
        details: { modelKey: 'legacy', oldestVersion: changed },
      });
      // Models with full history still read through the same lens.
      const story = lens?.view.modelsByApiKey.get('story');
      expect(story).toBeDefined();
      expect(lens?.lensFor(story?.definition.id ?? '')).toMatchObject({
        definitionId: story?.definition.id,
        status: 'identity',
      });
    });
  });

  describe('deleting a workspace', () => {
    it('purges the history of its deleted definitions and keeps rows of one that moved away', async () => {
      const site = expectStatus(await onA.post('/api/admin/sites', { key: 'gone', name: 'Gone' }), 201).json<{
        id: string;
      }>();
      const onGone = on('gone');
      const dropped = await create(
        onGone,
        collection('dropped', [{ apiKey: 'name', label: 'Name', type: 'string' }]),
      );
      let moved = await create(
        onGone,
        collection('moved', [{ apiKey: 'name', label: 'Name', type: 'string' }]),
      );
      expectStatus(
        await onGone.put(`/api/admin/models/${moved.definition.id}/scope`, {
          version: moved.version,
          scope: 'network',
        }),
        200,
      );
      moved = await getModel(onA, moved.definition.id);
      await remove(onGone, dropped);
      expect((await historyOf(dropped.definition.id)).length).toBe(2);

      expectStatus(await onA.delete(`/api/admin/sites/${site.id}`), 204);
      expect(await historyOf(dropped.definition.id)).toEqual([]);
      expect((await historyOf(moved.definition.id)).map((row) => row.site_id)).toEqual([site.id, null]);
    });
  });
});
