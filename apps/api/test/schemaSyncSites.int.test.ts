import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMOTE_COMMANDS, type CliIo } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, pageDefinition, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Definition = { id: string; apiKey: string; label: string } & Record<string, unknown>;
type LockBody = {
  formatVersion: number;
  sites?: string[];
  definitions: Record<string, { apiKey: string; site?: string | null; version: number }>;
};
type ExportBody = { definitions: Array<{ definition: Definition; version: number; site: string | null }> };

/** Runs `shapio schema …` in-process against a listening test server, capturing output. */
const runCli = async (args: string[], env: Record<string, string>) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env };
  const code = await REMOTE_COMMANDS.schema!.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

const exists = async (path: string) =>
  readFile(path).then(
    () => true,
    () => false,
  );

/**
 * `shapio schema pull | apply | scope` per site (plan site-schema, acceptance 6): one tree holds the shared
 * folders and a folder per site; a site's pull and apply never read, send, change or remove another site's
 * definitions; scope refusals are reported per item; `schema scope` moves a definition between scopes.
 */
describe('shapio schema per site', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let network: SchemaClient;
  let workdir: string;
  let env: Record<string, string>;
  let siteEnv: Record<string, string>;
  const ids: Record<string, string> = {};

  const schemaDir = () => join(workdir, 'schema');
  const lockPath = () => join(workdir, '.shapio', 'schema-lock.json');
  const cli = (command: string, ...extra: string[]) =>
    runCli([command, '--dir', schemaDir(), '--lock', lockPath(), ...extra], env);
  const file = (...parts: string[]) => join(schemaDir(), ...parts);
  const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;
  const lock = () => readJson<LockBody>(lockPath());
  const on = (siteKey: string) => ({
    get: (url: string) => network.request({ method: 'GET', url, headers: { [SITE_HEADER]: siteKey } }),
    post: (url: string, payload: object) =>
      network.request({ method: 'POST', url, payload, headers: { [SITE_HEADER]: siteKey } }),
  });
  const exported = async (siteKey: string) =>
    expectStatus(await on(siteKey).get('/api/admin/schema/export'), 200).json<ExportBody>();
  const versionOf = async (siteKey: string, apiKey: string) =>
    (await exported(siteKey)).definitions.find((entry) => entry.definition.apiKey === apiKey)?.version;
  const create = async (siteKey: string, apiKey: string, scope: 'network' | 'site', label = apiKey) => {
    const response = await on(siteKey).post('/api/admin/models', {
      definition: pageDefinition({ apiKey, label }),
      scope,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ definitionId: string }>().definitionId;
  };
  const editFile = async (path: string, label: string) => {
    const definition = await readJson<Definition>(path);
    await writeFile(path, `${JSON.stringify({ ...definition, label }, null, 2)}\n`);
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    const address = testApp.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const token = await createRoleToken(database.current.db);
    network = schemaClient(testApp.app, token);
    expectStatus(await on('default').post('/api/admin/sites', { key: 'b', name: 'Site B' }), 201);
    workdir = await mkdtemp(join(tmpdir(), 'shapio-schema-sites-'));
    env = { SHAPIO_URL: `http://127.0.0.1:${port}`, SHAPIO_TOKEN: token };
    // An admin of the primary site only: its own definitions, not the shared ones.
    siteEnv = { ...env, SHAPIO_TOKEN: await createRoleToken(database.current.db, 'admin', PRIMARY_SITE_ID) };
    ids.tag = await create('default', 'tag', 'network');
    ids.postA = await create('default', 'post', 'site', 'Post on A');
    ids.postB = await create('b', 'post', 'site', 'Post on B');
    ids.note = await create('b', 'note', 'site');
  });
  afterAll(async () => {
    await testApp.app.close();
    await rm(workdir, { recursive: true, force: true });
  });

  it("pull writes the shared definitions and the site's own (default: the token's site, else the primary)", async () => {
    const result = await cli('pull');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('site "default"');
    expect((await readJson<Definition>(file('models', 'tag.json'))).id).toBe(ids.tag);
    expect((await readJson<Definition>(file('sites', 'default', 'models', 'post.json'))).id).toBe(ids.postA);
    expect(await exists(file('sites', 'b', 'models', 'post.json'))).toBe(false);
    expect(await lock()).toMatchObject({
      formatVersion: 2,
      sites: ['default'],
      definitions: { [ids.tag!]: { site: null }, [ids.postA!]: { site: 'default' } },
    });
  });

  it('pulling a second site into the same tree keeps the first one', async () => {
    const result = await cli('pull', '--site', 'b');
    expect(result.code, result.stderr).toBe(0);
    expect((await readJson<Definition>(file('sites', 'b', 'models', 'post.json'))).id).toBe(ids.postB);
    expect(await exists(file('sites', 'default', 'models', 'post.json'))).toBe(true);
    const current = await lock();
    expect(current.sites).toEqual(['b', 'default']);
    expect(Object.keys(current.definitions).sort()).toEqual(
      [ids.tag, ids.postA, ids.postB, ids.note].map(String).sort(),
    );
  });

  it("apply --prune for one site changes that site only, never another site's definitions", async () => {
    await editFile(file('sites', 'default', 'models', 'post.json'), 'Post on A (edited)');
    // Deleting B's file is no instruction for site A: B's definitions are neither sent nor in A's base.
    await unlink(file('sites', 'b', 'models', 'note.json'));
    const noteVersion = await versionOf('b', 'note');
    const result = await cli('apply', '--site', 'default', '--prune', '--allow-breaking');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('model post: update');
    expect(result.stdout).not.toContain('note');
    expect(await versionOf('b', 'note')).toBe(noteVersion);
    expect(
      (await exported('b')).definitions.find((entry) => entry.definition.id === ids.postB)?.definition,
    ).toMatchObject({ label: 'Post on B' });
    expect((await lock()).definitions[ids.note!]).toMatchObject({ site: 'b' });
    // Back to a clean tree for B.
    expect((await cli('pull', '--site', 'b')).code).toBe(0);
    expect(await exists(file('sites', 'b', 'models', 'note.json'))).toBe(true);
  });

  it('refuses a site the tree does not cover, before sending anything', async () => {
    const result = await cli('apply', '--site', 'c');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('covers the site(s) b, default, not "c"');
    expect(result.stderr).toContain('shapio schema pull --site c');
  });

  it('reports a shared file a site admin may not change, per item, and applies nothing', async () => {
    await editFile(file('models', 'tag.json'), 'Tags (by a site admin)');
    await editFile(file('sites', 'default', 'models', 'post.json'), 'Post on A (site admin)');
    const postVersion = await versionOf('default', 'post');
    const result = await runCli(
      ['apply', '--dir', schemaDir(), '--lock', lockPath(), '--site', 'default'],
      siteEnv,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('FORBIDDEN_SCOPE');
    expect(result.stderr).toContain('  tag (shared):');
    expect(result.stderr).toContain('schema permission on every site');
    expect(await versionOf('default', 'post')).toBe(postVersion);
    expect((await cli('pull', '--force')).code).toBe(0);
  });

  it('refuses a file moved to another scope (SCOPE_MISMATCH): sync never moves a definition', async () => {
    await mkdir(file('sites', 'default', 'models'), { recursive: true });
    await rename(file('models', 'tag.json'), file('sites', 'default', 'models', 'tag.json'));
    await editFile(file('sites', 'default', 'models', 'tag.json'), 'Tags (moved)');
    const result = await cli('apply');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('SCOPE_MISMATCH');
    expect(result.stderr).toContain(
      'tag: its file is in the site’s folder, but on the instance it is shared',
    );
    expect((await cli('pull', '--force')).code).toBe(0);
    expect(await exists(file('models', 'tag.json'))).toBe(true);
    expect(await exists(file('sites', 'default', 'models', 'tag.json'))).toBe(false);
  });

  it('schema scope shares a site definition, and a pull moves its file', async () => {
    const shared = await runCli(['scope', 'note', '--shared', '--site', 'b'], env);
    expect(shared.code, shared.stderr).toBe(0);
    expect(shared.stdout).toContain('note is now shared with all sites');
    expect((await exported('default')).definitions.map((entry) => entry.definition.apiKey)).toContain('note');
    const pulled = await cli('pull', '--site', 'default');
    expect(pulled.code, pulled.stderr).toBe(0);
    expect((await readJson<Definition>(file('models', 'note.json'))).id).toBe(ids.note);
    // The same definition's old file under B's folder is gone: one file per ID.
    expect(await exists(file('sites', 'b', 'models', 'note.json'))).toBe(false);
    expect((await lock()).definitions[ids.note!]).toMatchObject({ site: null });
    const again = await runCli(['scope', 'note', '--shared'], env);
    expect(again.stdout).toContain('note is already shared with all sites');
  });

  it('schema scope refuses to keep on one site what another site has entries of (SCOPE_IN_USE)', async () => {
    expectStatus(await on('default').post('/api/admin/content/note', { data: { title: 'On A' } }), 201);
    const refused = await runCli(['scope', 'note', '--site', 'b'], env);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('SCOPE_IN_USE');
    expect(refused.stderr).toContain('site default: 1 entry');
    const usage = await runCli(['scope', 'note'], env);
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Pass --site <key> to keep it on that site, or --shared');
  });

  it('upgrades a format 1 lock: a shared-only tree still applies to every site', async () => {
    const tree = await mkdtemp(join(tmpdir(), 'shapio-schema-v1-'));
    try {
      const tag = (await exported('b')).definitions.find((entry) => entry.definition.id === ids.tag)!;
      await mkdir(join(tree, 'schema', 'models'), { recursive: true });
      await writeFile(join(tree, 'schema', 'models', 'tag.json'), `${JSON.stringify(tag.definition)}\n`);
      const v1 = {
        formatVersion: 1,
        schemaVersion: 1,
        definitions: {
          [ids.tag!]: { kind: 'collection', apiKey: 'tag', version: tag.version, hash: 'sha256:stale' },
        },
      };
      await writeFile(join(tree, 'lock.json'), JSON.stringify(v1));
      const flags = ['--dir', join(tree, 'schema'), '--lock', join(tree, 'lock.json')];
      for (const site of ['default', 'b']) {
        const diff = await runCli(['diff', ...flags, '--site', site], env);
        expect(diff.code, diff.stderr).toBe(0);
        expect(diff.stdout).not.toContain('conflict');
      }
      const pulled = await runCli(['pull', ...flags, '--site', 'b', '--force'], env);
      expect(pulled.code, pulled.stderr).toBe(0);
      expect(await readJson<LockBody>(join(tree, 'lock.json'))).toMatchObject({
        formatVersion: 2,
        sites: ['b'],
        definitions: { [ids.tag!]: { site: null }, [ids.postB!]: { site: 'b' } },
      });
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });
});
