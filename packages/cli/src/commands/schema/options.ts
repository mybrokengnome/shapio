import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { LOCK_FILE_PATH } from '@shapio/schema';
import type { CliIo } from '../../types.js';

export const DEFAULT_URL = 'http://localhost:4300';
export const DEFAULT_SCHEMA_DIR = 'schema';

export type SchemaCommandOptions = {
  baseUrl: string;
  token: string;
  /** Directory holding `models/` and `components/`. */
  dir: string;
  lockPath: string;
  prune: boolean;
  allowBreaking: boolean;
  allowDestructive: boolean;
  force: boolean;
  wait: boolean;
  waitTimeoutMs: number;
};

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Shared flags of `shapio schema pull|diff|apply`. URL and token also come from SHAPIO_URL / SHAPIO_TOKEN. */
export const parseSchemaOptions = (args: readonly string[], io: CliIo): SchemaCommandOptions => {
  const { values } = parseArgs({
    args: [...args],
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
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
  const token = values.token ?? io.env.SHAPIO_TOKEN;
  if (!token) {
    throw new UsageError('An admin API token is required: pass --token or set SHAPIO_TOKEN');
  }
  const waitTimeoutSeconds = Number(values['wait-timeout'] ?? 600);
  if (!Number.isFinite(waitTimeoutSeconds) || waitTimeoutSeconds <= 0) {
    throw new UsageError('--wait-timeout must be a positive number of seconds');
  }
  return {
    baseUrl: values.url ?? io.env.SHAPIO_URL ?? DEFAULT_URL,
    token,
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

export const COMMON_USAGE =
  '[--url <origin>] [--token <admin token>] [--dir schema] [--lock .shapio/schema-lock.json]';
