import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { resolveModel } from '../src/content/model.js';
import { guardModelVersions } from '../src/content/write/transaction.js';
import { outsideConnectionScope } from '../src/db/connectionScope.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import * as entriesRepository from '../src/repositories/entries.js';
import * as publicationsRepository from '../src/repositories/publications.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { runContentSchemaJobs } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ListBody = { items: Array<ModelBody & { scope: 'network' | 'site'; siteId: string | null }> };
type ErrorBody = { error: { code: string; details?: Record<string, unknown> } };
type MeBody = {
  networkPermissions: string[];
  sitePermissions: string[];
  globalPermissions: string[];
  modelPermissions: Record<string, string[]>;
};
type ExportBody = {
  schemaVersion: number;
  site: { id: string; key: string } | null;
  definitions: Array<{
    definition: ModelBody['definition'];
    version: number;
    hash: string;
    site: string | null;
  }>;
};

const codeOf = (response: LightMyRequestResponse) => response.json<ErrorBody>().error.code;

const collection = (
  apiKey: string,
  fields: unknown[] = [{ apiKey: 'title', label: 'Title', type: 'string' }],
) => ({
  kind: 'collection',
  apiKey,
  label: apiKey,
  fields,
});

/**
 * Per-site schema with optional shared content types (plan site-schema): a definition belongs to one site,
 * or is shared with every site. Isolation of site definitions, the shared API ID rule, permissions per scope,
 * snapshots, scope changes (and the race they could have with a writer on another site), site deletion and
 * schema sync per site.
 */
describe('per-site schema', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let siteB: { id: string; key: string };
  let owner: TestSession;
  let adminRoleId: string;

  /** The admin API on one site, as the network admin token. */
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

  /** A session client on one site. */
  const as = (session: TestSession, siteKey: string) => {
    const headers = { ...session.headers, [SITE_HEADER]: siteKey };
    return {
      get: (url: string) => testApp.app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'POST', url, payload: payload as object, headers }),
      put: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'PUT', url, payload: payload as object, headers }),
      patch: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'PATCH', url, payload: payload as object, headers }),
    };
  };

  const create = async (
    site: ReturnType<typeof on>,
    definition: Record<string, unknown>,
    scope?: 'network' | 'site',
  ): Promise<ModelBody> => {
    const created = expectStatus(
      await site.post('/api/admin/models', { definition, ...(scope ? { scope } : {}) }),
      201,
    ).json<{ definitionId: string }>();
    return expectStatus(await site.get(`/api/admin/models/${created.definitionId}`), 200).json<ModelBody>();
  };
  const keysOn = async (site: ReturnType<typeof on>, query = '') =>
    expectStatus(await site.get(`/api/admin/models${query}`), 200)
      .json<ListBody>()
      .items.map((item) => `${item.definition.apiKey}:${item.scope}`)
      .sort();
  const createEntry = async (site: ReturnType<typeof on>, modelKey: string, data: Record<string, unknown>) =>
    expectStatus(await site.post(`/api/admin/content/${modelKey}`, { data }), 201).json<EntryBody>();
  const changeScope = (site: ReturnType<typeof on>, model: ModelBody, body: Record<string, unknown>) =>
    site.put(`/api/admin/models/${model.definition.id}/scope`, { version: model.version, ...body });
  const seqOf = (siteId: string) => publicationsRepository.currentSeq(siteId, database.current.db);

  /** A new admin holding only these assignments (given by the owner through the API). */
  const adminWith = async (assignments: Array<{ roleId: string; siteId: string | null }>) => {
    const admin = await createAdmin(database.current.db, { roleKeys: [] });
    expectStatus(await as(owner, 'default').patch(`/api/admin/users/${admin.id}`, { assignments }), 200);
    return login(testApp.app, admin);
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    network = schemaClient(testApp.app, await createRoleToken(database.current.db));
    owner = await login(testApp.app, await createAdmin(database.current.db));
    siteB = expectStatus(await onA.post('/api/admin/sites', { key: 'b', name: 'Site B' }), 201).json<{
      id: string;
      key: string;
    }>();
    const [role] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
    adminRoleId = role?.id ?? '';
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  describe('isolation and API IDs', () => {
    let post: ModelBody;
    let tag: ModelBody;

    beforeAll(async () => {
      post = await create(onA, collection('post'));
      tag = await create(
        onA,
        collection('tag', [{ apiKey: 'name', label: 'Name', type: 'string' }]),
        'network',
      );
    });

    it('a definition created on a site belongs to it: listed, writable and delivered there only', async () => {
      expect(post).toMatchObject({ scope: 'site', siteId: PRIMARY_SITE_ID });
      expect(tag).toMatchObject({ scope: 'network', siteId: null });
      expect(await keysOn(onA)).toEqual(expect.arrayContaining(['post:site', 'tag:network']));
      expect(await keysOn(onB)).toContain('tag:network');
      expect(await keysOn(onB)).not.toContain('post:site');
      expect(await keysOn(onA, '?scope=network')).toEqual(['tag:network']);

      await createEntry(onA, 'post', { title: 'On A' });
      await createEntry(onB, 'tag', { name: 'On B' });
      const missing = await onB.post('/api/admin/content/post', { data: { title: 'Nope' } });
      expect(missing.statusCode).toBe(404);
      expect(codeOf(missing)).toBe('MODEL_NOT_FOUND');
      expect((await onB.get(`/api/admin/models/${post.definition.id}`)).statusCode).toBe(404);
      expect((await network.get('/api/content/posts?site=b')).statusCode).toBe(404);
      expectStatus(await network.get('/api/content/posts?site=default'), 200);
    });

    it('another site may have its own definition with the same API ID and other fields', async () => {
      const own = await create(
        onB,
        collection('post', [
          { apiKey: 'headline', label: 'Headline', type: 'string' },
          { apiKey: 'body', label: 'Body', type: 'text' },
        ]),
      );
      expect(own).toMatchObject({ scope: 'site', siteId: siteB.id });
      expect(own.definition.id).not.toBe(post.definition.id);
      const entry = await createEntry(onB, 'post', { headline: 'B headline' });
      expect(entry.data).toMatchObject({ headline: 'B headline' });
      expect((await onA.post('/api/admin/content/post', { data: { headline: 'x' } })).statusCode).toBe(422);
    });

    it('refuses a shared API ID any site already uses, naming the site', async () => {
      const response = await onA.post('/api/admin/models', {
        definition: collection('post'),
        scope: 'network',
      });
      expect(response.statusCode).toBe(422);
      const issues = (response.json<ErrorBody>().error.details?.issues ?? []) as Array<{
        code: string;
        path: string;
        siteKey?: string;
      }>;
      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'API_KEY_COLLISION', path: '/apiKey' })]),
      );
      expect(issues.map((found) => found.siteKey)).toEqual(expect.arrayContaining(['default']));
    });

    it('a shared definition references shared definitions only', async () => {
      const local = await create(onA, collection('localNote'));
      const response = await onA.post('/api/admin/models', {
        definition: collection('sharedPage', [
          {
            apiKey: 'note',
            label: 'Note',
            type: 'relation',
            settings: { target: local.definition.id, cardinality: 'one' },
          },
        ]),
        scope: 'network',
      });
      expect(response.statusCode).toBe(422);
      expect(JSON.stringify(response.json())).toContain('INVALID_REFERENCE_TARGET');
      // A site definition may relate to a shared one.
      await create(
        onA,
        collection('localPage', [
          {
            apiKey: 'tag',
            label: 'Tag',
            type: 'relation',
            settings: { target: tag.definition.id, cardinality: 'one' },
          },
        ]),
      );
    });

    it('cannot reach another site’s definition by ID (change, delete or restore)', async () => {
      const editOther = await onB.put(`/api/admin/models/${post.definition.id}`, {
        definition: post.definition,
        expectedVersion: post.version,
      });
      expect(editOther.statusCode).toBe(404);
      const recreate = await onB.post('/api/admin/models', { definition: post.definition });
      expect(recreate.statusCode).toBe(404);
    });
  });

  describe('permissions per scope', () => {
    let shared: ModelBody;

    beforeAll(async () => {
      shared = await create(onA, collection('sharedThing'), 'network');
    });

    it('a site admin manages the site’s own definitions, never shared ones', async () => {
      const siteAdmin = as(await adminWith([{ roleId: adminRoleId, siteId: siteB.id }]), 'b');
      const created = expectStatus(
        await siteAdmin.post('/api/admin/models', { definition: collection('siteOwned') }),
        201,
      ).json<{ definitionId: string }>();
      const own = expectStatus(
        await siteAdmin.get(`/api/admin/models/${created.definitionId}`),
        200,
      ).json<ModelBody>();
      expectStatus(
        await siteAdmin.put(`/api/admin/models/${own.definition.id}`, {
          definition: { ...own.definition, label: 'Site owned' },
          expectedVersion: own.version,
        }),
        200,
      );
      const sharedCreate = await siteAdmin.post('/api/admin/models', {
        definition: collection('notAllowed'),
        scope: 'network',
      });
      expect(sharedCreate.statusCode).toBe(403);
      const sharedEdit = await siteAdmin.put(`/api/admin/models/${shared.definition.id}`, {
        definition: { ...shared.definition, label: 'Changed' },
        expectedVersion: shared.version,
      });
      expect(sharedEdit.statusCode).toBe(403);
      expect(
        (
          await siteAdmin.put(`/api/admin/models/${own.definition.id}/scope`, {
            scope: 'network',
            version: own.version + 1,
          })
        ).statusCode,
      ).toBe(403);

      const me = expectStatus(await siteAdmin.get('/api/admin/auth/me'), 200).json<MeBody>();
      expect(me.networkPermissions).toEqual([]);
      expect(me.sitePermissions).toContain('schema.create');
      expect(me.globalPermissions).toContain('schema.create');
      expect(me.modelPermissions[own.definition.id]).toContain('schemaManage');
      expect(me.modelPermissions[shared.definition.id] ?? []).not.toContain('schemaManage');
    });

    it('a site admin token creates on its site, but never reaches network schema settings', async () => {
      const token = schemaClient(testApp.app, await createRoleToken(database.current.db, 'admin', siteB.id));
      expectStatus(await token.post('/api/admin/models', { definition: collection('tokenOwned') }), 201);
      expect(
        (await token.post('/api/admin/models', { definition: collection('tokenShared'), scope: 'network' }))
          .statusCode,
      ).toBe(403);
      // Locales are network schema: a role held on one site never reaches them.
      const locale = await token.post('/api/admin/locales', { code: 'de', label: 'Deutsch' });
      expect(locale.statusCode).toBe(403);
      const lock = await token.put('/api/admin/schema/settings', { readOnly: true });
      expect(lock.statusCode).toBe(403);
    });
  });

  describe('snapshots and scope changes', () => {
    it('a site definition’s conversion numbers its site only; a scope change numbers none', async () => {
      const note = await create(onA, collection('siteNote'));
      await createEntry(onA, 'siteNote', { title: 'Draft' });
      const before = { a: await seqOf(PRIMARY_SITE_ID), b: await seqOf(siteB.id) };
      expectStatus(
        await onA.put(`/api/admin/models/${note.definition.id}`, {
          definition: { ...note.definition, draftAndPublish: false },
          expectedVersion: note.version,
          acknowledgeBreaking: true,
          acknowledgeDestructive: true,
        }),
        202,
      );
      await runContentSchemaJobs(database.current.db);
      expect(await seqOf(PRIMARY_SITE_ID)).toBe(before.a + 1);
      expect(await seqOf(siteB.id)).toBe(before.b);

      const current = expectStatus(
        await onA.get(`/api/admin/models/${note.definition.id}`),
        200,
      ).json<ModelBody>();
      const after = { a: await seqOf(PRIMARY_SITE_ID), b: await seqOf(siteB.id) };
      const shared = expectStatus(await changeScope(onA, current, { scope: 'network' }), 200).json<{
        status: string;
        version: number;
        siteId: string | null;
      }>();
      expect(shared).toMatchObject({ status: 'activated', siteId: null, version: current.version + 1 });
      expect({ a: await seqOf(PRIMARY_SITE_ID), b: await seqOf(siteB.id) }).toEqual(after);
      expect(await keysOn(onB)).toContain('siteNote:network');
      // The definition (and its hash) did not change: a new revision of the same body.
      const moved = expectStatus(await onB.get(`/api/admin/models/${note.definition.id}`), 200).json<
        ModelBody & { hash: string }
      >();
      expect(moved.hash).toBe((current as ModelBody & { hash: string }).hash);
    });

    it('shared → site is refused while another site has entries, allowed once it has none', async () => {
      const item = await create(onA, collection('item'), 'network');
      const onSiteB = await createEntry(onB, 'item', { title: 'B item' });
      const refused = await changeScope(onA, item, { scope: 'site' });
      expect(refused.statusCode).toBe(409);
      expect(refused.json<ErrorBody>().error).toMatchObject({
        code: 'SCOPE_IN_USE',
        details: { entries: 1, sites: [{ siteId: siteB.id, key: 'b', entries: 1 }] },
      });
      expectStatus(await onB.delete(`/api/admin/content/item/${onSiteB.id}`), 204);
      const moved = expectStatus(await changeScope(onA, item, { scope: 'site' }), 200).json<{
        siteId: string;
      }>();
      expect(moved.siteId).toBe(PRIMARY_SITE_ID);
      expect(await keysOn(onB)).not.toContain('item:network');
      expect((await onB.post('/api/admin/content/item', { data: { title: 'x' } })).statusCode).toBe(404);
      const events = await database.current.db
        .selectFrom('outbox_events')
        .select(['site_id'])
        .where('aggregate_id', '=', item.definition.id)
        .where('type', '=', 'schema.activated')
        .execute();
      // Created shared (every site), then moved (concerns every site): network events.
      expect(events.map((event) => event.site_id)).toEqual([null, null]);
    });

    it('site → shared is refused when the API ID is taken on another site', async () => {
      await create(onB, collection('clash'));
      const mine = await create(onA, collection('clash'));
      const refused = await changeScope(onA, mine, { scope: 'network' });
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain('"siteKey":"b"');
    });

    it('shared → site is refused while a shared definition references it', async () => {
      const target = await create(onA, collection('refTarget'), 'network');
      await create(
        onA,
        collection('refHolder', [
          {
            apiKey: 'target',
            label: 'Target',
            type: 'relation',
            settings: { target: target.definition.id, cardinality: 'one' },
          },
        ]),
        'network',
      );
      const refused = await changeScope(onA, target, { scope: 'site' });
      expect(refused.statusCode).toBe(422);
      expect(JSON.stringify(refused.json())).toContain('INVALID_REFERENCE_TARGET');
    });

    it('a site event reaches its site’s webhooks only (outbox site column)', async () => {
      const own = await create(onB, collection('siteEvent'));
      const [event] = await database.current.db
        .selectFrom('outbox_events')
        .select(['site_id'])
        .where('aggregate_id', '=', own.definition.id)
        .execute();
      expect(event?.site_id).toBe(siteB.id);
    });
  });

  describe('a writer on another site during a scope change', () => {
    it('a write already holding the model’s lock lands first, and the scope change is refused', async () => {
      const racing = await create(onA, collection('racing'), 'network');
      const view = (await testApp.app.schemaRegistry.getSnapshot()).forSite(siteB.id);
      const model = resolveModel(view, 'racing');
      let response: Promise<LightMyRequestResponse> | undefined;
      await database.current.db.transaction().execute(async (trx) => {
        await guardModelVersions(trx, [model], siteB.id);
        await entriesRepository.insert(
          { siteId: siteB.id, modelId: model.definition.id, ownerAppUserId: null, createdByAdminId: null },
          trx,
        );
        // The scope change starts while this writer holds the model's shared lock (as another request, not
        // as work of this transaction).
        response = outsideConnectionScope(() => changeScope(onA, racing, { scope: 'site' }));
      });
      const refused = await (response as Promise<LightMyRequestResponse>);
      expect(refused.statusCode).toBe(409);
      expect(codeOf(refused)).toBe('SCOPE_IN_USE');
    });

    it('a writer that resolved the model before the scope change cannot write after it', async () => {
      const late = await create(onA, collection('late'), 'network');
      const staleView = (await testApp.app.schemaRegistry.getSnapshot()).forSite(siteB.id);
      const model = resolveModel(staleView, 'late');
      expectStatus(await changeScope(onA, late, { scope: 'site' }), 200);
      await expect(
        database.current.db.transaction().execute(async (trx) => {
          await guardModelVersions(trx, [model], siteB.id);
        }),
      ).rejects.toMatchObject({ code: 'SCHEMA_CHANGED' });
      // Even past the guard, the insert itself refuses a model outside the site's view.
      await expect(
        entriesRepository.insert(
          { siteId: siteB.id, modelId: late.definition.id, ownerAppUserId: null, createdByAdminId: null },
          database.current.db,
        ),
      ).rejects.toThrow();
    });
  });

  describe('deleting a site', () => {
    it('is refused while the site has definitions of its own, then succeeds once they are deleted', async () => {
      const site = expectStatus(await onA.post('/api/admin/sites', { key: 'gone', name: 'Gone' }), 201).json<{
        id: string;
      }>();
      const onGone = on('gone');
      const own = await create(onGone, collection('goneModel'));
      const refused = await onA.delete(`/api/admin/sites/${site.id}`);
      expect(refused.statusCode).toBe(409);
      expect(refused.json<ErrorBody>().error).toMatchObject({
        code: 'SITE_NOT_EMPTY',
        details: { definitions: 1 },
      });
      expectStatus(
        await onGone.delete(`/api/admin/models/${own.definition.id}?expectedVersion=${own.version}`),
        200,
      );
      expectStatus(await onA.delete(`/api/admin/sites/${site.id}`), 204);
      const rows = await database.current.db
        .selectFrom('models')
        .select('id')
        .where('id', '=', own.definition.id)
        .execute();
      expect(rows).toEqual([]);
    });
  });

  describe('schema sync per site', () => {
    it('exports a site’s view with each definition’s scope; ?scope=network the shared ones', async () => {
      await create(onB, collection('exported'));
      const exported = expectStatus(await onB.get('/api/admin/schema/export'), 200).json<ExportBody>();
      expect(exported.site).toEqual({ id: siteB.id, key: 'b' });
      const scopes = new Map(exported.definitions.map((entry) => [entry.definition.apiKey, entry.site]));
      expect(scopes.get('exported')).toBe('b');
      expect(scopes.get('tag')).toBeNull();
      const sharedOnly = expectStatus(
        await onB.get('/api/admin/schema/export?scope=network'),
        200,
      ).json<ExportBody>();
      expect(sharedOnly.definitions.every((entry) => entry.site === null)).toBe(true);
    });

    it('creates a file in its folder’s scope, and refuses a file whose folder disagrees with the instance', async () => {
      const exported = expectStatus(await onB.get('/api/admin/schema/export'), 200).json<ExportBody>();
      const lock = {
        formatVersion: 2,
        schemaVersion: exported.schemaVersion,
        sites: ['b'],
        definitions: Object.fromEntries(
          exported.definitions.map((entry) => [
            entry.definition.id,
            {
              kind: entry.definition.kind,
              apiKey: entry.definition.apiKey,
              version: entry.version,
              hash: entry.hash,
              site: entry.site,
            },
          ]),
        ),
      };
      const created = expectStatus(
        await onB.post('/api/admin/schema/apply', {
          definitions: [collection('fromFile')],
          scopes: ['site'],
          base: lock,
          prune: false,
          dryRun: false,
        }),
        200,
      ).json<{ results: Array<{ apiKey: string; outcome: string }> }>();
      expect(created.results.find((item) => item.apiKey === 'fromFile')?.outcome).toBe('activated');
      expect(await keysOn(onB)).toContain('fromFile:site');

      const own = exported.definitions.find((entry) => entry.definition.apiKey === 'exported');
      const moved = await onB.post('/api/admin/schema/apply', {
        definitions: [{ ...own?.definition, label: 'Edited in models/' }],
        scopes: ['network'],
        base: lock,
        prune: false,
        dryRun: true,
      });
      expect(moved.statusCode).toBe(409);
      expect(codeOf(moved)).toBe('SCOPE_MISMATCH');
    });

    it('prune never reaches another site’s definitions, whatever the lock lists', async () => {
      const exportedB = expectStatus(await onB.get('/api/admin/schema/export'), 200).json<ExportBody>();
      const lockOfB = {
        formatVersion: 2,
        schemaVersion: exportedB.schemaVersion,
        sites: ['b', 'default'],
        definitions: Object.fromEntries(
          exportedB.definitions
            .filter((entry) => entry.site === 'b')
            .map((entry) => [
              entry.definition.id,
              {
                kind: entry.definition.kind,
                apiKey: entry.definition.apiKey,
                version: entry.version,
                hash: entry.hash,
                site: 'b',
              },
            ]),
        ),
      };
      const before = await keysOn(onB);
      const result = expectStatus(
        await onA.post('/api/admin/schema/apply', {
          definitions: [],
          base: lockOfB,
          prune: true,
          dryRun: false,
        }),
        200,
      ).json<{ results: Array<{ decision: { action: string } }> }>();
      expect(result.results.some((item) => item.decision.action === 'delete')).toBe(false);
      expect(await keysOn(onB)).toEqual(before);
    });

    it('refuses a tree pulled for other sites, and a shared file without every-site permission', async () => {
      const empty = { formatVersion: 2, schemaVersion: 0, sites: ['elsewhere'], definitions: {} };
      const wrongSite = await onB.post('/api/admin/schema/apply', {
        definitions: [],
        base: empty,
        prune: false,
        dryRun: true,
      });
      expect(codeOf(wrongSite)).toBe('LOCK_SITE_MISMATCH');

      const siteToken = schemaClient(
        testApp.app,
        await createRoleToken(database.current.db, 'admin', siteB.id),
      );
      const refused = await siteToken.post('/api/admin/schema/apply', {
        definitions: [collection('sharedFromFile'), collection('siteFromFile')],
        scopes: ['network', 'site'],
        base: { formatVersion: 2, schemaVersion: 0, sites: ['b'], definitions: {} },
        prune: false,
        dryRun: false,
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json<ErrorBody>().error).toMatchObject({
        code: 'FORBIDDEN_SCOPE',
        details: { items: [expect.objectContaining({ apiKey: 'sharedFromFile', scope: 'network' })] },
      });
      expect(await keysOn(onB)).not.toContain('siteFromFile:site');
    });
  });
});
