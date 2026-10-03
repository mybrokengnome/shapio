import { parseArgs } from 'node:util';
import type { CliCommand, CliIo } from '@shapio/cli';
import { createUrlBuilder } from '../helpers/publicUrl.js';

/**
 * `shapio mcp`: prints how to connect a coding agent to this instance through @shapio/mcp (a stdio MCP
 * server run with npx). Prints configuration only: it creates no token and contacts nothing.
 */
const MCP_USAGE =
  'shapio mcp [--url <Shapio URL>] [--client claude-code|cursor|claude-desktop] [--allow-ship]\n' +
  '  Prints the MCP client configuration for @shapio/mcp. The URL defaults to SHAPIO_URL, then\n' +
  '  PUBLIC_URL + BASE_PATH. Create an admin API token whose role has no "changes.ship" and paste it in place\n' +
  '  of the placeholder: agents prepare change sets, people ship them.';

const CLIENTS = ['claude-code', 'cursor', 'claude-desktop'] as const;
type McpClientKind = (typeof CLIENTS)[number];

export const TOKEN_PLACEHOLDER = '<admin API token>';
const PACKAGE = '@shapio/mcp';

const defaultUrl = (env: CliIo['env']) => {
  if (env.SHAPIO_URL) {
    return env.SHAPIO_URL;
  }
  if (env.PUBLIC_URL) {
    const urls = createUrlBuilder({
      publicUrl: env.PUBLIC_URL,
      basePath: (env.BASE_PATH ?? '').replace(/\/+$/, ''),
    });
    return urls.publicUrl + urls.basePath;
  }
  return 'http://localhost:4300';
};

const serverArgs = (allowShip: boolean) => ['-y', PACKAGE, ...(allowShip ? ['--allow-ship'] : [])];

/** The `mcpServers` JSON block Cursor and Claude Desktop read. */
const jsonConfig = (url: string, allowShip: boolean) =>
  JSON.stringify(
    {
      mcpServers: {
        shapio: {
          command: 'npx',
          args: serverArgs(allowShip),
          env: { SHAPIO_URL: url, SHAPIO_TOKEN: TOKEN_PLACEHOLDER },
        },
      },
    },
    null,
    2,
  );

const SECTIONS: Record<McpClientKind, (url: string, allowShip: boolean) => string> = {
  'claude-code': (url, allowShip) =>
    `Claude Code (run in your project):\n\n  claude mcp add shapio --env SHAPIO_URL=${url} --env "SHAPIO_TOKEN=${TOKEN_PLACEHOLDER}" -- npx ${serverArgs(allowShip).join(' ')}\n`,
  cursor: (url, allowShip) => `Cursor (.cursor/mcp.json in your project):\n\n${jsonConfig(url, allowShip)}\n`,
  'claude-desktop': (url, allowShip) =>
    `Claude Desktop (claude_desktop_config.json, then restart the app):\n\n${jsonConfig(url, allowShip)}\n`,
};

export const mcpCommand: CliCommand = {
  summary: 'Print the configuration that connects Claude Code, Cursor or Claude Desktop through @shapio/mcp',
  usage: MCP_USAGE,
  run: async (args, io) => {
    let values;
    try {
      ({ values } = parseArgs({
        args: [...args],
        options: {
          url: { type: 'string' },
          client: { type: 'string' },
          'allow-ship': { type: 'boolean', default: false },
        },
        strict: true,
      }));
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n\nUsage: ${MCP_USAGE}\n`);
      return 1;
    }
    const client = values.client as McpClientKind | undefined;
    if (client !== undefined && !CLIENTS.includes(client)) {
      io.stderr(`--client must be one of ${CLIENTS.join(', ')}\n`);
      return 1;
    }
    const url = (values.url ?? defaultUrl(io.env)).replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) {
      io.stderr(`--url must be an http(s) URL (got ${url})\n`);
      return 1;
    }
    const sections = (client ? [client] : CLIENTS).map((kind) => SECTIONS[kind](url, values['allow-ship']));
    io.stdout(
      `${sections.join('\n')}\nReplace ${TOKEN_PLACEHOLDER} with an admin API token (Settings → API tokens). ` +
        'Give its role no "changes.ship": the agent drafts and opens change sets, a person ships them.' +
        (values['allow-ship']
          ? ' --allow-ship only offers the ship tool; the token’s role still decides.\n'
          : '\n'),
    );
    return 0;
  },
};
