import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { ShapioClient } from '@shapio/client';
import { describe, expect, it, vi } from 'vitest';
import { createShapioMcpServer } from './server.js';

const AUTHOR_ID = '11111111-1111-4111-8111-111111111111';

/** Only the client calls these tests make; anything else would throw. */
const fakeClient = () => {
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

  it('turns API refusals into tool errors with the code', async () => {
    const mcp = await connect(false, fakeClient().client);
    const result = await mcp.callTool({ name: 'schema_get', arguments: { apiKey: 'missing' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatchObject({ error: { code: 'TOOL_FAILED' } });
  });
});
