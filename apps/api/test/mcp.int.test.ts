import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import { expectStatus } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { API_ROOT } from './helpers/env.js';
import { createPng } from './helpers/media.js';
import { createRoleToken, runSchemaJobs, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const MCP_BIN = fileURLToPath(new URL('../../../packages/mcp/src/bin.ts', import.meta.url));

type ToolResult = { isError?: boolean; content?: unknown };

/** The JSON a tool answered with (its text content). */
const bodyOf = <T = Record<string, unknown>>(result: ToolResult): T =>
  JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? 'null') as T;

/**
 * @shapio/mcp over stdio against a listening Shapio (agentic plan §I, A1): an agent token whose role can
 * draft but not ship models a blog, writes entries and opens a change set; shipping is refused without
 * --allow-ship (the tool is not offered) and for a role without changes.ship (the server refuses).
 */
describe('@shapio/mcp over stdio', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let owner: SchemaClient;
  let origin: string;
  let agentToken: string;
  let mediaRoot: string;
  const clients: Client[] = [];

  /** Spawns the MCP server from source, the way `npx @shapio/mcp` runs the built bin. */
  const connect = async (args: string[] = []) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--conditions=@shapio/source', '--import', 'tsx', MCP_BIN, ...args],
      cwd: API_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        SHAPIO_URL: origin,
        SHAPIO_TOKEN: agentToken,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'shapio-mcp-test', version: '1.0.0' });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as ToolResult;

  const ok = async <T = Record<string, unknown>>(
    client: Client,
    name: string,
    args: Record<string, unknown> = {},
  ) => {
    const result = await call(client, name, args);
    if (result.isError) {
      throw new Error(`${name} failed: ${JSON.stringify(bodyOf(result))}`);
    }
    return bodyOf<T>(result);
  };

  /** The test-only ship: a person (the owner token) ships what the agent prepared. */
  const shipAsOwner = async (changeSetId: string) => {
    const set = expectStatus(await owner.get(`/api/admin/change-sets/${changeSetId}`), 200).json<{
      version: number;
    }>();
    const response = await owner.post(`/api/admin/change-sets/${changeSetId}/ship`, {
      expectedVersion: set.version,
    });
    if (response.statusCode === 202) {
      await runSchemaJobs(database.current.db);
    } else {
      expectStatus(response, 200);
    }
    const shipped = expectStatus(await owner.get(`/api/admin/change-sets/${changeSetId}`), 200).json<{
      status: string;
    }>();
    expect(shipped.status).toBe('shipped');
  };

  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), 'shapio-mcp-media-'));
    testApp = await createTestApp(database.current, { env: { MEDIA_PATH: join(mediaRoot, 'storage') } });
    await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    origin = `http://127.0.0.1:${(testApp.app.server.address() as AddressInfo).port}`;
    owner = schemaClient(testApp.app, await createRoleToken(database.current.db, 'owner'));
    // The agent's role: drafts content and schema, fills change sets, uploads media; no publish, no changes.ship.
    expectStatus(
      await owner.post('/api/admin/roles', {
        key: 'agent',
        name: 'Agent',
        kind: 'admin',
        permissions: [
          ...['read', 'create', 'update'].map((action) => ({
            action,
            modelId: null,
            condition: null,
            fieldIds: null,
          })),
          ...['schema.create', 'changes.manage', 'media.read', 'media.write'].map((action) => ({
            action,
            modelId: null,
            condition: null,
            fieldIds: null,
          })),
        ],
      }),
      201,
    );
    agentToken = await createRoleToken(database.current.db, 'agent');
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await testApp?.app.close();
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('models a blog, writes three entries and opens a change set for review; shipping stays with people', async () => {
    const agent = await connect([`--media-root=${mediaRoot}`]);
    const tools = (await agent.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(['schema_list', 'content_query', 'change_sets_review']));
    expect(tools).not.toContain('change_sets_ship');
    expect((await agent.listPrompts()).prompts.map((prompt) => prompt.name).sort()).toEqual([
      'model_content_type',
      'review_change_set',
    ]);

    // Model: an author and a post that relates to it by API ID, drafted into one change set.
    const author = await ok<{ changeSetId: string; definitionId: string }>(agent, 'schema_draft', {
      title: 'Blog',
      definition: {
        kind: 'collection',
        apiKey: 'author',
        label: 'Author',
        fields: [{ apiKey: 'name', label: 'Name', type: 'string', required: true }],
      },
    });
    const post = await ok<{ definitionId: string }>(agent, 'change_sets_add_schema_draft', {
      changeSetId: author.changeSetId,
      definition: {
        kind: 'collection',
        apiKey: 'post',
        label: 'Post',
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string', required: true },
          { apiKey: 'body', label: 'Body', type: 'text' },
          {
            apiKey: 'author',
            label: 'Author',
            type: 'relation',
            settings: { target: 'author', cardinality: 'one' },
          },
        ],
      },
    });
    const schemaReview = await ok<{ set: { schemaItemCount: number }; review: unknown }>(
      agent,
      'change_sets_review',
      {
        changeSetId: author.changeSetId,
      },
    );
    expect(schemaReview.set.schemaItemCount).toBe(2);
    // Nothing is live until a person ships it.
    expect((await ok<{ definitions: unknown[] }>(agent, 'schema_list')).definitions).toHaveLength(0);
    await shipAsOwner(author.changeSetId);
    const definition = await ok<{
      definition: { id: string; fields: Array<{ apiKey: string; settings: Record<string, unknown> }> };
    }>(agent, 'schema_get', { apiKey: 'post' });
    expect(definition.definition.id).toBe(post.definitionId);
    expect(definition.definition.fields.find((field) => field.apiKey === 'author')?.settings.target).toBe(
      author.definitionId,
    );

    // The pull format as a resource.
    const resource = await agent.readResource({ uri: 'shapio://schema/post' });
    expect(JSON.parse((resource.contents[0] as { text: string }).text)).toMatchObject({ apiKey: 'post' });
    const docs = await agent.readResource({ uri: 'shapio://docs/delivery-api' });
    expect((docs.contents[0] as { text: string }).text).toContain('# Delivery API');

    // Content: three draft posts, then a change set proposing to publish them.
    const writer = await ok<{ id: string }>(agent, 'content_create', {
      model: 'author',
      data: { name: 'Ada' },
    });
    const ids: string[] = [];
    for (const title of ['Hello', 'Second post', 'Third post']) {
      const entry = await ok<{ id: string; version: number }>(agent, 'content_create', {
        model: 'post',
        data: { title, author: writer.id },
      });
      ids.push(entry.id);
    }
    const first = await ok<{ version: number }>(agent, 'content_get', { model: 'post', id: ids[0] });
    await ok(agent, 'content_update', {
      model: 'post',
      id: ids[0],
      data: { body: 'Edited by the agent' },
      expectedVersion: first.version,
    });
    const stale = await call(agent, 'content_update', {
      model: 'post',
      id: ids[0],
      data: { body: 'Stale' },
      expectedVersion: first.version,
    });
    expect(stale.isError).toBe(true);
    expect(bodyOf<{ error: { code: string } }>(stale).error.code).toBe('CONTENT_VERSION_CONFLICT');
    const drafts = await ok<{ items: unknown[] }>(agent, 'content_query', {
      model: 'post',
      sort: [{ field: 'createdAt', direction: 'asc' }],
    });
    expect(drafts.items).toHaveLength(3);

    const set = await ok<{ id: string }>(agent, 'change_sets_create', { title: 'First posts' });
    for (const entryId of ids) {
      await ok(agent, 'change_sets_add_entry', { changeSetId: set.id, model: 'post', entryId });
    }
    const review = await ok<{
      set: { entryItemCount: number; status: string };
      review: { entries?: unknown[] };
    }>(agent, 'change_sets_review', { changeSetId: set.id });
    expect(review.set).toMatchObject({ entryItemCount: 3, status: 'open' });

    // Not live yet: the delivery API serves nothing for posts.
    const published = await ok<{ data: unknown[] }>(agent, 'content_query', {
      model: 'post',
      published: true,
    });
    expect(published.data).toHaveLength(0);

    // Media from the media root only.
    await writeFile(join(mediaRoot, 'cover.png'), await createPng(4, 4));
    const asset = await ok<{ id: string; alt: string }>(agent, 'media_upload', {
      path: 'cover.png',
      alt: 'A cover',
    });
    expect(asset.alt).toBe('A cover');
    const outside = await call(agent, 'media_upload', { path: '../../etc/hosts' });
    expect(outside.isError).toBe(true);

    // Shipping is not offered without --allow-ship: the call is an unknown tool.
    await expect(
      call(agent, 'change_sets_ship', { changeSetId: set.id, expectedVersion: 1 }),
    ).rejects.toThrow(/change_sets_ship not found/);
  });

  it("reads its site's own schema, and drafts a shared definition only when asked", async () => {
    const onB = { [SITE_HEADER]: 'b' };
    expectStatus(await owner.post('/api/admin/sites', { key: 'b', name: 'Site B' }), 201);
    const agentB = await connect(['--site', 'b']);
    type Drafted = { changeSetId: string; draft: { shared: boolean } };
    const set = await ok<Drafted>(agentB, 'schema_draft', {
      title: 'Site B',
      definition: { kind: 'collection', apiKey: 'note', label: 'Note', fields: [] },
    });
    const topic = await ok<Drafted>(agentB, 'change_sets_add_schema_draft', {
      changeSetId: set.changeSetId,
      shared: true,
      definition: { kind: 'collection', apiKey: 'topic', label: 'Topic', fields: [] },
    });
    expect([set.draft.shared, topic.draft.shared]).toEqual([false, true]);
    const drafts = expectStatus(
      await owner.request({ method: 'GET', url: `/api/admin/change-sets/${set.changeSetId}`, headers: onB }),
      200,
    ).json<{ version: number }>();
    const shipped = await owner.request({
      method: 'POST',
      url: `/api/admin/change-sets/${set.changeSetId}/ship`,
      payload: { expectedVersion: drafts.version },
      headers: onB,
    });
    if (shipped.statusCode === 202) {
      await runSchemaJobs(database.current.db);
    } else {
      expectStatus(shipped, 200);
    }

    type Listed = { definitions: Array<{ apiKey: string; scope: string }> };
    const onSiteB = (await ok<Listed>(agentB, 'schema_list')).definitions;
    expect(onSiteB.map((item) => `${item.apiKey}:${item.scope}`).sort()).toEqual(['note:b', 'topic:shared']);
    const onDefault = (await ok<Listed>(await connect(), 'schema_list')).definitions.map(
      (item) => item.apiKey,
    );
    expect(onDefault).toEqual(expect.arrayContaining(['author', 'post', 'topic']));
    expect(onDefault).not.toContain('note');
    const missing = await call(agentB, 'schema_get', { apiKey: 'post' });
    expect(missing.isError).toBe(true);
  });

  it('refuses to ship for a token whose role lacks changes.ship, even with --allow-ship', async () => {
    const agent = await connect(['--allow-ship']);
    expect((await agent.listTools()).tools.map((tool) => tool.name)).toContain('change_sets_ship');
    const set = await ok<{ id: string; version: number }>(agent, 'change_sets_create', {
      title: 'Try to ship',
    });
    const writer = await ok<{ id: string }>(agent, 'content_create', {
      model: 'author',
      data: { name: 'Grace' },
    });
    const withItem = await ok<{ version: number }>(agent, 'change_sets_add_entry', {
      changeSetId: set.id,
      model: 'author',
      entryId: writer.id,
    });
    const result = await call(agent, 'change_sets_ship', {
      changeSetId: set.id,
      expectedVersion: withItem.version,
    });
    expect(result.isError).toBe(true);
    const { error } = bodyOf<{ error: { status: number; code: string; message: string } }>(result);
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(error.message).toContain('changes.ship');
    // A person with changes.ship ships the same set.
    await shipAsOwner(set.id);
    const snapshots = await ok<{ items: unknown[] }>(agent, 'snapshots_list');
    expect(snapshots.items.length).toBeGreaterThan(0);
  });
});
