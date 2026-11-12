import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliIo } from '@shapio/cli';
import { REMOTE_COMMANDS } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContentPorts } from '../src/content/ports.js';
import { createTransferJobHandlers } from '../src/content/transfer/job.js';
import { createJobHandlers } from '../src/jobs/handlers/index.js';
import { createWorker, type Worker } from '../src/jobs/worker.js';
import { createSchemaJobHandlers } from '../src/schema/planner/changeJob.js';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient } from './helpers/schemaAdmin.js';
import { silentLogger } from './helpers/silentLogger.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

type Instance = {
  database: TestDatabase;
  testApp: TestApp;
  url: string;
  adminToken: string;
  mediaPath: string;
};
type Card = { id: string; heading: string; count: unknown };

const startInstance = async (database: TestDatabase): Promise<Instance> => {
  const mediaPath = await mkdtemp(join(tmpdir(), 'shapio-transfer-conversion-media-'));
  const testApp = await createTestApp(database, { schemaListen: false, env: { MEDIA_PATH: mediaPath } });
  await testApp.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = testApp.app.server.address() as AddressInfo;
  return {
    database,
    testApp,
    url: `http://127.0.0.1:${port}`,
    adminToken: await createRoleToken(database.db),
    mediaPath,
  };
};

const stopInstance = async (instance: Instance | undefined) => {
  await instance?.testApp.app.close();
  await instance?.database.drop();
  if (instance) {
    await rm(instance.mediaPath, { recursive: true, force: true });
  }
};

const runCli = async (name: 'export' | 'import', args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: {} };
  const command = REMOTE_COMMANDS[name];
  if (!command) {
    throw new Error(`No ${name} command`);
  }
  const code = await command.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

const startWorker = (instance: Instance): Worker => {
  const { db } = instance.database;
  const worker = createWorker({
    db,
    handlers: createJobHandlers([
      ...createTransferJobHandlers({ db, storage: instance.testApp.app.mediaStorage }),
      ...createSchemaJobHandlers({ db, ports: createContentPorts(db) }),
    ]),
    workerId: `test-${randomUUID()}`,
    concurrency: 2,
    pollIntervalMs: 50,
    leaseMs: 30_000,
    log: silentLogger,
  });
  worker.start();
  return worker;
};

/** What an entry holds that a transfer must keep: its revisions (in order, by reason) and its items. */
const stateOf = async (instance: Instance, entryId: string) => {
  const admin = schemaClient(instance.testApp.app, instance.adminToken);
  const entry = expectStatus(await admin.get(`/api/admin/content/page/${entryId}`), 200).json<EntryBody>();
  const revisions = await instance.database.db
    .selectFrom('content_revisions')
    .select(['id', 'reason'])
    .where('entry_id', '=', entryId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return {
    cards: (entry.data as { cards: Card[] }).cards,
    revisions: revisions.map((revision) => [revision.id, revision.reason]),
  };
};

/**
 * A schema conversion writes revisions with the reason `conversion` and persists the IDs of the items it
 * rewrites (plan item-ids): a bundle exported after one imports again, into the same instance and a new one,
 * with its history, reasons, item IDs and values.
 */
describe('transfer after a schema conversion', () => {
  let workdir: string;
  let bundle: string;
  let source: Instance | undefined;
  let target: Instance | undefined;
  let worker: Worker | undefined;
  let entryId: string;
  let exported: Awaited<ReturnType<typeof stateOf>>;

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-transfer-conversion-'));
    bundle = join(workdir, 'content.ndjson');
    source = await startInstance(await createTestDatabase());
    const admin = schemaClient(source.testApp.app, source.adminToken);
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'card',
        label: 'Card',
        fields: [
          { apiKey: 'heading', label: 'Heading', type: 'string' },
          { apiKey: 'count', label: 'Count', type: 'integer' },
        ],
      },
      'components',
    );
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'cards',
          label: 'Cards',
          type: 'component',
          settings: { component: card.definition.id, repeatable: true },
        },
      ],
    });
    const created = expectStatus(
      await admin.post('/api/admin/content/page', {
        data: {
          title: 'Home',
          cards: [
            { heading: 'A', count: 1 },
            { heading: 'B', count: 2 },
          ],
        },
      }),
      201,
    ).json<EntryBody>();
    entryId = created.id;
    expectStatus(await admin.post(`/api/admin/content/page/${entryId}/publish`, {}), 200);
    // The conversion: count from integer to text, which rewrites every item (a `conversion` revision).
    const current = (await admin.get(`/api/admin/components/${card.definition.id}`)).json<ModelBody>();
    const changed = await admin.put(`/api/admin/components/${card.definition.id}`, {
      definition: {
        ...current.definition,
        fields: current.definition.fields.map(({ editor, ...field }) =>
          field.apiKey === 'count' ? { ...field, type: 'string', settings: {} } : { ...field, editor },
        ),
      },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], changed.body).toContain(changed.statusCode);
    await runContentSchemaJobs(source.database.db);
    exported = await stateOf(source, entryId);
    expect(exported.revisions.map(([, reason]) => reason)).toContain('conversion');
    expect(exported.cards.map((item) => item.count)).toEqual(['1', '2']);
    const result = await runCli('export', ['--url', source.url, '--token', source.adminToken, bundle]);
    expect(result, result.stderr).toMatchObject({ code: 0 });
  });

  afterAll(async () => {
    await worker?.stop(5000);
    await stopInstance(source);
    await stopInstance(target);
    await rm(workdir, { recursive: true, force: true });
  });

  it('imports into the same instance as a no-op', async () => {
    const instance = source as Instance;
    worker = startWorker(instance);
    const result = await runCli('import', ['--url', instance.url, '--token', instance.adminToken, bundle]);
    expect(result, `${result.stdout}\n${result.stderr}`).toMatchObject({ code: 0 });
    expect(result.stdout).toContain('Entries: 0 added, 0 updated, 1 unchanged, 0 conflicting');
    expect(await stateOf(instance, entryId)).toEqual(exported);
    await worker.stop(5000);
    worker = undefined;
  });

  it('imports into a fresh instance with its revisions, reasons, item IDs and values', async () => {
    await stopInstance(source);
    source = undefined;
    target = await startInstance(await createTestDatabase());
    worker = startWorker(target);
    const result = await runCli('import', ['--url', target.url, '--token', target.adminToken, bundle]);
    expect(result, `${result.stdout}\n${result.stderr}`).toMatchObject({ code: 0 });
    expect(await stateOf(target, entryId)).toEqual(exported);
  });
});
