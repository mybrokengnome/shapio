import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { ShapioClient } from '@shapio/client';
import { describe, expect, it, vi } from 'vitest';
import { createShapioMcpServer } from './server.js';

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';
const GUIDE_ID = '33333333-3333-4333-8333-333333333333';

const field = (id: string, apiKey: string) => ({ id, apiKey, label: apiKey, type: 'string' });

/** Post (title) and Guide (level), which extends it: the stored definitions, own fields only. */
const FAMILY = [
  {
    definition: {
      id: POST_ID,
      kind: 'collection',
      apiKey: 'post',
      pluralApiKey: 'posts',
      label: 'Post',
      fields: [field('44444444-4444-4444-8444-444444444444', 'title')],
    },
    version: 1,
    hash: 'p',
    site: null,
  },
  {
    definition: {
      id: GUIDE_ID,
      kind: 'collection',
      apiKey: 'guide',
      pluralApiKey: 'guides',
      label: 'Guide',
      extends: POST_ID,
      fields: [field('55555555-5555-4555-8555-555555555555', 'level')],
    },
    version: 1,
    hash: 'g',
    site: null,
  },
];

/** Only the client calls these tests make; anything else would throw. */
const fakeClient = (extra: unknown[] = []) => {
  const putSchemaDraft = vi.fn(async (_set: string, definitionId: string) => ({
    id: 'd1',
    definitionId,
    operation: 'create',
    version: 1,
  }));
  const client = {
    admin: {
      schema: {
        export: async () => ({
          schemaVersion: 3,
          definitions: [
            {
              definition: {
                id: AUTHOR_ID,
                kind: 'collection',
                apiKey: 'author',
                pluralApiKey: 'authors',
                label: 'Author',
                fields: [],
              },
              version: 2,
              hash: 'h',
            },
            ...extra,
          ],
        }),
      },
      changeSets: {
        get: async () => ({ id: 'cs1', items: [] }),
        create: async () => ({ id: 'cs1', items: [] }),
        putSchemaDraft,
      },
    },
  } as unknown as ShapioClient;
  return { client, putSchemaDraft };
};

const connect = async (allowShip: boolean, client: ShapioClient) => {
  const server = createShapioMcpServer(
    { baseUrl: 'http://cms.test', token: 't', allowShip, mediaRoot: process.cwd() },
    client,
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
};

const textOf = (result: { content?: unknown }) =>
  JSON.parse((result.content as Array<{ text: string }>)[0]?.text ?? 'null') as Record<string, unknown>;

describe('the Shapio MCP server', () => {
  it('offers change_sets_ship only with --allow-ship', async () => {
    const without = await connect(false, fakeClient().client);
    const names = (await without.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('change_sets_review');
    expect(names).not.toContain('change_sets_ship');
    expect(names.every((name) => /^[a-z][a-z0-9_]*$/.test(name))).toBe(true);
    const withShip = await connect(true, fakeClient().client);
    expect((await withShip.listTools()).tools.map((tool) => tool.name)).toContain('change_sets_ship');
  });

  it('drafts a new definition with a fresh ID and resolves relation targets given as API IDs', async () => {
    const { client, putSchemaDraft } = fakeClient();
    const mcp = await connect(false, client);
    const result = await mcp.callTool({
      name: 'schema_draft',
      arguments: {
        definition: {
          kind: 'collection',
          apiKey: 'post',
          label: 'Post',
          fields: [
            {
              apiKey: 'author',
              label: 'Author',
              type: 'relation',
              settings: { target: 'author', cardinality: 'one' },
            },
          ],
        },
      },
    });
    expect(result.isError).toBeFalsy();
    const [, definitionId, body] = putSchemaDraft.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(definitionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({
      category: 'model',
      baseVersion: null,
      definition: { id: definitionId, fields: [{ settings: { target: AUTHOR_ID } }] },
    });
    expect(textOf(result)).toMatchObject({ changeSetId: 'cs1', definitionId });
  });

  it('lists a type that extends another with its parent, nested route and inherited fields first', async () => {
    const mcp = await connect(false, fakeClient(FAMILY).client);
    const { definitions } = textOf(await mcp.callTool({ name: 'schema_list', arguments: {} })) as {
      definitions: Array<Record<string, unknown>>;
    };
    expect(definitions.find((definition) => definition.apiKey === 'guide')).toMatchObject({
      extends: 'post',
      pluralApiKey: 'guides',
      routeKey: 'posts/guides',
      fields: [
        { apiKey: 'title', inheritedFrom: 'post' },
        { apiKey: 'level', type: 'string' },
      ],
    });
    const post = definitions.find((definition) => definition.apiKey === 'post');
    expect(post).toMatchObject({ routeKey: 'posts', fields: [{ apiKey: 'title' }] });
    expect(post).not.toHaveProperty('extends');
  });

  it('reads a child as stored, with what it inherits beside it', async () => {
    const mcp = await connect(false, fakeClient(FAMILY).client);
    const result = textOf(await mcp.callTool({ name: 'schema_get', arguments: { apiKey: 'guide' } }));
    expect(result).toMatchObject({
      definition: { extends: POST_ID, fields: [{ apiKey: 'level' }] },
      extendsApiKey: 'post',
      routeKey: 'posts/guides',
      inheritedFields: [{ apiKey: 'title', inheritedFrom: 'post' }],
    });
  });

  it('drafts a child whose parent is given by API ID', async () => {
    const { client, putSchemaDraft } = fakeClient(FAMILY);
    const mcp = await connect(false, client);
    await mcp.callTool({
      name: 'schema_draft',
      arguments: { definition: { kind: 'collection', apiKey: 'opinion', extends: 'post', fields: [] } },
    });
    const [, , body] = putSchemaDraft.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(body).toMatchObject({ definition: { extends: POST_ID } });
  });

  it('turns API refusals into tool errors with the code', async () => {
    const mcp = await connect(false, fakeClient().client);
    const result = await mcp.callTool({ name: 'schema_get', arguments: { apiKey: 'missing' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatchObject({ error: { code: 'TOOL_FAILED' } });
  });

  it('names the --site / SHAPIO_SITE site on every request of its default client', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ schemaVersion: 1, definitions: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    try {
      const server = createShapioMcpServer({
        baseUrl: 'http://cms.test',
        token: 't',
        allowShip: false,
        mediaRoot: process.cwd(),
        site: 'marketing',
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcp = new Client({ name: 'test', version: '1.0.0' });
      await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
      await mcp.callTool({ name: 'schema_list', arguments: {} });
      const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.headers).toMatchObject({ 'shapio-site': 'marketing', authorization: 'Bearer t' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
