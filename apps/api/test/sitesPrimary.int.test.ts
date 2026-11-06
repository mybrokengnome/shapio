import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { runImportJob } from '../src/content/transfer/job.js';
import type { ExtensionServices } from '../src/extensions/public.js';
import { createExtensionServices } from '../src/extensions/services.js';
import { servicesForSite } from '../src/extensions/siteServices.js';
import type { JobContext } from '../src/jobs/types.js';
import { PermanentJobError } from '../src/jobs/types.js';
import { APP_ROLE_IDS } from '../src/permissions/appRoles.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { createSchemaRegistry } from '../src/schema/registry.js';
import { findPreSitesSite } from '../src/services/sites.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { setPublicGrants } from './helpers/appUsers.js';
import { expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type SiteBody = { id: string; key: string; isPrimary: boolean; version: number; updatedAt: string };
type ListBody = { data: Array<{ title: string }> };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;
const run = promisify(execFile);

/**
 * Making another site primary (plan make-primary-site): the flag moves live, with no restart. Requests that
 * name no site, top-level extension services and the CLI follow it; the former primary deletes like any
 * other empty site. The tests run in order: each one starts from the state the previous one left.
 */
describe('making another site primary', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: TestSession;
  let network: SchemaClient;
  let services: ExtensionServices;
  const ids = { marketing: '', defaultPost: '' };

  /** Admin requests as the owner session, on `site` (none named: the primary site). */
  const as = (session: TestSession, site?: string) => {
    const headers = { ...session.headers, ...(site ? { [SITE_HEADER]: site } : {}) };
    return {
      get: (url: string) => testApp.app.inject({ method: 'GET', url, headers }),
      post: (url: string, payload?: unknown) =>
        testApp.app.inject({
          method: 'POST',
          url,
          headers,
          ...(payload === undefined ? {} : { payload: payload as object }),
        }),
      put: (url: string, payload: unknown) =>
        testApp.app.inject({ method: 'PUT', url, headers, payload: payload as object }),
      delete: (url: string) => testApp.app.inject({ method: 'DELETE', url, headers }),
    };
  };
  const makePrimary = (id: string, session: TestSession = owner) =>
    as(session).post(`/api/admin/sites/${id}/make-primary`);
  const sites = async () => expectStatus(await as(owner).get('/api/admin/sites'), 200).json<SiteBody[]>();
  const primaryKeys = async () => (await sites()).filter((site) => site.isPrimary).map((site) => site.key);
  const createPost = async (title: string, site: string) =>
    expectStatus(
      await as(owner, site).post('/api/admin/content/post', { data: { title }, publish: true }),
      201,
    ).json<EntryBody>().id;
  const anonymousTitles = async (query = '') =>
    expectStatus(await testApp.app.inject({ method: 'GET', url: `/api/content/posts${query}` }), 200)
      .json<ListBody>()
      .data.map((entry) => entry.title);
  const auditRows = () =>
    database.current.db
      .selectFrom('audit_events')
      .select(['target_id', 'metadata'])
      .where('action', '=', 'site.make_primary')
      .orderBy('seq')
      .execute();
  const metadataOf = (value: unknown) =>
    (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>;
  const cli = async (args: string[]) => {
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        ['--conditions=@shapio/source', '--import', 'tsx', 'src/cli.ts', ...args],
        {
          cwd: API_ROOT,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            DATABASE_URL: database.current.url,
          },
        },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    }
  };

  beforeAll(async () => {
    const { db } = database.current;
    testApp = await createTestApp(database.current, { schemaListen: false });
    owner = await login(testApp.app, await createAdmin(db));
    network = schemaClient(testApp.app, await createRoleToken(db));
    ids.marketing = expectStatus(
      await as(owner).post('/api/admin/sites', { key: 'marketing', name: 'Marketing' }),
      201,
    ).json<SiteBody>().id;
    const model = expectStatus(
      await as(owner).post('/api/admin/models', {
        scope: 'network',
        definition: {
          kind: 'collection',
          apiKey: 'post',
          label: 'Post',
          fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    ids.defaultPost = await createPost('Default post', 'default');
    await createPost('Marketing post', 'marketing');
    // The public role reads posts; the built-in site binds it, and marketing binds it too.
    await setPublicGrants(db, [{ action: 'read', modelId: model.definitionId }]);
    expectStatus(
      await as(owner).put(`/api/admin/sites/${ids.marketing}/app-roles`, {
        public: [APP_ROLE_IDS.public],
        authenticated: [APP_ROLE_IDS.authenticated],
      }),
      200,
    );
    services = await createExtensionServices(
      {
        db,
        registry: createSchemaRegistry({ db, log: silentLogger }),
        permissions: testApp.app.permissions,
        logger: silentLogger,
        jobNames: new Set(),
      },
      {},
      { nodeEnv: 'test', publicUrl: 'http://localhost', basePath: '', projectDir: API_ROOT },
    );
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('starts on the built-in site: unnamed requests and top-level services read it', async () => {
    expect(await primaryKeys()).toEqual(['default']);
    expect(await anonymousTitles()).toEqual(['Default post']);
    expect(services.site.key).toBe('default');
    const listed = await services.content.list('post');
    expect(listed.items.map((entry) => entry.data.title)).toEqual(['Default post']);
  });

  it('moves the flag: one primary, versions unchanged, an audit row naming the previous primary', async () => {
    const before = await sites();
    const moved = expectStatus(await makePrimary(ids.marketing), 200).json<SiteBody>();
    expect(moved).toMatchObject({ id: ids.marketing, key: 'marketing', isPrimary: true });
    const after = await sites();
    expect(after.filter((site) => site.isPrimary).map((site) => site.key)).toEqual(['marketing']);
    for (const site of after) {
      const was = before.find((candidate) => candidate.id === site.id);
      expect(site.version).toBe(was?.version);
      expect(new Date(site.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(was?.updatedAt ?? 0).getTime(),
      );
    }
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_id).toBe(ids.marketing);
    expect(metadataOf(rows[0]?.metadata)).toEqual({
      key: 'marketing',
      name: 'Marketing',
      previous: { id: PRIMARY_SITE_ID, key: 'default', name: 'Default site' },
    });
  });

  it('is a no-op on the site that is already primary, and 404 for an unknown site', async () => {
    const [before] = (await sites()).filter((site) => site.isPrimary);
    expectStatus(await makePrimary(ids.marketing), 200);
    const [after] = (await sites()).filter((site) => site.isPrimary);
    expect(after).toEqual(before);
    expect(await auditRows()).toHaveLength(1);
    const unknown = await makePrimary('00000000-0000-4000-b000-0000000000ff');
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown)).toBe('SITE_NOT_FOUND');
  });

  it('needs sites.manage on the network: a role on one site and a site token are refused', async () => {
    const [adminRole] = await adminRolesRepository.findByKeys(['admin'], database.current.db);
    const siteAdmin = await createAdmin(database.current.db, { roleKeys: [] });
    expectStatus(
      await testApp.app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${siteAdmin.id}`,
        headers: owner.headers,
        payload: { assignments: [{ roleId: adminRole?.id ?? '', siteId: ids.marketing }] },
      }),
      200,
    );
    const siteSession = await login(testApp.app, siteAdmin);
    expect((await makePrimary(PRIMARY_SITE_ID, siteSession)).statusCode).toBe(403);
    const siteToken = schemaClient(
      testApp.app,
      await createRoleToken(database.current.db, 'admin', ids.marketing),
    );
    expect(
      (await siteToken.post(`/api/admin/sites/${PRIMARY_SITE_ID}/make-primary`, undefined)).statusCode,
    ).toBe(403);
    // A network token with sites.manage passes (and moves the flag back to the built-in site).
    expectStatus(await network.post(`/api/admin/sites/${PRIMARY_SITE_ID}/make-primary`, undefined), 200);
    expect(await primaryKeys()).toEqual(['default']);
    expectStatus(await makePrimary(ids.marketing), 200);
  });

  it('is followed live by requests that name no site; naming the old site by key still works', async () => {
    expect(await anonymousTitles()).toEqual(['Marketing post']);
    expect(await anonymousTitles('?site=default')).toEqual(['Default post']);
    const unnamed = expectStatus(await network.get('/api/admin/content/post'), 200).json<{
      items: Array<{ data: { title: string } }>;
    }>();
    expect(unnamed.items.map((entry) => entry.data.title)).toEqual(['Marketing post']);
  });

  it('is followed by top-level extension services; services bound to a site stay on it', async () => {
    const bound = servicesForSite(services, { id: ids.marketing, key: 'marketing' });
    const listed = await services.content.list('post');
    expect(listed.items.map((entry) => entry.data.title)).toEqual(['Marketing post']);
    expect(services.site.key).toBe('marketing');
    // A hook on the primary site keeps reading its own site when the primary moves away mid-hook.
    expectStatus(await makePrimary(PRIMARY_SITE_ID), 200);
    expect(bound.site.key).toBe('marketing');
    expect((await bound.content.list('post')).items.map((entry) => entry.data.title)).toEqual([
      'Marketing post',
    ]);
    expect((await services.content.list('post')).items.map((entry) => entry.data.title)).toEqual([
      'Default post',
    ]);
    expect(services.site.key).toBe('default');
    expectStatus(await makePrimary(ids.marketing), 200);
  });

  it('lets the former primary be deleted once empty; the new primary refuses with SITE_IS_PRIMARY', async () => {
    const refused = await as(owner).delete(`/api/admin/sites/${ids.marketing}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'SITE_IS_PRIMARY',
      message: 'The primary site cannot be deleted. Make another site primary first.',
    });
    expectStatus(await as(owner, 'default').delete(`/api/admin/content/post/${ids.defaultPost}`), 204);
    expect(await findPreSitesSite(database.current.db)).toEqual({ id: PRIMARY_SITE_ID, key: 'default' });
    expectStatus(await as(owner).delete(`/api/admin/sites/${PRIMARY_SITE_ID}`), 204);
    expect((await sites()).map((site) => site.key)).toEqual(['marketing']);
    expect(await anonymousTitles()).toEqual(['Marketing post']);
    expect((await services.content.list('post')).items.map((entry) => entry.data.title)).toEqual([
      'Marketing post',
    ]);
    expect(await services.content.count('post')).toBe(1);
  });

  it('activates schema changes without a site once the built-in site is gone', async () => {
    expectStatus(
      await as(owner).post('/api/admin/models', {
        scope: 'network',
        definition: {
          kind: 'collection',
          apiKey: 'note',
          label: 'Note',
          fields: [{ apiKey: 'body', label: 'Body', type: 'string' }],
        },
      }),
      201,
    );
    expectStatus(
      await as(owner).post('/api/admin/models', {
        definition: {
          kind: 'collection',
          apiKey: 'memo',
          label: 'Memo',
          fields: [{ apiKey: 'body', label: 'Body', type: 'string' }],
        },
      }),
      201,
    );
  });

  it('fails work queued before sites existed once the built-in site is gone', async () => {
    expect(await findPreSitesSite(database.current.db)).toBeUndefined();
    const job = {
      id: 'job-1',
      type: 'transfer.import',
      payload: { importId: 'import-1', bundle: { key: 'bundle', driver: 'local' } },
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: null,
      checkpoint: null,
      saveCheckpoint: async () => true,
      signal: new AbortController().signal,
      log: silentLogger,
    } as unknown as JobContext;
    const failure = runImportJob({ db: database.current.db, storage: undefined as never }, job);
    await expect(failure).rejects.toBeInstanceOf(PermanentJobError);
    await expect(failure).rejects.toThrow('queued before sites existed and its site was deleted');
  });

  it('serializes concurrent switches: exactly one primary remains', async () => {
    const created = await Promise.all(
      ['alpha', 'beta'].map(async (key) =>
        expectStatus(await as(owner).post('/api/admin/sites', { key, name: key }), 201).json<SiteBody>(),
      ),
    );
    const results = await Promise.all(created.map((site) => makePrimary(site.id)));
    expect(results.map((response) => response.statusCode)).toEqual([200, 200]);
    const primaries = await primaryKeys();
    expect(primaries).toHaveLength(1);
    expect(['alpha', 'beta']).toContain(primaries[0]);
  });

  it('`shapio sites make-primary --key` moves the flag; an unknown key exits 1', async () => {
    const moved = await cli(['sites', 'make-primary', '--key', 'marketing']);
    expect(moved.stderr).toBe('');
    expect(moved.code).toBe(0);
    expect(moved.stdout).toBe('Site marketing is now the primary site.\n');
    expect(await primaryKeys()).toEqual(['marketing']);
    const listed = await cli(['sites', 'list']);
    expect(listed.stdout.split('\n').filter((line) => line.endsWith('(primary)'))).toEqual([
      'marketing\tMarketing\t(primary)',
    ]);
    const unknown = await cli(['sites', 'make-primary', '--key', 'nowhere']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toBe('No site has the key "nowhere".\n');
  });
});
