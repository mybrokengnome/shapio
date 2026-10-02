import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIo } from '../../types.js';
import { typesCommand } from './index.js';

const captureIo = (env: Record<string, string> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: (t) => err.push(t), env };
  return { io, out, err };
};

describe('shapio types generate', () => {
  let server: Server;
  let baseUrl: string;
  let dir: string;
  const seen: Array<string | undefined> = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shapio-types-'));
    server = createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/docs/typescript' && req.headers.authorization === 'Bearer shp_good') {
        res.end(
          JSON.stringify({ schemaVersion: 7, source: 'export type Page = { title: string | null };\n' }),
        );
        return;
      }
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'bad token' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the declarations the server generates', async () => {
    const out = join(dir, 'nested', 'types.ts');
    const { io, out: stdout } = captureIo({ SHAPIO_TOKEN: 'shp_good' });
    expect(await typesCommand.run(['generate', '--url', baseUrl, '--out', out], io)).toBe(0);
    expect(await readFile(out, 'utf8')).toContain('export type Page');
    expect(stdout.join('')).toContain('schema version 7');
    expect(seen.at(-1)).toBe('Bearer shp_good');
  });

  it('needs a token and reports API errors', async () => {
    expect(await typesCommand.run(['generate', '--url', baseUrl], captureIo().io)).toBe(1);
    const { io, err } = captureIo();
    expect(
      await typesCommand.run(
        ['generate', '--url', baseUrl, '--token', 'shp_bad', '--out', join(dir, 'x.ts')],
        io,
      ),
    ).toBe(1);
    expect(err.join('')).toContain('INVALID_TOKEN');
  });
});
