import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDeliveryToken, type EntryBody, type ModelBody } from './helpers/content.js';
import { createRoleToken } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

type HttpResult = { status: number; body: unknown };
type SchemaSummary = {
  schemaVersion: number;
  definitions: Array<{ id: string; version: number; hash: string }>;
};
type RevisionList = { items: Array<{ id: string } & Record<string, unknown>> };

/**
 * How far ahead the scheduled publish is queued: far enough that it can never run on the first process, however
 * slow the machine. The test makes it due on the second process by moving its run time (see below).
 */
const SCHEDULE_DELAY_MS = 60 * 60_000;

/**
 * Brief §10 "Restart/recovery preserves schemas, revisions, content, and queued jobs": a real server process
 * builds up state, is stopped with SIGTERM, and a new process on the same database serves all of it and runs
 * the job that was queued for the future.
 */
describe('restart and recovery', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-restart-media-'));
  const servers: SpawnedServer[] = [];

  const start = async () => {
    const server = await spawnServer({
      DATABASE_URL: database.current.url,
      MIGRATE_ON_START: 'false',
      RATE_LIMIT_MAX: '100000',
      MEDIA_PATH: mediaPath,
    });
    servers.push(server);
    return server;
  };

  const http = async (
    server: SpawnedServer,
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResult> => {
    const response = await fetch(`${server.url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
  };

  const expectOk = <T>(result: HttpResult, status = 200): T => {
    if (result.status !== status) {
      throw new Error(`Expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
    }
    return result.body as T;
  };

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop('SIGKILL')));
    rmSync(mediaPath, { recursive: true, force: true });
  });

  it('a new process serves the same schemas, revisions, drafts and published content, and runs queued jobs', async () => {
    const first = await start();
    const adminToken = await createRoleToken(database.current.db);
    const admin = (method: string, path: string, body?: unknown) =>
      http(first, adminToken, method, path, body);

    // Two schema versions of one model.
    const created = expectOk<{ definitionId: string }>(
      await admin('POST', '/api/admin/models', {
        definition: {
          kind: 'collection',
          apiKey: 'article',
          label: 'Article',
          fields: [{ apiKey: 'title', label: 'Title', type: 'string', required: true }],
        },
      }),
      201,
    );
    const v1 = expectOk<ModelBody>(await admin('GET', `/api/admin/models/${created.definitionId}`));
    expectOk(
      await admin('PUT', `/api/admin/models/${created.definitionId}`, {
        definition: {
          ...v1.definition,
          fields: [...v1.definition.fields, { apiKey: 'summary', label: 'Summary', type: 'text' }],
        },
        expectedVersion: v1.version,
      }),
    );
    const model = expectOk<ModelBody>(await admin('GET', `/api/admin/models/${created.definitionId}`));
    expect(model.version).toBe(2);
    const deliveryToken = await createDeliveryToken(database.current.db, [{ modelId: model.definition.id }]);

    // An entry with several revisions: published at its second save, then a newer draft.
    const entry = expectOk<EntryBody>(
      await admin('POST', '/api/admin/content/article', { data: { title: 'First' } }),
      201,
    );
    const second = expectOk<EntryBody>(
      await admin('PUT', `/api/admin/content/article/${entry.id}`, {
        expectedVersion: entry.version,
        data: { title: 'Second', summary: 'Published summary' },
      }),
    );
    expectOk(await admin('POST', `/api/admin/content/article/${entry.id}/publish`, {}));
    expectOk(
      await admin('PUT', `/api/admin/content/article/${entry.id}`, {
        expectedVersion: second.version,
        data: { title: 'Third (draft)', summary: 'Draft summary' },
      }),
    );

    // A job queued for the future: a scheduled publish of another entry.
    const later = expectOk<EntryBody>(
      await admin('POST', '/api/admin/content/article', { data: { title: 'Scheduled' } }),
      201,
    );
    const schedule = expectOk<{ id: string; runAt: string }>(
      await admin('POST', '/api/admin/publishing/schedules', {
        modelKey: 'article',
        entryId: later.id,
        action: 'publish',
        runAt: new Date(Date.now() + SCHEDULE_DELAY_MS).toISOString(),
      }),
      201,
    );

    const schemaBefore = expectOk<SchemaSummary>(await admin('GET', '/api/admin/schema'));
    const modelRevisionsBefore = expectOk<RevisionList>(
      await admin('GET', `/api/admin/models/${model.definition.id}/revisions`),
    );
    const entryRevisionsBefore = expectOk<RevisionList>(
      await admin('GET', `/api/admin/content/article/${entry.id}/revisions`),
    );
    const draftBefore = expectOk<EntryBody>(await admin('GET', `/api/admin/content/article/${entry.id}`));
    expect(entryRevisionsBefore.items).toHaveLength(3);
    expect(modelRevisionsBefore.items).toHaveLength(2);

    expect(await first.stop('SIGTERM'), 'exit code of the first process after SIGTERM').toBe(0);
    expect(first.logs.map((line) => line.msg)).toContain('shutdown complete');

    // While no process runs, the queued job is still there, untouched.
    const scheduleRow = await database.current.db
      .selectFrom('scheduled_publications')
      .selectAll()
      .where('id', '=', schedule.id)
      .executeTakeFirstOrThrow();
    expect(scheduleRow.status).toBe('scheduled');
    const jobId = scheduleRow.job_id ?? '';
    const jobBefore = await database.current.db
      .selectFrom('jobs')
      .selectAll()
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
    expect(jobBefore).toMatchObject({ status: 'pending', attempts: 0 });
    expect(jobBefore.run_at.getTime()).toBe(new Date(schedule.runAt).getTime());

    const restarted = await start();
    expect(restarted.pid).not.toBe(first.pid);
    const adminAfter = (method: string, path: string) => http(restarted, adminToken, method, path);

    expect(expectOk<SchemaSummary>(await adminAfter('GET', '/api/admin/schema'))).toEqual(schemaBefore);
    expect(expectOk<ModelBody>(await adminAfter('GET', `/api/admin/models/${model.definition.id}`))).toEqual(
      model,
    );
    expect(
      expectOk<RevisionList>(await adminAfter('GET', `/api/admin/models/${model.definition.id}/revisions`)),
    ).toEqual(modelRevisionsBefore);
    expect(
      expectOk<RevisionList>(await adminAfter('GET', `/api/admin/content/article/${entry.id}/revisions`)),
    ).toEqual(entryRevisionsBefore);
    expect(expectOk<EntryBody>(await adminAfter('GET', `/api/admin/content/article/${entry.id}`))).toEqual(
      draftBefore,
    );
    expect(draftBefore.data).toEqual({ title: 'Third (draft)', summary: 'Draft summary' });

    const delivered = expectOk<{ data: Record<string, unknown> }>(
      await http(restarted, deliveryToken, 'GET', `/api/content/articles/${entry.id}`),
    );
    expect(delivered.data).toMatchObject({ title: 'Second', summary: 'Published summary' });
    const graphqlResponse = await fetch(`${restarted.url}/api/graphql`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deliveryToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: `{ article(id: "${entry.id}") { title summary } }` }),
    });
    expect(await graphqlResponse.json()).toEqual({
      data: { article: { title: 'Second', summary: 'Published summary' } },
    });

    // The job queued before the restart keeps its ID and runs on the new process when it is due.
    expect((await http(restarted, deliveryToken, 'GET', `/api/content/articles/${later.id}`)).status).toBe(
      404,
    );
    // Its time comes: the new process's worker picks it up from the queue (a moved clock, not a sleep).
    await database.current.db
      .updateTable('jobs')
      .set({ run_at: new Date() })
      .where('id', '=', jobId)
      .execute();
    const job = await waitFor(
      async () => {
        const row = await database.current.db
          .selectFrom('jobs')
          .selectAll()
          .where('id', '=', jobId)
          .executeTakeFirstOrThrow();
        // Terminal state only: a dead job fails the assertion below instead of timing out here.
        return row.status === 'succeeded' || row.status === 'dead' ? row : undefined;
      },
      {
        timeoutMs: 30_000,
        intervalMs: 100,
        description: `the queued scheduled-publish job ${jobId} to finish on the restarted process`,
      },
    );
    expect(job).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(
      expectOk<{ data: Record<string, unknown> }>(
        await http(restarted, deliveryToken, 'GET', `/api/content/articles/${later.id}`),
      ).data,
    ).toMatchObject({ title: 'Scheduled' });
    const done = await database.current.db
      .selectFrom('scheduled_publications')
      .select(['status', 'job_id'])
      .where('id', '=', schedule.id)
      .executeTakeFirstOrThrow();
    expect(done).toEqual({ status: 'done', job_id: jobId });

    expect(await restarted.stop('SIGTERM'), 'exit code of the restarted process after SIGTERM').toBe(0);
  }, 120_000);
});
