import { McpServer } from '@modelcontextprotocol/server';
import { createClient, type ShapioClient } from '@shapio/client';
import packageJson from '../package.json' with { type: 'json' };
import type { ToolContext } from './context.js';
import type { McpOptions } from './options.js';
import { registerPrompts } from './prompts.js';
import { registerResources } from './resources.js';
import { registerChangeSetTools } from './tools/changeSets.js';
import { registerContentTools } from './tools/content.js';
import { registerInsightTools } from './tools/insights.js';
import { registerMediaTools } from './tools/media.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerSnapshotTools } from './tools/snapshots.js';

export const MCP_SERVER_NAME = 'shapio';
export const MCP_SERVER_VERSION: string = packageJson.version;

const INSTRUCTIONS =
  'Shapio is a headless CMS whose content types are live data. Agents propose, people ship: draft schema ' +
  'changes and entries, collect them in a change set, and leave shipping to a person. Model and field ' +
  'identifiers are called "API IDs". Read shapio://docs/delivery-api for how sites read content.';

/** The MCP server for one Shapio instance, with every tool, resource and prompt registered. */
export const createShapioMcpServer = (
  options: McpOptions,
  client: ShapioClient = createClient({
    baseUrl: options.baseUrl,
    token: options.token,
    ...(options.site !== undefined ? { site: options.site } : {}),
  }),
): McpServer => {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  const context: ToolContext = { server, client, options };
  registerSchemaTools(context);
  registerContentTools(context);
  registerMediaTools(context);
  registerInsightTools(context);
  registerChangeSetTools(context);
  registerSnapshotTools(context);
  registerResources(context);
  registerPrompts(context);
  return server;
};
