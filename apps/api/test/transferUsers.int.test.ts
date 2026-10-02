import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stageBundle, storeBundle } from '../src/content/transfer/bundleFile.js';
import { runImportJob, type ImportProgress } from '../src/content/transfer/job.js';
import type { JobContext } from '../src/jobs/types.js';
import {
  APP_PASSWORD,
  bearer,
  loginAppUser,
  setAuthenticatedGrants,
  setPublicGrants,
  signUp,
} from './helpers/appUsers.js';
import { createDefinition, expectStatus, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

type Instance = { database: TestDatabase; testApp: TestApp; adminToken: string };

const start = async (): Promise<Instance> => {
  const database = await createTestDatabase();
  const testApp = await createTestApp(database, { schemaListen: false });
  return { database, testApp, adminToken: await createRoleToken(database.db) };
};

const stop = async (instance: Instance | undefined) => {
  await instance?.testApp.app.close();
  await instance?.database.drop();
};

const exportBody = async (instance: Instance, query: string) =>
  expectStatus(
    await instance.testApp.app.inject({
      method: 'GET',
      url: `/api/admin/transfer/export?${query}`,
      headers: bearer(instance.adminToken),
    }),
    200,
  ).body;

const importBody = (instance: Instance, body: string, query: string) =>
  instance.testApp.app.inject({
    method: 'POST',
    url: `/api/admin/transfer/import?${query}`,
    headers: { ...bearer(instance.adminToken), 'content-type': 'application/x-ndjson' },
    payload: body,
  });

/** Runs the import job in-process with a controllable checkpoint (what a worker would do). */
const runJob = async (instance: Instance, payload: unknown, checkpoint: unknown = null) => {
  let saved: unknown = checkpoint;
  const context: JobContext = {
    id: randomUUID(),
    type: 'transfer.import',
    payload,
    attempt: 1,
    maxAttempts: 1,
    idempotencyKey: null,
    checkpoint,
    saveCheckpoint: async (value) => {
      saved = value;
      return true;
    },
    signal: new AbortController().signal,
    log: silentLogger,
  };
  const result = (await runImportJob(
    { db: instance.database.db, storage: instance.testApp.app.mediaStorage },
    context,
  )) as ImportProgress;
  return { result, saved };
};

describe('content export and import of app users, roles and owners', () => {
  let source: Instance | undefined;
  let target: Instance | undefined;
  let note: ModelBody;
  let withUsers: string;
  let withoutUsers: string;
  let userEmail: string;
  let ownedId: string;
  let workdir: string;

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-transfer-users-'));
    source = await start();
    const admin = schemaClient(source.testApp.app, source.adminToken);
    note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      draftAndPublish: false,
      fields: [{ apiKey: 'text', label: 'Text', type: 'string', required: true }],
    });
    const modelId = note.definition.id;
    await setPublicGrants(source.database.db, [{ action: 'read', modelId }]);
    await setAuthenticatedGrants(source.database.db, [
      { action: 'read', modelId },
      { action: 'create', modelId },
      { action: 'update', modelId, condition: 'ownedByPrincipal' },
    ]);
    userEmail = `owner-${randomUUID()}@example.com`;
    const session = await signUp(source.testApp.app, { email: userEmail });
    const created = await source.testApp.app.inject({
      method: 'POST',
      url: '/api/content/notes',
      headers: bearer(session.accessToken),
      payload: { data: { text: 'mine' } },
    });
    ownedId = expectStatus(created, 201).json<{ data: { id: string } }>().data.id;
    withUsers = await exportBody(source, 'includeUsers=true&headsOnly=true');
    withoutUsers = await exportBody(source, '');
    await stop(source);
    source = undefined;
    target = await start();
  });

  afterAll(async () => {
    await stop(source);
    await stop(target);
    await rm(workdir, { recursive: true, force: true });
  });

  it('never exports password hashes or users unless asked, and only hashes when asked', () => {
    expect(withoutUsers).not.toContain('$argon2');
    expect(withoutUsers).not.toContain(userEmail);
    expect(withUsers).toContain(userEmail);
    expect(withUsers).toContain('$argon2id$');
    expect(withUsers).not.toContain(APP_PASSWORD);
  });

  it('restores accounts with their password, role grants and entry owners', async () => {
    const instance = target as Instance;
    const planned = expectStatus(await importBody(instance, withUsers, 'dryRun=true'), 200).json<{
      diff: { appUsers: { added: number }; appRoles: { updated: string[] }; conflicts: number };
    }>();
    expect(planned.diff).toMatchObject({ conflicts: 0, appUsers: { added: 1 } });
    expect(planned.diff.appRoles.updated.sort()).toEqual(['authenticated', 'public']);

    const started = expectStatus(await importBody(instance, withUsers, ''), 202).json<{ importId: string }>();
    const job = await instance.database.db
      .selectFrom('jobs')
      .select('payload')
      .where('id', '=', started.importId)
      .executeTakeFirstOrThrow();
    const { result } = await runJob(instance, job.payload);
    expect(result).toMatchObject({ errorCount: 0, counts: { users: { added: 1 }, entries: { added: 1 } } });

    const login = expectStatus(await loginAppUser(instance.testApp.app, userEmail), 200).json<{
      accessToken: string;
    }>();
    // The owner-only grant still recognises the owner after the move.
    const update = await instance.testApp.app.inject({
      method: 'PUT',
      url: `/api/content/notes/${ownedId}`,
      headers: bearer(login.accessToken),
      payload: { expectedVersion: 1, data: { text: 'still mine' } },
    });
    expect(update.statusCode, update.body).toBe(200);
    // The public role's grant came along: anonymous delivery reads it.
    const anonymous = expectStatus(
      await instance.testApp.app.inject({ method: 'GET', url: `/api/content/notes/${ownedId}` }),
      200,
    ).json<{ data: { text: string } }>();
    expect(anonymous.data.text).toBe('still mine');
  });

  it('resumes from its checkpoint: lines a phase already finished are skipped', async () => {
    const instance = target as Instance;
    const path = join(workdir, 'bundle.ndjson');
    await writeFile(path, withUsers);
    const staged = await stageBundle(Readable.from([await readFile(path)]));
    const importId = randomUUID();
    const bundle = await storeBundle(instance.testApp.app.mediaStorage, staged, importId);
    await staged.remove();
    const entryLine = withUsers.split('\n').findIndex((line) => line.startsWith('{"type":"entry"')) + 1;
    const checkpoint: ImportProgress = {
      phase: 'content',
      line: entryLine,
      counts: {
        users: { added: 0, unchanged: 0 },
        media: { added: 0, unchanged: 0 },
        entries: { added: 0, updated: 0, unchanged: 0 },
        pruned: 0,
      },
      errors: [],
      errorCount: 0,
    };
    const { result } = await runJob(
      instance,
      { importId, bundle, prune: false, pendingChangeIds: [] },
      checkpoint,
    );
    // The only entry was on the checkpointed line: nothing left to do, and the stored bundle is cleaned up.
    expect(result.counts.entries).toEqual({ added: 0, updated: 0, unchanged: 0 });
    expect(await instance.testApp.app.mediaStorage.active.exists(bundle.key)).toBe(false);
  });
});
