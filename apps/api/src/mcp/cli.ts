import { parseArgs } from 'node:util';
import type { CliCommand, CliIo } from '@shapio/cli';
import { SITE_KEY_PATTERN } from '../constants/sites.js';
import { createUrlBuilder } from '../helpers/publicUrl.js';

/**
 * `shapio mcp`: prints how to connect a coding agent to this instance through @shapio/mcp (a stdio MCP
 * server run with npx). Prints configuration only: it creates no token and contacts nothing.
 */
const MCP_USAGE =
  'shapio mcp [--url <Shapio URL>] [--client claude-code|cursor|claude-desktop] [--allow-ship] [--site <key>]\n' +
  '  Prints the MCP client configuration for @shapio/mcp. The URL defaults to SHAPIO_URL, then\n' +
  "  PUBLIC_URL + BASE_PATH. --site sets SHAPIO_SITE (multi-site instances; default: the token's site, else\n" +
  '  the primary site).\n' +
  '  Create an admin API token whose role has no "changes.ship" and paste it in place\n' +
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

/** What the printed configuration connects to. */
type McpTarget = { url: string; allowShip: boolean; site: string | undefined };

const SITE_KEY = new RegExp(SITE_KEY_PATTERN);

const serverArgs = ({ allowShip }: McpTarget) => ['-y', PACKAGE, ...(allowShip ? ['--allow-ship'] : [])];

const serverEnv = ({ url, site }: McpTarget): Record<string, string> => ({
  SHAPIO_URL: url,
  SHAPIO_TOKEN: TOKEN_PLACEHOLDER,
  ...(site !== undefined ? { SHAPIO_SITE: site } : {}),
});

/** The `mcpServers` JSON block Cursor and Claude Desktop read. */
const jsonConfig = (target: McpTarget) =>
  JSON.stringify(
    { mcpServers: { shapio: { command: 'npx', args: serverArgs(target), env: serverEnv(target) } } },
    null,
    2,
  );

/** `claude mcp add` flags; the token placeholder is quoted (it contains spaces). */
const claudeCodeEnv = (target: McpTarget) =>
  Object.entries(serverEnv(target))
    .map(([name, value]) =>
      value === TOKEN_PLACEHOLDER ? `--env "${name}=${value}"` : `--env ${name}=${value}`,
    )
    .join(' ');

const SECTIONS: Record<McpClientKind, (target: McpTarget) => string> = {
  'claude-code': (target) =>
    `Claude Code (run in your project):\n\n  claude mcp add shapio ${claudeCodeEnv(target)} -- npx ${serverArgs(target).join(' ')}\n`,
  cursor: (target) => `Cursor (.cursor/mcp.json in your project):\n\n${jsonConfig(target)}\n`,
  'claude-desktop': (target) =>
    `Claude Desktop (claude_desktop_config.json, then restart the app):\n\n${jsonConfig(target)}\n`,
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
          site: { type: 'string' },
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
    if (values.site !== undefined && !SITE_KEY.test(values.site)) {
      io.stderr(`--site must be a site key (lower case, starting with a letter; got ${values.site})\n`);
      return 1;
    }
    const target: McpTarget = { url, allowShip: values['allow-ship'], site: values.site };
    const sections = (client ? [client] : CLIENTS).map((kind) => SECTIONS[kind](target));
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
