import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import * as publicationsRepository from '../src/repositories/publications.js';
import * as snapshotDiffRepository from '../src/repositories/snapshotDiff.js';
import {
  createDefinition,
  createDeliveryToken,
  createRole,
  createTokenForRole,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** The snapshot diff (plan developer-face §5): classification, pagination, policy, REST and GraphQL. */
describe('snapshot changes', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let page: ModelBody;
  let note: ModelBody;

  const create = async (modelKey: string, data: Record<string, unknown>, locale = 'en') =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, { locale, data }), 201).json<EntryBody>();
  const saveLocale = async (modelKey: string, id: string, locale: string, data: Record<string, unknown>) => {
    const current = await admin.get(`/api/admin/content/${modelKey}/${id}?locale=${locale}`);
    const expectedVersion = current.statusCode === 404 ? null : current.json<EntryBody>().version;
    return expectStatus(
      await admin.put(`/api/admin/content/${modelKey}/${id}`, { locale, expectedVersion, data }),
      200,
    ).json<EntryBody>();
  };
  const publish = async (modelKey: string, id: string, locales: string[] = ['en']) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, { locales }), 200);
  const unpublish = async (modelKey: string, id: string, locales: string[] = ['en']) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/unpublish`, { locales }), 200);
  const seq = () => publicationsRepository.currentSeq(PRIMARY_SITE_ID, database.current.db);
  const diff = (query: Partial<snapshotDiffRepository.SnapshotDiffQuery> & { from: number; to: number }) =>
    snapshotDiffRepository.listChanges(
      { siteId: PRIMARY_SITE_ID, limit: 100, modelIds: null, ...query },
      database.current.db,
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    page = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      localized: true,
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', localized: true }],
    });
    note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  describe('classification (repository)', () => {
    it('classifies published, updated and unpublished, groups locales and drops no-ops', async () => {
      const updated = await create('page', { title: 'Updated v1' });
      const unpublished = await create('page', { title: 'Unpublished' });
      const bounced = await create('page', { title: 'Bounced' });
      const transient = await create('note', { text: 'Transient' });
      await publish('page', updated.id);
      await publish('page', unpublished.id);
      await publish('page', bounced.id);
      const from = await seq();

      const published = await create('page', { title: 'New' });
      await saveLocale('page', published.id, 'fr', { title: 'Nouveau' });
      await publish('page', published.id, ['en', 'fr']);
      await saveLocale('page', updated.id, 'en', { title: 'Updated v2' });
      await publish('page', updated.id);
      await unpublish('page', unpublished.id);
      // Same revision live at both ends: dropped.
      await unpublish('page', bounced.id);
      await publish('page', bounced.id);
      // Live only in between: dropped.
      await publish('note', transient.id);
      await unpublish('note', transient.id);
      const to = await seq();

      const result = await diff({ from, to });
      const byId = new Map(result.items.map((item) => [item.entryId, item]));
      expect(result.nextAfter).toBeNull();
      expect([...byId.keys()].sort()).toEqual([published.id, updated.id, unpublished.id].sort());
      expect(result.items.map((item) => item.entryId)).toEqual([...byId.keys()].sort());
      expect(byId.get(published.id)).toMatchObject({
        modelId: page.definition.id,
        locales: [
          { locale: 'en', change: 'published', fromRevisionId: null },
          { locale: 'fr', change: 'published', fromRevisionId: null },
        ],
      });
      const updatedLocales = byId.get(updated.id)?.locales ?? [];
      expect(updatedLocales).toMatchObject([{ locale: 'en', change: 'updated' }]);
      expect(updatedLocales[0]?.fromRevisionId).not.toEqual(updatedLocales[0]?.toRevisionId);
      expect(byId.get(unpublished.id)?.locales).toMatchObject([
        { locale: 'en', change: 'unpublished', toRevisionId: null },
      ]);

      expect((await diff({ from, to, modelIds: [note.definition.id] })).items).toEqual([]);
      expect((await diff({ from, to, modelIds: [] })).items).toEqual([]);
      expect((await diff({ from: to, to })).items).toEqual([]);
    });

    it('paginates by entry ID with a keyset cursor', async () => {
      const from = await seq();
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const entry = await create('note', { text: `Note ${index}` });
        await publish('note', entry.id);
        ids.push(entry.id);
      }
      const to = await seq();
      const seen: string[] = [];
      let after: string | undefined;
      for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
        const result = await diff({ from, to, limit: 2, after });
        seen.push(...result.items.map((item) => item.entryId));
        if (result.nextAfter === null) {
          break;
        }
        expect(result.items).toHaveLength(2);
        after = result.nextAfter;
      }
      expect(seen).toEqual([...ids].sort());
    });
  });
  describe('API', () => {
    type ChangesBody = {
      from: number;
      to: number;
      schemaVersions: { from: number | null; to: number | null };
      items: Array<{
        id: string;
        modelKey: string;
        routeKey: string;
        title: string | null;
        coverMediaId: string | null;
        locales: Array<{ locale: string; change: string; revisionId: string | null }>;
      }>;
      nextCursor: string | null;
    };
    let pageToken: string;
    let ownedNotesToken: string;
    let from: number;
    let to: number;
    let pageEntry: EntryBody;
    let noteEntry: EntryBody;

    const get = (url: string, token: string | null) =>
      testApp.app.inject({
        method: 'GET',
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });

    beforeAll(async () => {
      pageToken = await createDeliveryToken(database.current.db, [{ modelId: page.definition.id }]);
      // Tokens own nothing, so an ownership condition hides every note from this one.
      ownedNotesToken = await createDeliveryToken(database.current.db, [
        { modelId: page.definition.id },
        { modelId: note.definition.id, condition: 'ownedByPrincipal' },
      ]);
      from = await seq();
      pageEntry = await create('page', { title: 'API page' });
      await publish('page', pageEntry.id);
      noteEntry = await create('note', { text: 'API note' });
      await publish('note', noteEntry.id);
      to = await seq();
    });

    it('lists changed entries of readable models only, with route keys and schema versions', async () => {
      const body = expectStatus(
        await get(`/api/snapshots/changes?from=${from}&to=${to}`, pageToken),
        200,
      ).json<ChangesBody>();
      expect(body).toMatchObject({ from, to, nextCursor: null });
      expect(body.items).toEqual([
        {
          id: pageEntry.id,
          modelId: page.definition.id,
          modelKey: 'page',
          routeKey: 'pages',
          title: 'API page',
          coverMediaId: null,
          locales: [{ locale: 'en', change: 'published', revisionId: pageEntry.revisionId }],
        },
      ]);
      expect(Object.keys(body.schemaVersions)).toEqual(['from', 'to']);
    });

    it('names each entry by its title at `to`, or at `from` once unpublished, within the read mask', async () => {
      const titleId = page.definition.fields.find((field) => field.apiKey === 'title')?.id ?? '';
      const before = await seq();
      const renamed = await saveLocale('page', pageEntry.id, 'en', { title: 'API page, renamed' });
      await publish('page', pageEntry.id);
      const updated = expectStatus(
        await get(`/api/snapshots/changes?from=${before}`, pageToken),
        200,
      ).json<ChangesBody>();
      expect(updated.items).toEqual([
        expect.objectContaining({
          title: 'API page, renamed',
          locales: [{ locale: 'en', change: 'updated', revisionId: renamed.revisionId }],
        }),
      ]);

      const live = await seq();
      await unpublish('page', pageEntry.id);
      const removed = expectStatus(
        await get(`/api/snapshots/changes?from=${live}`, pageToken),
        200,
      ).json<ChangesBody>();
      // Gone at `to`: described from the revision that was live at `from`.
      expect(removed.items).toEqual([
        expect.objectContaining({
          title: 'API page, renamed',
          locales: [{ locale: 'en', change: 'unpublished', revisionId: renamed.revisionId }],
        }),
      ]);

      const maskedToken = await createDeliveryToken(database.current.db, [
        { modelId: page.definition.id, fieldIds: [`${titleId}-hidden`] },
      ]);
      const masked = expectStatus(
        await get(`/api/snapshots/changes?from=${live}`, maskedToken),
        200,
      ).json<ChangesBody>();
      expect(masked.items).toEqual([expect.objectContaining({ id: pageEntry.id, title: null })]);
      await publish('page', pageEntry.id);
    });

    it('applies row filters (evaluated on the entry now)', async () => {
      const body = expectStatus(
        await get(`/api/snapshots/changes?from=${from}&to=${to}`, ownedNotesToken),
        200,
      ).json<ChangesBody>();
      expect(body.items.map((item) => item.id)).toEqual([pageEntry.id]);
    });

    it('defaults `to` to the current snapshot and pages with `after`', async () => {
      const first = expectStatus(
        await get(`/api/snapshots/changes?from=0&limit=1`, pageToken),
        200,
      ).json<ChangesBody>();
      expect(first.to).toBe(await seq());
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const second = expectStatus(
        await get(`/api/snapshots/changes?from=0&limit=1&after=${first.nextCursor}`, pageToken),
        200,
      ).json<ChangesBody>();
      expect((second.items[0]?.id ?? '') > (first.items[0]?.id ?? '')).toBe(true);
    });

    it('rejects snapshots that do not exist, inverted ranges and anonymous callers with no grants', async () => {
      const current = await seq();
      expect((await get(`/api/snapshots/changes?from=0&to=${current + 5}`, pageToken)).json()).toMatchObject({
        error: { code: 'SNAPSHOT_INVALID' },
      });
      expect((await get(`/api/snapshots/changes?from=${current}&to=0`, pageToken)).statusCode).toBe(400);
      expect((await get('/api/snapshots/changes?from=0', null)).statusCode).toBe(401);
      expect((await get('/api/snapshots/current', null)).statusCode).toBe(401);
    });

    it('answers an authenticated caller who may read no model with an empty list, not an error', async () => {
      const createOnly = await createTokenForRole(
        database.current.db,
        await createRole(database.current.db, 'delivery', [
          { action: 'create', modelId: note.definition.id },
        ]),
      );
      const body = expectStatus(
        await get(`/api/snapshots/changes?from=0`, createOnly),
        200,
      ).json<ChangesBody>();
      expect(body).toMatchObject({ from: 0, to: await seq(), items: [], nextCursor: null });
      expect(expectStatus(await get('/api/snapshots/current', createOnly), 200).json()).toMatchObject({
        snapshot: await seq(),
      });
    });

    it('reports the current snapshot', async () => {
      const before = expectStatus(await get('/api/snapshots/current', pageToken), 200).json<{
        snapshot: number;
        schemaVersion: number;
      }>();
      // A metadata-only activation (label rename) takes no snapshot number but moves the schema version.
      const current = (await admin.get(`/api/admin/models/${note.definition.id}`)).json<ModelBody>();
      expectStatus(
        await admin.put(`/api/admin/models/${note.definition.id}`, {
          definition: { ...current.definition, label: 'Short note' },
          expectedVersion: current.version,
        }),
        200,
      );
      const after = expectStatus(await get('/api/snapshots/current', pageToken), 200).json<{
        snapshot: number;
        schemaVersion: number;
      }>();
      expect(after.snapshot).toBe(before.snapshot);
      expect(after.schemaVersion).toBeGreaterThan(before.schemaVersion);

      const body = expectStatus(await get('/api/snapshots/current', pageToken), 200).json<{
        snapshot: number;
        schemaVersion: number;
      }>();
      expect(body.snapshot).toBe(await seq());
      expect(body.schemaVersion).toBeGreaterThan(0);
    });

    it('serves the same through GraphQL `_changes` and `_snapshot`', async () => {
      const result = await graphql<{
        _changes: {
          from: number;
          to: number;
          nextCursor: string | null;
          nodes: Array<{ id: string; modelKey: string; locales: Array<{ change: string }> }>;
        };
        _snapshot: { snapshot: number };
      }>(
        testApp.app,
        `
          query ($from: Int!, $to: Int) {
            _changes(from: $from, to: $to, first: 10) {
              from
              to
              fromSchemaVersion
              toSchemaVersion
              nextCursor
              nodes {
                id
                modelKey
                routeKey
                locales {
                  locale
                  change
                }
              }
            }
            _snapshot {
              snapshot
              schemaVersion
              publishedAt
            }
          }
        `,
        { variables: { from, to }, headers: { authorization: `Bearer ${pageToken}` } },
      );
      expect(result.body.errors).toBeUndefined();
      expect(result.body.data?._changes).toMatchObject({
        from,
        to,
        nextCursor: null,
        nodes: [{ id: pageEntry.id, modelKey: 'page', locales: [{ change: 'PUBLISHED' }] }],
      });
      expect(result.body.data?._snapshot.snapshot).toBe(await seq());
      expect(noteEntry.id).toBeDefined();
    });
  });
});
