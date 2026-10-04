import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMOTE_COMMANDS, type CliIo } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, pageDefinition, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Definition = {
  id: string;
  apiKey: string;
  label: string;
  fields: Array<Record<string, unknown>>;
} & Record<string, unknown>;

/** Runs `shapio schema …` in-process against a listening test server, capturing output. */
const runCli = async (args: string[], env: Record<string, string>) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env };
  const command = REMOTE_COMMANDS.schema;
  if (!command) {
    throw new Error('schema command is not registered');
  }
  const code = await command.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

describe('shapio schema pull | diff | apply', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let workdir: string;
  let env: Record<string, string>;
  let flags: string[];

  const cli = (command: string, ...extra: string[]) => runCli([command, ...flags, ...extra], env);
  const filePath = (apiKey: string) => join(workdir, 'schema', 'models', `${apiKey}.json`);
  const readDefinitionFile = async (apiKey: string) =>
    JSON.parse(await readFile(filePath(apiKey), 'utf8')) as Definition;
  const writeDefinitionFile = (apiKey: string, definition: unknown) =>
    writeFile(filePath(apiKey), `${JSON.stringify(definition, null, 2)}\n`);
  const remote = async (id: string) =>
    (await admin.get(`/api/admin/models/${id}`)).json<{ definition: Definition; version: number }>();
  const editRemote = async (id: string, label: string) => {
    const current = await remote(id);
    const response = await admin.put(`/api/admin/models/${id}`, {
      definition: { ...current.definition, label },
      expectedVersion: current.version,
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const schemaVersion = async () =>
    (await admin.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
  const createModel = async (apiKey: string) => {
    // Shared: the CLI writes `models/` (format-1 trees); site folders are covered by the per-site cases.
    const response = await admin.post('/api/admin/models', {
      definition: pageDefinition({ apiKey, label: apiKey }),
      scope: 'network',
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ definitionId: string }>().definitionId;
  };

  let pageId: string;
  let postId: string;
  let faqId: string;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    const address = testApp.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const token = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, token);
    workdir = await mkdtemp(join(tmpdir(), 'shapio-schema-'));
    env = { SHAPIO_URL: `http://127.0.0.1:${port}`, SHAPIO_TOKEN: token };
    flags = ['--dir', join(workdir, 'schema'), '--lock', join(workdir, '.shapio', 'schema-lock.json')];
    pageId = await createModel('page');
    postId = await createModel('post');
    faqId = await createModel('faq');
  });
  afterAll(async () => {
    await testApp.app.close();
    await rm(workdir, { recursive: true, force: true });
  });

  it('pull writes one canonical file per model and a lock file', async () => {
    const result = await cli('pull');
    expect(result.code, result.stderr).toBe(0);
    const page = await readDefinitionFile('page');
    expect(page).toMatchObject({ id: pageId, apiKey: 'page', fields: [{ apiKey: 'title', required: true }] });
    const lock = JSON.parse(await readFile(join(workdir, '.shapio', 'schema-lock.json'), 'utf8')) as {
      definitions: Record<string, { version: number; hash: string }>;
    };
    expect(lock.definitions[pageId]).toMatchObject({
      apiKey: 'page',
      version: 1,
      hash: expect.stringMatching(/^sha256:/) as unknown,
    });
  });

  it('round-trips: apply right after pull changes nothing and leaves files byte-identical', async () => {
    const before = await readFile(filePath('page'), 'utf8');
    const version = await schemaVersion();
    const diff = await cli('diff');
    expect(diff.stdout).toContain('Nothing to apply.');
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Applied 0 definition(s)');
    expect(await schemaVersion()).toBe(version);
    expect(await readFile(filePath('page'), 'utf8')).toBe(before);
  });

  it('applies a local edit live and shows it in diff first', async () => {
    const page = await readDefinitionFile('page');
    await writeDefinitionFile('page', { ...page, label: 'Landing page' });
    const diff = await cli('diff');
    expect(diff.stdout).toContain('model page: update');
    expect(diff.stdout).toContain('~ label: "page" → "Landing page"');
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    expect(await remote(pageId)).toMatchObject({ version: 2, definition: { label: 'Landing page' } });
    expect((await cli('diff')).stdout).toContain('Nothing to apply.');
  });

  it('skips models unchanged locally even when the target changed them (no silent revert)', async () => {
    await editRemote(postId, 'Post (edited in production)');
    const page = await readDefinitionFile('page');
    await writeDefinitionFile('page', { ...page, label: 'Home' });
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    expect((await remote(pageId)).definition.label).toBe('Home');
    expect((await remote(postId)).definition.label).toBe('Post (edited in production)');
  });

  it('refuses a stale base on a touched model, shows the diff and applies nothing', async () => {
    await editRemote(pageId, 'Home (production)');
    const page = await readDefinitionFile('page');
    await writeDefinitionFile('page', { ...page, label: 'Home (git)' });
    const faq = await readDefinitionFile('faq');
    await writeDefinitionFile('faq', { ...faq, label: 'Questions' });
    const version = await schemaVersion();

    const result = await cli('apply');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SCHEMA_SYNC_CONFLICT');
    expect(result.stderr).toContain(
      'model page: conflict: changed locally AND on the target since your last pull',
    );
    expect(result.stderr).toContain('~ label: "Home (production)" → "Home (git)"');
    expect(await schemaVersion()).toBe(version);
    expect((await remote(faqId)).definition.label).toBe('faq');
  });

  it('pull refuses to overwrite local edits without --force; after reconciling, apply succeeds', async () => {
    const refused = await cli('pull');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('models/page.json');

    expect((await cli('pull', '--force')).code).toBe(0);
    expect((await readDefinitionFile('page')).label).toBe('Home (production)');
    const page = await readDefinitionFile('page');
    await writeDefinitionFile('page', { ...page, label: 'Home (reconciled)' });
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    expect((await remote(pageId)).definition.label).toBe('Home (reconciled)');
  });

  it('creates a hand-written model without IDs, then records the assigned IDs', async () => {
    await writeDefinitionFile('event', {
      kind: 'collection',
      apiKey: 'event',
      label: 'Event',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    const written = await readDefinitionFile('event');
    expect(written.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await remote(written.id)).version).toBe(1);
    expect((await cli('diff')).stdout).toContain('Nothing to apply.');
  });

  it('creates models that reference each other in one atomic apply', async () => {
    const speakerId = '00000000-0000-4000-8000-00000000a001';
    const talkId = '00000000-0000-4000-8000-00000000a002';
    await writeDefinitionFile('speaker', {
      id: speakerId,
      kind: 'collection',
      apiKey: 'speaker',
      label: 'Speaker',
      fields: [
        {
          apiKey: 'talks',
          label: 'Talks',
          type: 'relation',
          settings: { target: talkId, cardinality: 'many' },
        },
      ],
    });
    await writeDefinitionFile('talk', {
      id: talkId,
      kind: 'collection',
      apiKey: 'talk',
      label: 'Talk',
      fields: [
        {
          apiKey: 'speaker',
          label: 'Speaker',
          type: 'relation',
          settings: { target: speakerId, cardinality: 'one' },
        },
      ],
    });
    const version = await schemaVersion();
    const result = await cli('apply');
    expect(result.code, result.stderr).toBe(0);
    expect(await schemaVersion()).toBe(version + 1);
    expect((await remote(speakerId)).version).toBe(1);
    expect((await remote(talkId)).version).toBe(1);
  });

  it('needs --allow-breaking for an API-key rename and renames the file', async () => {
    const faq = await readDefinitionFile('faq');
    await writeDefinitionFile('faq', { ...faq, label: 'faq', apiKey: 'question' });
    const refused = await cli('apply');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('SCHEMA_CHANGE_NOT_ACKNOWLEDGED');
    const accepted = await cli('apply', '--allow-breaking');
    expect(accepted.code, accepted.stderr).toBe(0);
    expect((await remote(faqId)).definition.apiKey).toBe('question');
    expect((await readDefinitionFile('question')).id).toBe(faqId);
    await expect(readFile(filePath('faq'), 'utf8')).rejects.toThrow();
  });

  it('deletes a model only with --prune', async () => {
    await unlink(filePath('question'));
    const skipped = await cli('apply');
    expect(skipped.code).toBe(0);
    expect(skipped.stdout).toContain('deleted locally; pass --prune');
    expect((await admin.get(`/api/admin/models/${faqId}`)).statusCode).toBe(200);
    const pruned = await cli('apply', '--prune', '--allow-breaking');
    expect(pruned.code, pruned.stderr).toBe(0);
    expect((await admin.get(`/api/admin/models/${faqId}`)).statusCode).toBe(404);
  });

  it('reports invalid files by path', async () => {
    await writeDefinitionFile('broken', {
      kind: 'collection',
      apiKey: 'broken',
      label: 'Broken',
      fields: [{ apiKey: 'id', label: 'x', type: 'string' }],
    });
    const result = await cli('apply');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SCHEMA_INVALID');
    expect(result.stderr).toMatch(/models\/broken\.json \/fields\/0\/apiKey/);
    await unlink(filePath('broken'));
  });
});
