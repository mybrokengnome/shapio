import { parseArgs } from 'node:util';
import { createClient, ShapioApiError, type VersionResponse } from '@shapio/client';
import type { CliCommand } from '../types.js';

const DEFAULT_URL = 'http://localhost:4300';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Whether `/api/version` answered like Shapio does (any other server answering 200 is not Shapio). */
const isShapioVersion = (value: unknown): value is VersionResponse =>
  isRecord(value) &&
  value.name === 'shapio' &&
  typeof value.version === 'string' &&
  typeof value.node === 'string';

/** `shapio status`: is a running instance (local or remote) up, migrated and which version is it. */
export const statusCommand: CliCommand = {
  summary: 'Check that a Shapio instance is ready and show its version',
  usage: 'shapio status [--url <origin>]   (defaults to $SHAPIO_URL or http://localhost:4300)',
  run: async (args, io) => {
    const { values } = parseArgs({
      args: [...args],
      options: { url: { type: 'string' } },
      allowPositionals: false,
    });
    const baseUrl = values.url ?? io.env.SHAPIO_URL ?? DEFAULT_URL;
    const client = createClient({ baseUrl });
    try {
      const version: unknown = await client.system.version();
      if (!isShapioVersion(version)) {
        io.stderr(`${baseUrl}: not a Shapio instance (unexpected answer from /api/version)\n`);
        return 1;
      }
      const ready: unknown = await client.system.ready();
      if (!isRecord(ready) || ready.status !== 'ready') {
        io.stderr(`${baseUrl}: not ready (unexpected answer from /api/ready)\n`);
        return 1;
      }
      io.stdout(`${baseUrl}: ${ready.status} (shapio ${version.version}, node ${version.node})\n`);
      return 0;
    } catch (error) {
      if (error instanceof ShapioApiError) {
        io.stderr(`${baseUrl}: ${error.code}: ${error.message}\n`);
        return 1;
      }
      io.stderr(`${baseUrl}: unreachable (${error instanceof Error ? error.message : String(error)})\n`);
      return 1;
    }
  },
};
