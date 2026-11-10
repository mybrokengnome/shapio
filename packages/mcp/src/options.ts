import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

/** How the server was started: the Shapio instance, its token, and the two guards. */
export type McpOptions = {
  /** Shapio's base URL including any BASE_PATH (`SHAPIO_URL`). */
  baseUrl: string;
  /** An admin-scope API token (`SHAPIO_TOKEN`). Give its role no `changes.ship`: shipping stays with people. */
  token: string;
  /**
   * Registers `change_sets_ship`, `change_sets_approve`, and `change_sets_request_changes` (`--allow-ship`). A
   * client-side guard only: the token's role decides.
   */
  allowShip: boolean;
  /** `media_upload` reads files only under this directory (`--media-root`, default: the working directory). */
  mediaRoot: string;
  /**
   * The workspace key every request is about (`--workspace`, else `SHAPIO_WORKSPACE`), on instances with several
   * workspaces. Left out: the token's workspace (a workspace token), else the primary workspace. A workspace
   * token cannot name another workspace.
   */
  site?: string;
};

/** A workspace key as Shapio creates them (named by key in URLs, `?site=` and config). */
const SITE_KEY = /^[a-z][a-z0-9-]{0,62}$/;

export const USAGE = `Usage: shapio-mcp [--allow-ship] [--media-root <dir>] [--workspace <key>]

A Model Context Protocol server (stdio) for a Shapio instance.

Environment:
  SHAPIO_URL     Shapio's base URL, including any BASE_PATH (e.g. https://cms.example.com)
  SHAPIO_TOKEN   An admin-scope API token. Give its role no "changes.ship" permission: agents propose
                 change sets, people ship them.
  SHAPIO_WORKSPACE
                 The workspace key to work on (instances with several); --workspace overrides it.
                 Default: the token's workspace, else the primary workspace.

Options:
  --allow-ship         Offer change_sets_ship, change_sets_approve, and change_sets_request_changes (the
                       token's role must also allow changes.ship or changes.approve)
  --media-root <dir>   Directory media_upload may read files from (default: the working directory)
  --workspace <key>    The workspace to work on (overrides SHAPIO_WORKSPACE)
  -h, --help           Show this help
`;

export class OptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OptionsError';
  }
}

type Named = { name: string; value: string | undefined };

/** One key from a documented spelling and its older one; both set and different is refused, never guessed. */
const pickOne = (current: Named, older: Named): string | undefined => {
  const first = current.value?.trim() || undefined;
  const second = older.value?.trim() || undefined;
  if (first !== undefined && second !== undefined && first !== second) {
    throw new OptionsError(
      `${current.name} "${first}" and ${older.name} "${second}" name different workspaces: set one of them.`,
    );
  }
  return first ?? second;
};

/**
 * The workspace: `--workspace` (or `--site`, its name before 0.8.2), else `SHAPIO_WORKSPACE` (or `SHAPIO_SITE`).
 * The older names keep working and are left out of the help. Requests still name it with `Shapio-Site`, which
 * every Shapio server reads.
 */
export const resolveWorkspace = (
  flags: { workspace?: string | undefined; site?: string | undefined },
  env: Readonly<Record<string, string | undefined>>,
): string | undefined =>
  pickOne({ name: '--workspace', value: flags.workspace }, { name: '--site', value: flags.site }) ??
  pickOne(
    { name: 'SHAPIO_WORKSPACE', value: env.SHAPIO_WORKSPACE },
    { name: 'SHAPIO_SITE', value: env.SHAPIO_SITE },
  );

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
        workspace: { type: 'string' },
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
  const site = resolveWorkspace(parsed.values, env);
  if (site !== undefined && !SITE_KEY.test(site)) {
    throw new OptionsError(`"${site}" is not a workspace key (lower case, starting with a letter).`);
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    token,
    allowShip: parsed.values['allow-ship'],
    mediaRoot: resolve(cwd, parsed.values['media-root'] ?? '.'),
    ...(site !== undefined ? { site } : {}),
  };
};
