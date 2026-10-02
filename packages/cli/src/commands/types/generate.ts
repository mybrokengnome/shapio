import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createClient, ShapioApiError } from '@shapio/client';
import type { CliCommand } from '../../types.js';

const DEFAULT_URL = 'http://localhost:4300';
const DEFAULT_OUT = 'shapio-types.ts';

type TypesResponse = { schemaVersion: number; source: string };

/**
 * `shapio types generate`: writes TypeScript declarations for the instance's active schema into the
 * consuming project. Over HTTP with an admin API token, like the schema commands (never direct DB access).
 */
export const typesGenerateCommand: CliCommand = {
  summary: 'Write TypeScript types for the instance’s models and components',
  usage: 'shapio types generate [--url <origin>] [--token <admin token>] [--out shapio-types.ts]',
  run: async (args, io) => {
    const { values } = parseArgs({
      args: [...args],
      options: { url: { type: 'string' }, token: { type: 'string' }, out: { type: 'string' } },
      allowPositionals: false,
    });
    const token = values.token ?? io.env.SHAPIO_TOKEN;
    if (!token) {
      io.stderr('shapio types generate: an admin API token is required: pass --token or set SHAPIO_TOKEN\n');
      return 1;
    }
    const baseUrl = values.url ?? io.env.SHAPIO_URL ?? DEFAULT_URL;
    const out = resolve(values.out ?? DEFAULT_OUT);
    try {
      const { schemaVersion, source } = await createClient({ baseUrl, token }).request<TypesResponse>(
        '/api/docs/typescript',
      );
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, source, 'utf8');
      io.stdout(
        `Wrote types for schema version ${schemaVersion} to ${relative(process.cwd(), out) || out}\n`,
      );
      return 0;
    } catch (error) {
      if (error instanceof ShapioApiError) {
        io.stderr(`shapio types generate: ${error.code}: ${error.message}\n`);
        return 1;
      }
      throw error;
    }
  },
};
