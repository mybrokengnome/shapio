import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { bundleKeyFor } from '../src/content/transfer/bundleFile.js';
import { TRANSFER_IMPORT_JOB } from '../src/content/transfer/job.js';
import { createUrlBuilder } from '../src/helpers/publicUrl.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import {
  createRetentionJobHandlers,
  ensureRetentionScheduled,
  RETENTION_JOB,
} from '../src/jobs/retention.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createMediaStorage } from '../src/media/storage.js';
import type { MediaStorage } from '../src/media/types.js';
import { createDefinition, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, testConfig, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';
import { waitFor } from './helpers/waitFor.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/** The daily `system.retention` job: prunes finished bookkeeping older than RETENTION_DAYS, nothing else. */
describe('retention job', () => {
  const database = useTestDatabase();
  let worker: Worker;

  const insertJob = (label: string, status: string, finishedAt: Date | null) =>
    database.current.db
      .insertInto('jobs')
      .values({ type: 'test.noop', status, finished_at: finishedAt, idempotency_key: label })
      .execute();
  const insertEvent = (label: string, dispatchedAt: Date | null) =>
    database.current.db
      .insertInto('outbox_events')
      .values({
        type: 'test.event',
        aggregate_type: 'test',
        aggregate_id: label,
        dispatched_at: dispatchedAt,
      })
      .execute();
  const insertHookRun = (label: string, completedAt: Date) =>
    database.current.db
      .insertInto('extension_hook_runs')
      .values({ event_id: randomUUID(), hook: label, completed_at: completedAt })
      .execute();

  beforeAll(async () => {
    await insertJob('old-succeeded', 'succeeded', daysAgo(31));
    await insertJob('recent-succeeded', 'succeeded', daysAgo(29));
    await insertJob('old-dead', 'dead', daysAgo(90));
    await insertJob('old-pending', 'pending', null);
    await insertEvent('old-dispatched', daysAgo(31));
    await insertEvent('recent-dispatched', daysAgo(1));
    await insertEvent('old-undispatched', null);
    await database.current.db
      .updateTable('outbox_events')
      .set({ created_at: daysAgo(90) })
      .where('aggregate_id', '=', 'old-undispatched')
      .execute();
    await insertHookRun('old-run', daysAgo(31));
    await insertHookRun('recent-run', daysAgo(2));

    worker = createWorker({
      db: database.current.db,
      handlers: createJobHandlers(createRetentionJobHandlers(database.current.db, { days: 30 })),
      workerId: 'retention-test',
      concurrency: 1,
      pollIntervalMs: 20,
      leaseMs: 10_000,
      log: silentLogger,
    });
    const { job } = await ensureRetentionScheduled(database.current.db);
    await waitFor(async () => {
      await worker.tick();
      const row = await database.current.db
        .selectFrom('jobs')
        .select('status')
        .where('id', '=', job.id)
        .executeTakeFirst();
      return row?.status === 'succeeded';
    });
  });

  afterAll(async () => {
    await worker.stop(500);
  });

  it('deletes old succeeded jobs only, keeping dead, pending and recent ones', async () => {
    const keys = await database.current.db
      .selectFrom('jobs')
      .select('idempotency_key')
      .where('type', '=', 'test.noop')
      .orderBy('idempotency_key')
      .execute();
    expect(keys.map((row) => row.idempotency_key)).toEqual(['old-dead', 'old-pending', 'recent-succeeded']);
  });

  it('deletes old dispatched outbox events only, keeping undispatched ones however old', async () => {
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select('aggregate_id')
      .where('type', '=', 'test.event')
      .orderBy('aggregate_id')
      .execute();
    expect(events.map((row) => row.aggregate_id)).toEqual(['old-undispatched', 'recent-dispatched']);
  });

  it('deletes old after-hook run records', async () => {
    const runs = await database.current.db.selectFrom('extension_hook_runs').select('hook').execute();
    expect(runs.map((row) => row.hook)).toEqual(['recent-run']);
  });

  it("schedules tomorrow's run once, and is idempotent per day", async () => {
    const { created } = await ensureRetentionScheduled(database.current.db);
    expect(created).toBe(false);
    const jobs = await database.current.db
      .selectFrom('jobs')
      .select(['status', 'run_at'])
      .where('type', '=', RETENTION_JOB)
      .orderBy('run_at')
      .execute();
    expect(jobs.map((row) => row.status)).toEqual(['succeeded', 'pending']);
    expect(jobs[1]?.run_at.getTime()).toBeGreaterThan(Date.now() + DAY_MS - 60_000);
  });
});

/** Dead imports keep their bundle for the retention period (an operator may retry them), then it goes. */
describe('retention job: bundles of dead imports', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-retention-'));
  let storage: MediaStorage;

  const deadImport = async (importId: string, finishedAt: Date) => {
    const bundle = { driver: storage.active.driver, key: bundleKeyFor(importId) };
    await storage.active.put(bundle.key, Buffer.from('{}\n'), {
      contentType: 'application/x-ndjson',
      contentLength: 3,
    });
    await database.current.db
      .insertInto('jobs')
      .values({
        type: TRANSFER_IMPORT_JOB,
        status: 'dead',
        finished_at: finishedAt,
        payload: JSON.stringify({ importId, bundle }),
      })
      .execute();
    return bundle.key;
  };

  beforeAll(async () => {
    const config = testConfig(database.current, { MEDIA_PATH: mediaPath });
    storage = await createMediaStorage(config.storage, { urls: createUrlBuilder(config.server) });
  });
  afterAll(() => rmSync(mediaPath, { recursive: true, force: true }));

  it('removes the bundles of imports dead for longer than the retention period, keeps the job rows', async () => {
    const old = await deadImport(randomUUID(), daysAgo(31));
    const gone = bundleKeyFor(randomUUID());
    await database.current.db
      .insertInto('jobs')
      .values({
        type: TRANSFER_IMPORT_JOB,
        status: 'dead',
        finished_at: daysAgo(40),
        payload: JSON.stringify({ importId: 'x', bundle: { driver: storage.active.driver, key: gone } }),
      })
      .execute();
    const recent = await deadImport(randomUUID(), daysAgo(2));
    const handlers = new Map(createRetentionJobHandlers(database.current.db, { days: 30, storage }));
    const run = handlers.get(RETENTION_JOB);
    const result = (await run?.({
      id: randomUUID(),
      type: RETENTION_JOB,
      payload: {},
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: null,
      checkpoint: null,
      saveCheckpoint: async () => true,
      signal: new AbortController().signal,
      log: silentLogger,
    })) as { removed: { transferBundles: number } };

    // The already-missing bundle counts too: deleting a missing object succeeds.
    expect(result.removed.transferBundles).toBe(2);
    expect(await storage.active.exists(old)).toBe(false);
    expect(await storage.active.exists(recent)).toBe(true);
    const dead = await database.current.db
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', TRANSFER_IMPORT_JOB)
      .where('status', '=', 'dead')
      .execute();
    expect(dead).toHaveLength(3);
  });
});

/**
 * Expired credentials and finished delivery and run logs: gone once older than the retention period, except
 * what the admin shows as the last state (each webhook's newest delivery, each connection's newest and live run).
 */
describe('retention job: expired credentials, webhook deliveries and deployment runs', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let result: { removed: Record<string, unknown> };
  const ids: Record<string, string> = {};

  const remaining = async (
    table:
      | 'app_refresh_tokens'
      | 'preview_tokens'
      | 'password_resets'
      | 'app_password_resets'
      | 'email_confirmations'
      | 'app_login_codes'
      | 'admin_sessions'
      | 'admin_invitations'
      | 'setup_tokens'
      | 'webhook_deliveries'
      | 'deployment_runs',
  ) => {
    const rows = await database.current.db.selectFrom(table).select('id').execute();
    const names = Object.fromEntries(Object.entries(ids).map(([name, id]) => [id, name]));
    return rows.map((row) => names[row.id] ?? row.id).sort();
  };

  beforeAll(async () => {
    const { db } = database.current;
    testApp = await createTestApp(database.current, { schemaListen: false });
    const admin = schemaClient(testApp.app, await createRoleToken(db));
    const model = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [{ apiKey: 'text', label: 'Text', type: 'string' }],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/note', { data: { text: 'x' } }),
      201,
    ).json<EntryBody>();
    const adminUser = await db
      .insertInto('admin_users')
      .values({ email: 'owner@example.com', password_hash: 'x' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const appUser = await db
      .insertInto('app_users')
      .values({ email: 'reader@example.com', site_id: PRIMARY_SITE_ID })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Every expiring credential: one expired 31 days ago (pruned), one expired 29 days ago (kept).
    for (const [age, expires] of [
      ['old', daysAgo(31)],
      ['recent', daysAgo(29)],
    ] as const) {
      const key = `${age}-${randomUUID()}`;
      const inserted = {
        refresh: await db
          .insertInto('app_refresh_tokens')
          .values({ app_user_id: appUser.id, family_id: randomUUID(), token_hash: key, expires_at: expires })
          .returning('id')
          .executeTakeFirstOrThrow(),
        preview: await db
          .insertInto('preview_tokens')
          .values({
            token_hash: key,
            token_prefix: 'shp_pv',
            model_id: model.definition.id,
            entry_id: entry.id,
            site_id: PRIMARY_SITE_ID,
            created_by: adminUser.id,
            expires_at: expires,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
        reset: await db
          .insertInto('password_resets')
          .values({ admin_user_id: adminUser.id, token_hash: key, expires_at: expires })
          .returning('id')
          .executeTakeFirstOrThrow(),
        appReset: await db
          .insertInto('app_password_resets')
          .values({
            app_user_id: appUser.id,
            email: 'reader@example.com',
            token_hash: key,
            expires_at: expires,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
        confirmation: await db
          .insertInto('email_confirmations')
          .values({
            app_user_id: appUser.id,
            email: 'reader@example.com',
            token_hash: key,
            expires_at: expires,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
        loginCode: await db
          .insertInto('app_login_codes')
          .values({ app_user_id: appUser.id, code_challenge: key, code_hash: key, expires_at: expires })
          .returning('id')
          .executeTakeFirstOrThrow(),
        session: await db
          .insertInto('admin_sessions')
          .values({ admin_user_id: adminUser.id, csrf_secret: key, token_hash: key, expires_at: expires })
          .returning('id')
          .executeTakeFirstOrThrow(),
        invitation: await db
          .insertInto('admin_invitations')
          .values({ email: `${age}@example.com`, token_hash: key, expires_at: expires })
          .returning('id')
          .executeTakeFirstOrThrow(),
      };
      for (const [name, row] of Object.entries(inserted)) {
        ids[`${name}:${age}`] = row.id;
      }
    }

    // Setup tokens: spent before the cutoff (pruned), spent recently and the live one (kept).
    const setupToken = async (name: string, values: { used_at?: Date; superseded_at?: Date }) => {
      ids[name] = (
        await db
          .insertInto('setup_tokens')
          .values({ token_hash: randomUUID(), ...values })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    };
    await setupToken('setup:used-old', { used_at: daysAgo(31) });
    await setupToken('setup:superseded-old', { superseded_at: daysAgo(40) });
    await setupToken('setup:used-recent', { used_at: daysAgo(2) });
    await setupToken('setup:live', {});

    // Webhook deliveries: finished ones older than the cutoff go, except each webhook's newest.
    const webhook = async (name: string) =>
      (
        await db
          .insertInto('webhooks')
          .values({ name, url: 'https://example.com/hook', secret_encrypted: 'x', site_id: PRIMARY_SITE_ID })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const busy = await webhook('busy');
    const quiet = await webhook('quiet');
    const fresh = await webhook('fresh');
    const delivery = async (name: string, webhookId: string, status: string, age: number) => {
      ids[name] = (
        await db
          .insertInto('webhook_deliveries')
          .values({
            webhook_id: webhookId,
            event_type: 'entry.published',
            payload: JSON.stringify({}),
            status,
            created_at: daysAgo(age),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    };
    await delivery('delivery:succeeded-60', busy, 'succeeded', 60);
    await delivery('delivery:dead-50', busy, 'dead', 50);
    await delivery('delivery:retrying-55', busy, 'retrying', 55);
    await delivery('delivery:newest-40', busy, 'succeeded', 40);
    await delivery('delivery:only-dead', quiet, 'dead', 90);
    await delivery('delivery:recent', fresh, 'succeeded', 2);

    // Deployment runs of one connection: the live (highest snapshot) and the newest run stay.
    const connection = await db
      .insertInto('deployment_connections')
      .values({ name: 'site', provider: 'generic_webhook', secrets_encrypted: 'x', site_id: PRIMARY_SITE_ID })
      .returning('id')
      .executeTakeFirstOrThrow();
    const run = async (name: string, status: string, age: number, seq: number | null, finished: boolean) => {
      ids[name] = (
        await db
          .insertInto('deployment_runs')
          .values({
            connection_id: connection.id,
            trigger: 'manual',
            status,
            snapshot_seq: seq === null ? null : String(seq),
            created_at: daysAgo(age + 1),
            finished_at: finished ? daysAgo(age) : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    };
    await run('run:stuck-queued', 'queued', 70, null, false);
    await run('run:live-deployed', 'deployed', 60, 5, true);
    await run('run:failed', 'failed', 50, null, true);
    await run('run:older-snapshot-deployed', 'deployed', 45, 3, true);
    await run('run:newest-failed', 'failed', 40, null, true);

    const handlers = new Map(createRetentionJobHandlers(db, { days: 30 }));
    result = (await handlers.get(RETENTION_JOB)?.({
      id: randomUUID(),
      type: RETENTION_JOB,
      payload: {},
      attempt: 1,
      maxAttempts: 1,
      idempotencyKey: null,
      checkpoint: null,
      saveCheckpoint: async () => true,
      signal: new AbortController().signal,
      log: silentLogger,
    })) as { removed: Record<string, unknown> };
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('deletes credentials that expired before the retention period, keeping recently expired ones', async () => {
    const pairs = [
      ['refresh', 'app_refresh_tokens'],
      ['preview', 'preview_tokens'],
      ['reset', 'password_resets'],
      ['appReset', 'app_password_resets'],
      ['confirmation', 'email_confirmations'],
      ['loginCode', 'app_login_codes'],
      ['session', 'admin_sessions'],
      ['invitation', 'admin_invitations'],
    ] as const;
    for (const [name, table] of pairs) {
      expect(await remaining(table), table).toEqual([`${name}:recent`]);
    }
    expect(result.removed.expiredCredentials).toEqual(
      Object.fromEntries(pairs.map(([, table]) => [table, 1])),
    );
  });

  it('deletes setup tokens spent before the retention period, never the live one', async () => {
    expect(await remaining('setup_tokens')).toEqual(['setup:live', 'setup:used-recent']);
  });

  it("deletes old finished webhook deliveries, keeping pending ones and each webhook's newest", async () => {
    expect(await remaining('webhook_deliveries')).toEqual([
      'delivery:newest-40',
      'delivery:only-dead',
      'delivery:recent',
      'delivery:retrying-55',
    ]);
    expect(result.removed.webhookDeliveries).toBe(2);
  });

  it("deletes old finished deployment runs, keeping unfinished ones and each connection's newest and live run", async () => {
    expect(await remaining('deployment_runs')).toEqual([
      'run:live-deployed',
      'run:newest-failed',
      'run:stuck-queued',
    ]);
    expect(result.removed.deploymentRuns).toBe(2);
  });
});
