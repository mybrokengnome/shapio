import type { McpServer } from '@modelcontextprotocol/server';
import type { ShapioClient } from '@shapio/client';
import type { McpOptions } from './options.js';

/** What every tool, resource and prompt module registers against. */
export type ToolContext = {
  server: McpServer;
  client: ShapioClient;
  options: McpOptions;
};
