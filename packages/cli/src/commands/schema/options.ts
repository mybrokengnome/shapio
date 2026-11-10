import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LOCK_FILE_PATH } from '@shapio/schema';
import { UsageError } from '../../helpers/usageError.js';
import { resolveWorkspace, WORKSPACE_FLAGS, type WorkspaceFlagValues } from '../../helpers/workspace.js';
import type { CliIo } from '../../types.js';

export { UsageError };

export const DEFAULT_URL = 'http://localhost:4300';
export const DEFAULT_SCHEMA_DIR = 'schema';

/** Where a schema command connects: the instance, the admin API token and the workspace whose view it syncs. */
export type ConnectionOptions = {
  baseUrl: string;
  token: string;
  /**
   * The workspace key (`--workspace`, else SHAPIO_WORKSPACE; `--site` and SHAPIO_SITE also work); absent: the
   * token's workspace, else the primary workspace.
   */
  site?: string;
};

export type SchemaCommandOptions = ConnectionOptions & {
  /** Directory holding `models/`, `components/` and `sites/<key>/` (one folder per workspace). */
  dir: string;
  lockPath: string;
  prune: boolean;
  allowBreaking: boolean;
  allowDestructive: boolean;
  force: boolean;
  wait: boolean;
  waitTimeoutMs: number;
};

export const CONNECTION_FLAGS = {
  url: { type: 'string' },
  token: { type: 'string' },
  ...WORKSPACE_FLAGS,
} as const;

/** URL, token and workspace from the flags, else SHAPIO_URL / SHAPIO_TOKEN / SHAPIO_WORKSPACE. */
export const resolveConnection = (
  values: { url?: string | undefined; token?: string | undefined } & WorkspaceFlagValues,
  io: CliIo,
): ConnectionOptions => {
  const token = values.token ?? io.env.SHAPIO_TOKEN;
  if (!token) {
    throw new UsageError('An admin API token is required: pass --token or set SHAPIO_TOKEN');
  }
  const site = resolveWorkspace(values, io.env);
  return { baseUrl: values.url ?? io.env.SHAPIO_URL ?? DEFAULT_URL, token, ...(site ? { site } : {}) };
};

/** Shared flags of `shapio schema pull|diff|apply`. */
export const parseSchemaOptions = (args: readonly string[], io: CliIo): SchemaCommandOptions => {
  const { values } = parseArgs({
    args: [...args],
    options: {
      ...CONNECTION_FLAGS,
      dir: { type: 'string' },
      lock: { type: 'string' },
      prune: { type: 'boolean', default: false },
      'allow-breaking': { type: 'boolean', default: false },
      'allow-destructive': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'no-wait': { type: 'boolean', default: false },
      'wait-timeout': { type: 'string' },
    },
    allowPositionals: false,
  });
  const connection = resolveConnection(values, io);
  const waitTimeoutSeconds = Number(values['wait-timeout'] ?? 600);
  if (!Number.isFinite(waitTimeoutSeconds) || waitTimeoutSeconds <= 0) {
    throw new UsageError('--wait-timeout must be a positive number of seconds');
  }
  return {
    ...connection,
    dir: resolve(values.dir ?? DEFAULT_SCHEMA_DIR),
    lockPath: resolve(values.lock ?? LOCK_FILE_PATH),
    prune: values.prune,
    allowBreaking: values['allow-breaking'],
    allowDestructive: values['allow-destructive'],
    force: values.force,
    wait: !values['no-wait'],
    waitTimeoutMs: waitTimeoutSeconds * 1000,
  };
};

export const CONNECTION_USAGE = '[--url <origin>] [--token <admin token>] [--workspace <key>]';
export const COMMON_USAGE = `${CONNECTION_USAGE} [--dir schema] [--lock .shapio/schema-lock.json]`;
