import { parseArgs } from 'node:util';
import type { CliCommand, CliIo } from '../../types.js';
import { CONNECTION_FLAGS, resolveConnection, UsageError } from './options.js';
import { clientFor } from './sync.js';

type ScopeOptions = ReturnType<typeof resolveConnection> & {
  apiKey: string;
  shared: boolean;
  version: number | undefined;
};

const parseScopeOptions = (args: readonly string[], io: CliIo): ScopeOptions => {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      ...CONNECTION_FLAGS,
      shared: { type: 'boolean', default: false },
      version: { type: 'string' },
    },
    allowPositionals: true,
  });
  const [apiKey, ...extra] = positionals;
  if (!apiKey || extra.length > 0) {
    throw new UsageError('Name one model or component by its API ID');
  }
  if (!values.shared && !values.site) {
    throw new UsageError('Pass --site <key> to keep it on that site, or --shared to share it with all sites');
  }
  const version = values.version === undefined ? undefined : Number(values.version);
  if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
    throw new UsageError('--version must be a positive integer');
  }
  return { ...resolveConnection(values, io), apiKey, shared: values.shared, version };
};

/**
 * `shapio schema scope <apiKey> --site <key> | --shared [--site <key>]`: keeps a shared definition on one
 * site, or shares a site's definition with all sites (needs schema permission on every site). `--site`
 * names the site whose view the API ID is resolved in. Live, through the same endpoint as the admin.
 */
export const schemaScopeCommand: CliCommand = {
  summary:
    'Keep a shared model or component on one site (--site), or share a site’s with all sites (--shared)',
  usage:
    'shapio schema scope <apiKey> (--site <key> | --shared [--site <key>]) [--url <origin>] [--token <admin token>] [--version <n>]',
  run: async (args, io) => {
    const options = parseScopeOptions(args, io);
    const client = clientFor(options);
    const exported = await client.admin.schema.export();
    const siteKey = options.site ?? exported.site?.key ?? '(default)';
    const found = exported.definitions.find(({ definition }) => definition.apiKey === options.apiKey);
    if (!found) {
      io.stderr(`Site "${siteKey}" has no model or component with API ID "${options.apiKey}".\n`);
      return 1;
    }
    const api = found.definition.kind === 'component' ? client.admin.components : client.admin.models;
    const outcome = await api.changeScope(found.definition.id, {
      scope: options.shared ? 'network' : 'site',
      version: options.version ?? found.version,
    });
    const where = outcome.scope === 'network' ? 'shared with all sites' : `on site "${siteKey}" only`;
    io.stdout(
      outcome.status === 'unchanged'
        ? `${options.apiKey} is already ${where}.\n`
        : `${options.apiKey} is now ${where} (version ${outcome.version}, schema version ${outcome.schemaVersion}).\n` +
            `Pull to move its file: shapio schema pull --site ${siteKey}\n`,
    );
    return 0;
  },
};
