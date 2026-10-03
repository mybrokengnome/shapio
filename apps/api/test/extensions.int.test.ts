import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AFTER_HOOK_JOB, EXTENSION_HOOK_EVENT } from '../src/constants/extensions.js';
import { ExtensionConfigError, loadProjectConfig } from '../src/extensions/loader.js';
import { loadExtensionRuntime, type ExtensionRuntime } from '../src/extensions/runtime.js';
import type { Worker } from '../src/jobs/worker.js';
import { createConfiguredWorker } from '../src/server.js';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, testConfig, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import {
  createHookLog,
  drainWorker,
  FIXTURE_CONFIG,
  hooksOf as hooksOfEntry,
  REPO_ROOT,
} from './helpers/extensions.js';
import { dataOf, errorCodes, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { spawnTsProcess } from './helpers/spawnProcess.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type LogRow = {
  hook: string;
  entry_id: string;
  locale: string | null;
  principal: string;
  data: Record<string, unknown> | null;
  before: Record<string, unknown> | null;
  event_id: string | null;
};

/** Package K: lifecycle hooks, custom routes, services and jobs from shapio.config (ADR 0009). */
describe('extension points', () => {
  const database = useTestDatabase();
  let runtime: ExtensionRuntime;
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let worker: Worker;

  const log = (entryId: string) =>
    sql<LogRow>`select * from ext_hook_log where entry_id = ${entryId} order by id`
      .execute(database.current.db)
      .then((result) => result.rows);

  const drain = () => drainWorker(worker, database.current.db);
  const hooksOf = (entryId: string) => hooksOfEntry(database.current.db, entryId);

  const createArticle = (title: string) => admin.post('/api/admin/content/article', { data: { title } });

  beforeAll(async () => {
    const { db } = database.current;
    await createHookLog(db);
    const config = testConfig(database.current, { SHAPIO_CONFIG_PATH: FIXTURE_CONFIG });
    runtime = await loadExtensionRuntime({ db, config, logger: silentLogger });
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      extensions: runtime,
      env: GRAPHQL_ENV,
    });
    adminToken = await createRoleToken(db);
    admin = schemaClient(testApp.app, adminToken);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    // The production worker assembly (the same one `shapio start` and `shapio worker` run).
    worker = createConfiguredWorker(config, db, silentLogger, testApp.app.signingSecret, runtime);
  });

  afterAll(async () => {
    await worker.stop(500);
    await testApp.app.close();
    runtime.close();
  });

  describe('before* hooks', () => {
    it('run inside the owning transaction, with API-keyed data and the principal', async () => {
      const entry = expectStatus(await createArticle('Hello'), 201).json<EntryBody>();
      const [row] = await log(entry.id);
      expect(row).toMatchObject({
        hook: 'article.beforeCreate',
        principal: 'token',
        data: { title: 'Hello' },
        event_id: null,
      });
    });

    it('abort the write with 422 HOOK_REJECTED and leave no partial state', async () => {
      const { db } = database.current;
      const counts = async () => ({
        entries: (await db.selectFrom('entries').select('id').execute()).length,
        revisions: (await db.selectFrom('content_revisions').select('id').execute()).length,
        outbox: (await db.selectFrom('outbox_events').select('id').execute()).length,
        hookRows: (await sql`select id from ext_hook_log`.execute(db)).rows.length,
      });
      const before = await counts();
      const response = await createArticle('reject me');
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        error: {
          code: 'HOOK_REJECTED',
          message: 'article.beforeCreate refused "reject me"',
          details: { hook: 'article.beforeCreate', title: 'reject me' },
        },
      });
      // The hook's own insert rolled back with the entry, its revision and its outbox event.
      expect(await counts()).toEqual(before);
    });

    it('reject an update without changing the draft, and see the previous data as `before`', async () => {
      const entry = expectStatus(await createArticle('Original'), 201).json<EntryBody>();
      const rejected = await admin.put(`/api/admin/content/article/${entry.id}`, {
        expectedVersion: entry.version,
        data: { title: 'reject this edit' },
      });
      expect(rejected.statusCode).toBe(422);
      const current = expectStatus(
        await admin.get(`/api/admin/content/article/${entry.id}`),
        200,
      ).json<EntryBody>();
      expect(current).toMatchObject({ version: entry.version, data: { title: 'Original' } });
      expectStatus(
        await admin.put(`/api/admin/content/article/${entry.id}`, {
          expectedVersion: entry.version,
          data: { title: 'Edited' },
        }),
        200,
      );
      const updates = (await log(entry.id)).filter((row) => row.hook === 'article.beforeUpdate');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ data: { title: 'Edited' }, before: { title: 'Original' } });
    });
  });

  describe('GraphQL mutations', () => {
    const CREATE = 'mutation ($data: ArticleInput) { createArticle(data: $data) { id } }';
    const auth = () => ({ headers: { authorization: `Bearer ${adminToken}` } });

    it('go through the same hooks, and a rejection carries HOOK_REJECTED', async () => {
      const created = dataOf<{ createArticle: { id: string } }>(
        await graphql(testApp.app, CREATE, { variables: { data: { title: 'Via GraphQL' } }, ...auth() }),
      );
      expect(await log(created.createArticle.id)).toMatchObject([
        { hook: 'article.beforeCreate', principal: 'token', data: { title: 'Via GraphQL' } },
      ]);
      const rejected = await graphql(testApp.app, CREATE, {
        variables: { data: { title: 'reject via GraphQL' } },
        ...auth(),
      });
      expect(errorCodes(rejected)).toEqual(['HOOK_REJECTED']);
      expect(rejected.body.errors?.[0]?.extensions?.details).toEqual({
        hook: 'article.beforeCreate',
        title: 'reject via GraphQL',
      });
    });
  });

  describe('after* hooks', () => {
    it('run after commit, as one job per hook, exactly once per event', async () => {
      const entry = expectStatus(await createArticle('After'), 201).json<EntryBody>();
      // Nothing ran yet: only the outbox event exists.
      expect(await hooksOf(entry.id)).toEqual(['article.beforeCreate']);
      const events = await database.current.db
        .selectFrom('outbox_events')
        .select(['event_id'])
        .where('type', '=', EXTENSION_HOOK_EVENT)
        .where('aggregate_id', '=', entry.id)
        .execute();
      expect(events).toHaveLength(1);

      await drain();
      const rows = await log(entry.id);
      expect(rows.map((row) => row.hook)).toEqual(['article.beforeCreate', 'article.afterCreate']);
      expect(rows[1]).toMatchObject({ data: { title: 'After' }, event_id: events[0]?.event_id });

      // Running the same (event, hook) again — a retry, a crash recovery — does nothing.
      const job = await database.current.db
        .selectFrom('jobs')
        .selectAll()
        .where('type', '=', AFTER_HOOK_JOB)
        .where('idempotency_key', '=', `${AFTER_HOOK_JOB}:${events[0]?.event_id}:article.afterCreate`)
        .executeTakeFirstOrThrow();
      expect(job).toMatchObject({ status: 'succeeded', result: { ran: 'article.afterCreate' } });
      await database.current.db
        .updateTable('jobs')
        .set({ status: 'pending', run_at: new Date(), attempts: 0 })
        .where('id', '=', job.id)
        .execute();
      await drain();
      expect(await hooksOf(entry.id)).toEqual(['article.beforeCreate', 'article.afterCreate']);
      expect(
        await database.current.db
          .selectFrom('jobs')
          .select('result')
          .where('id', '=', job.id)
          .executeTakeFirst(),
      ).toEqual({ result: { skipped: 'already ran' } });
    });

    it('`*` hooks run for every model; deletes fire beforeDelete and afterDelete', async () => {
      const entry = expectStatus(await createArticle('To delete'), 201).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/article/${entry.id}`, {
          expectedVersion: entry.version,
          data: { title: 'Renamed' },
        }),
        200,
      );
      expectStatus(await admin.delete(`/api/admin/content/article/${entry.id}`), 204);
      await drain();
      const hooks = await hooksOf(entry.id);
      // before* hooks ran in request order; after* jobs run concurrently after commit, in any order.
      expect(hooks.slice(0, 3)).toEqual([
        'article.beforeCreate',
        'article.beforeUpdate',
        'article.beforeDelete',
      ]);
      expect(hooks.slice(3).sort()).toEqual(['*.afterUpdate', 'article.afterCreate', 'article.afterDelete']);
    });
  });

  describe('publishing paths', () => {
    it('fire publish hooks for a REST publish', async () => {
      const entry = expectStatus(await createArticle('Live'), 201).json<EntryBody>();
      expectStatus(await admin.post(`/api/admin/content/article/${entry.id}/publish`, {}), 200);
      await drain();
      const rows = (await log(entry.id)).filter((row) => row.hook.endsWith('Publish'));
      expect(rows.map((row) => [row.hook, row.principal])).toEqual([
        ['article.beforePublish', 'token'],
        ['article.afterPublish', 'token'],
      ]);
    });

    it('reject a publish without publishing anything', async () => {
      const entry = expectStatus(await createArticle('unpublishable'), 201).json<EntryBody>();
      const response = await admin.post(`/api/admin/content/article/${entry.id}/publish`, {});
      expect(response.statusCode).toBe(422);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('HOOK_REJECTED');
      const published = await database.current.db
        .selectFrom('entry_heads')
        .select('state')
        .where('entry_id', '=', entry.id)
        .where('state', '=', 'published')
        .execute();
      expect(published).toEqual([]);
    });

    it('fire for scheduled publishes run by the worker', async () => {
      const entry = expectStatus(await createArticle('Scheduled'), 201).json<EntryBody>();
      expectStatus(
        await admin.post('/api/admin/publishing/schedules', {
          modelKey: 'article',
          entryId: entry.id,
          action: 'publish',
          runAt: new Date(Date.now() + 1000).toISOString(),
        }),
        201,
      );
      await waitFor(
        async () => {
          await drain();
          return (await hooksOf(entry.id)).includes('article.afterPublish');
        },
        { timeoutMs: 15_000 },
      );
      expect((await hooksOf(entry.id)).filter((hook) => hook.endsWith('Publish'))).toEqual([
        'article.beforePublish',
        'article.afterPublish',
      ]);
    });

    it('fire for change set publishes', async () => {
      const entry = expectStatus(await createArticle('Released'), 201).json<EntryBody>();
      const set = expectStatus(await admin.post('/api/admin/change-sets', { title: 'R1' }), 201).json<{
        id: string;
      }>();
      const added = expectStatus(
        await admin.post(`/api/admin/change-sets/${set.id}/items`, {
          modelKey: 'article',
          entryId: entry.id,
          action: 'publish',
        }),
        200,
      ).json<{ version: number }>();
      expectStatus(
        await admin.post(`/api/admin/change-sets/${set.id}/ship`, { expectedVersion: added.version }),
        200,
      );
      await drain();
      expect((await hooksOf(entry.id)).filter((hook) => hook.endsWith('Publish'))).toEqual([
        'article.beforePublish',
        'article.afterPublish',
      ]);
    });
  });

  describe('custom routes, services and jobs', () => {
    it('serve under /api/ext/<prefix> with the custom services', async () => {
      const response = await testApp.app.inject({ method: 'GET', url: '/api/ext/probe/ping' });
      expect(response.statusCode).toBe(200);
      expect(response.json<{ ok: boolean; articles: number }>()).toMatchObject({ ok: true });
    });

    it('are audited, need the admin check they declare, and enforce CSRF for cookie sessions', async () => {
      const { db } = database.current;
      expect((await testApp.app.inject({ method: 'POST', url: '/api/ext/probe/things' })).statusCode).toBe(
        401,
      );
      expectStatus(await admin.post('/api/ext/probe/things', {}), 201);
      const audit = await db
        .selectFrom('audit_events')
        .selectAll()
        .where('action', '=', 'probe.thing.create')
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: 'token', outcome: 'success' });

      const session = await login(testApp.app, await createAdmin(db));
      const withoutCsrf = await testApp.app.inject({
        method: 'POST',
        url: '/api/ext/probe/things',
        headers: { cookie: session.headers.cookie ?? '' },
      });
      expect(withoutCsrf.statusCode).toBe(403);
      expect(withoutCsrf.json<{ error: { code: string } }>().error.code).toBe('CSRF_INVALID');
      expectStatus(
        await testApp.app.inject({ method: 'POST', url: '/api/ext/probe/things', headers: session.headers }),
        201,
      );
    });

    it('use the central error handler', async () => {
      const response = await testApp.app.inject({ method: 'GET', url: '/api/ext/probe/fail' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    });

    it('are rate-limited like core routes', async () => {
      const limited = await createTestApp(database.current, {
        schemaListen: false,
        env: { RATE_LIMIT_MAX: '3', SHAPIO_CONFIG_PATH: FIXTURE_CONFIG },
      });
      try {
        const statuses = [];
        for (let index = 0; index < 4; index += 1) {
          statuses.push((await limited.app.inject({ method: 'GET', url: '/api/ext/probe/ping' })).statusCode);
        }
        expect(statuses).toEqual([200, 200, 200, 429]);
      } finally {
        await limited.app.close();
      }
    });

    it('run project jobs as ext.<name>, enqueued through the jobs service', async () => {
      const { id } = await runtime.services.jobs.enqueue('echo', { hello: 'world' });
      await drain();
      expect(
        await database.current.db
          .selectFrom('jobs')
          .select(['type', 'status', 'result'])
          .where('id', '=', id)
          .executeTakeFirst(),
      ).toEqual({ type: 'ext.echo', status: 'succeeded', result: { echoed: { hello: 'world' } } });
      await expect(runtime.services.jobs.enqueue('missing')).rejects.toThrow('No job "missing"');
    });
  });

  describe('config loading', () => {
    let broken: string;

    beforeAll(() => {
      broken = mkdtempSync(join(tmpdir(), 'shapio-broken-config-'));
      writeFileSync(
        join(broken, 'shapio.config.ts'),
        "export const config = { extensions: [], routes: [{ prefix: 'Bad Prefix', plugin: async () => {} }] };\n",
      );
    });
    afterAll(() => rmSync(broken, { recursive: true, force: true }));

    it('fails app startup with the file and every problem', async () => {
      const startup = createTestApp(database.current, { projectDir: broken });
      await expect(startup).rejects.toBeInstanceOf(ExtensionConfigError);
      await expect(startup).rejects.toThrow(join(broken, 'shapio.config.ts'));
      await expect(startup).rejects.toThrow(
        '/extensions: unknown setting "extensions"; allowed: hooks, routes, services, editors, jobs',
      );
      await expect(startup).rejects.toThrow('/routes/0/prefix: must be lower-case letters');
    });

    it('fails the real server process fast, before it listens', async () => {
      const server = spawnTsProcess('src/main.ts', {
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '0',
        LOG_LEVEL: 'info',
        DATABASE_URL: database.current.url,
        SHAPIO_CONFIG_PATH: join(broken, 'shapio.config.ts'),
      });
      try {
        const fatal = await server.waitForLog((line) => line.msg === 'startup failed', {
          description: "'startup failed'",
        });
        expect(JSON.stringify(fatal)).toContain(join(broken, 'shapio.config.ts'));
        expect(JSON.stringify(fatal)).toContain('unknown setting');
      } finally {
        await server.stop();
      }
    });

    const runCheck = (configPath: string) =>
      spawnSync(
        process.execPath,
        ['--conditions=@shapio/source', '--import', 'tsx', 'src/cli.ts', 'extensions', 'check'],
        {
          cwd: API_ROOT,
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', SHAPIO_CONFIG_PATH: configPath },
          encoding: 'utf8',
        },
      );

    it('`shapio extensions check` passes on the example and fails on a broken config', () => {
      const example = runCheck(resolve(REPO_ROOT, 'examples/extension/shapio.config.ts'));
      expect(example.status).toBe(0);
      expect(example.stdout).toContain('article.beforePublish (in the transaction)');
      expect(example.stdout).toContain('/api/ext/example');
      expect(example.stdout).toContain('ext.statsReport');

      const failed = runCheck(join(broken, 'shapio.config.ts'));
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain('unknown setting "extensions"');
    });

    it('loads a fresh create-shapio scaffold, which has no extensions, and serves with it', async () => {
      const parent = mkdtempSync(join(tmpdir(), 'shapio-scaffold-'));
      try {
        const scaffold = spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            resolve(REPO_ROOT, 'packages/create-shapio/src/index.ts'),
            join(parent, 'my-cms'),
            '--no-install',
          ],
          { cwd: API_ROOT, encoding: 'utf8' },
        );
        expect(scaffold.status, scaffold.stderr).toBe(0);
        const projectDir = join(parent, 'my-cms');
        const loaded = await loadProjectConfig({ searchDir: projectDir });
        expect(loaded.file).toBe(join(projectDir, 'shapio.config.ts'));
        expect(loaded.config).toEqual({ hooks: {}, editors: [] });
        const scaffolded = await createTestApp(database.current, { schemaListen: false, projectDir });
        expect((await scaffolded.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
        await scaffolded.app.close();
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    });
  });
});
