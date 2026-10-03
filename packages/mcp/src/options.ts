import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** How the server was started: the Shapio instance, its token, and the two guards. */
export type McpOptions = {
  /** Shapio's base URL including any BASE_PATH (`SHAPIO_URL`). */
  baseUrl: string;
  /** An admin-scope API token (`SHAPIO_TOKEN`). Give its role no `changes.ship`: shipping stays with people. */
  token: string;
  /** Registers `change_sets_ship` (`--allow-ship`). A client-side guard only: the token's role decides. */
  allowShip: boolean;
  /** `media_upload` reads files only under this directory (`--media-root`, default: the working directory). */
  mediaRoot: string;
  /**
   * The site key every request is about (`--site`, else `SHAPIO_SITE`), on multi-site instances. Left out:
   * the token's site (a site token), else the primary site. A site token cannot name another site.
   */
  site?: string;
};

/** A site key as Shapio creates them (sites are named by key in URLs, `?site=` and config). */
const SITE_KEY = /^[a-z][a-z0-9-]{0,62}$/;

export const USAGE = `Usage: shapio-mcp [--allow-ship] [--media-root <dir>] [--site <key>]

A Model Context Protocol server (stdio) for a Shapio instance.

Environment:
  SHAPIO_URL     Shapio's base URL, including any BASE_PATH (e.g. https://cms.example.com)
  SHAPIO_TOKEN   An admin-scope API token. Give its role no "changes.ship" permission: agents propose
                 change sets, people ship them.
  SHAPIO_SITE    The site key to work on (multi-site instances); --site overrides it. Default: the
                 token's site, else the primary site.

Options:
  --allow-ship         Offer the change_sets_ship tool (the token's role must also allow changes.ship)
  --media-root <dir>   Directory media_upload may read files from (default: the working directory)
  --site <key>         The site to work on (overrides SHAPIO_SITE)
  -h, --help           Show this help
`;

export class OptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionsError';
  }
}

/** Reads the command line and environment; throws OptionsError with a message meant for stderr. */
export const parseOptions = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): McpOptions | 'help' => {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        'allow-ship': { type: 'boolean', default: false },
        'media-root': { type: 'string' },
        site: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    throw new OptionsError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.help) {
    return 'help';
  }
  const baseUrl = env.SHAPIO_URL?.trim();
  const token = env.SHAPIO_TOKEN?.trim();
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    throw new OptionsError('Set SHAPIO_URL to the Shapio base URL (http:// or https://).');
  }
  if (!token) {
    throw new OptionsError('Set SHAPIO_TOKEN to an admin-scope API token.');
  }
  const site = (parsed.values.site ?? env.SHAPIO_SITE)?.trim() || undefined;
  if (site !== undefined && !SITE_KEY.test(site)) {
    throw new OptionsError(`"${site}" is not a site key (lower case, starting with a letter).`);
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    allowShip: parsed.values['allow-ship'],
    mediaRoot: resolve(cwd, parsed.values['media-root'] ?? '.'),
    ...(site !== undefined ? { site } : {}),
  };
};
