#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { OptionsError, parseOptions, USAGE } from './options.js';
import { createShapioMcpServer } from './server.js';

/**
 * `shapio-mcp`: stdio MCP server. stdout carries the protocol, so everything for people goes to stderr.
 */
const main = async () => {
  const options = parseOptions(process.argv.slice(2), process.env, process.cwd());
  if (options === 'help') {
    process.stderr.write(USAGE);
    return;
  }
  const server = createShapioMcpServer(options);
  await server.connect(new StdioServerTransport());
};

main().catch((error: unknown) => {
  const message =
    error instanceof OptionsError
      ? `${error.message}\n\n${USAGE}`
      : error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);
  process.stderr.write(`shapio-mcp: ${message}\n`);
  process.exitCode = 1;
});
