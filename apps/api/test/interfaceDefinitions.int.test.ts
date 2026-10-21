import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REMOTE_COMMANDS, type CliIo } from '@shapio/cli';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Stored = {
  definition: Record<string, unknown> & { id: string; fields: Array<Record<string, unknown>> };
  version: number;
};

const FEATURABLE_ID = '00000000-0000-4000-8000-00000000f001';
const BLOG_POST_ID = '00000000-0000-4000-8000-00000000f002';

const featurable = {
  id: FEATURABLE_ID,
  kind: 'interface',
  apiKey: 'featurable',
  label: 'Featurable',
  fields: [
    { apiKey: 'title', label: 'Title', type: 'string', required: true, sortable: true },
    { apiKey: 'summary', label: 'Summary', type: 'text' },
  ],
};

const blogPost = {
  id: BLOG_POST_ID,
  kind: 'collection',
  apiKey: 'blogPost',
  label: 'Blog post',
  implements: [FEATURABLE_ID],
  fields: [
    { apiKey: 'title', label: 'Title', type: 'string', required: true, sortable: true },
    { apiKey: 'summary', label: 'Summary', type: 'text' },
  ],
};

/** Runs `shapio schema …` in-process against the listening test server. */
const runCli = async (args: string[], env: Record<string, string>) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env };
  const code = await REMOTE_COMMANDS.schema?.run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
};

/** Interfaces through the admin API and schema files (plan interfaces, WP1). */
describe('interface definitions', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let workdir: string;
  let env: Record<string, string>;
  let flags: string[];

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    const address = testApp.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const token = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, token);
    workdir = await mkdtemp(join(tmpdir(), 'shapio-interfaces-'));
    env = { SHAPIO_URL: `http://127.0.0.1:${port}`, SHAPIO_TOKEN: token };
    flags = ['--dir', join(workdir, 'schema'), '--lock', join(workdir, '.shapio', 'schema-lock.json')];
  });
  afterAll(async () => {
    await testApp.app.close();
    await rm(workdir, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const response = await admin.get(path);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Stored>();
  };

  it('creates an interface and a type that implements it, shared with every site', async () => {
    const created = await admin.post('/api/admin/interfaces', { definition: featurable, scope: 'network' });
    expect(created.statusCode, created.body).toBe(201);
    const member = await admin.post('/api/admin/models', { definition: blogPost, scope: 'network' });
    expect(member.statusCode, member.body).toBe(201);

    const contract = await get(`/api/admin/interfaces/${FEATURABLE_ID}`);
    expect(contract.definition).toMatchObject({ kind: 'interface', pluralApiKey: 'featurables' });
    expect((await get(`/api/admin/models/${BLOG_POST_ID}`)).definition).toMatchObject({
      implements: [FEATURABLE_ID],
    });

    const interfaces = (await admin.get('/api/admin/interfaces')).json<{ items: Stored[] }>().items;
    expect(interfaces.map((item) => item.definition.id)).toEqual([FEATURABLE_ID]);
    const models = (await admin.get('/api/admin/models')).json<{ items: Stored[] }>().items;
    expect(models.map((item) => item.definition.id)).not.toContain(FEATURABLE_ID);
    expect((await admin.get(`/api/admin/models/${FEATURABLE_ID}`)).statusCode).toBe(404);
  });

  it('saving the stored definitions back changes nothing', async () => {
    for (const path of [`/api/admin/interfaces/${FEATURABLE_ID}`, `/api/admin/models/${BLOG_POST_ID}`]) {
      const current = await get(path);
      const response = await admin.put(path, {
        definition: current.definition,
        expectedVersion: current.version,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ status: 'unchanged' });
    }
  });

  it('refuses renaming a member field the contract requires, naming the interface', async () => {
    const current = await get(`/api/admin/models/${BLOG_POST_ID}`);
    const renamed = current.definition.fields.map((field) =>
      field.apiKey === 'summary' ? { ...field, apiKey: 'excerpt' } : field,
    );
    const response = await admin.put(`/api/admin/models/${BLOG_POST_ID}`, {
      definition: { ...current.definition, fields: renamed },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'SCHEMA_INVALID',
        details: {
          issues: [
            {
              code: 'INTERFACE_FIELD_MISSING',
              message: '"summary" is required by Featurable',
              interfaceId: FEATURABLE_ID,
              fieldApiKey: 'summary',
            },
          ],
        },
      },
    });
  });

  it('a relation may target the interface or any entry', async () => {
    const response = await admin.post('/api/admin/models', {
      scope: 'network',
      definition: {
        kind: 'singleton',
        apiKey: 'homepage',
        label: 'Homepage',
        fields: [
          {
            apiKey: 'featured',
            label: 'Featured',
            type: 'relation',
            settings: { target: FEATURABLE_ID, cardinality: 'many' },
          },
          {
            apiKey: 'spotlight',
            label: 'Spotlight',
            type: 'relation',
            settings: { target: '*', cardinality: 'one' },
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
  });

  it('refuses deleting an interface while a type implements it', async () => {
    const contract = await get(`/api/admin/interfaces/${FEATURABLE_ID}`);
    const response = await admin.delete(
      `/api/admin/interfaces/${FEATURABLE_ID}?expectedVersion=${contract.version}&acknowledgeBreaking=true`,
    );
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { details: { issues: [{ code: 'HAS_MEMBERS' }] } } });
  });

  it('round-trips through schema files: pull writes interfaces/, apply after pull changes nothing', async () => {
    const pulled = await runCli(['pull', ...flags], env);
    expect(pulled.code, pulled.stderr).toBe(0);
    const file = JSON.parse(
      await readFile(join(workdir, 'schema', 'interfaces', 'featurable.json'), 'utf8'),
    ) as {
      id: string;
      kind: string;
    };
    expect(file).toMatchObject({ id: FEATURABLE_ID, kind: 'interface' });
    const lock = JSON.parse(await readFile(join(workdir, '.shapio', 'schema-lock.json'), 'utf8')) as {
      definitions: Record<string, { kind: string }>;
    };
    expect(lock.definitions[FEATURABLE_ID]).toMatchObject({ kind: 'interface' });
    expect((await runCli(['diff', ...flags], env)).stdout).toContain('Nothing to apply.');
    const unchanged = await runCli(['apply', ...flags], env);
    expect(unchanged.code, unchanged.stderr).toBe(0);
    expect(unchanged.stdout).toContain('Applied 0 definition(s)');
  });

  it('applies a file edit that adds a contract field and the field to the member, live', async () => {
    const contractPath = join(workdir, 'schema', 'interfaces', 'featurable.json');
    const memberPath = join(workdir, 'schema', 'models', 'blogPost.json');
    const contract = JSON.parse(await readFile(contractPath, 'utf8')) as Stored['definition'];
    const member = JSON.parse(await readFile(memberPath, 'utf8')) as Stored['definition'];
    const image = { apiKey: 'image', label: 'Image', type: 'media' };
    await writeFile(
      contractPath,
      `${JSON.stringify({ ...contract, fields: [...contract.fields, image] }, null, 2)}\n`,
    );
    await writeFile(
      memberPath,
      `${JSON.stringify({ ...member, fields: [...member.fields, image] }, null, 2)}\n`,
    );
    const applied = await runCli(['apply', ...flags], env);
    expect(applied.code, applied.stderr).toBe(0);
    const stored = await get(`/api/admin/interfaces/${FEATURABLE_ID}`);
    expect(stored.definition.fields.map((field) => field.apiKey)).toEqual(['title', 'summary', 'image']);
  });
});
