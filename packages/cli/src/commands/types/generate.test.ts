import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIo } from '../../types.js';
import { asDeclarationFile, schemaVersionTokenOf } from './generate.js';
import { typesCommand } from './index.js';

const captureIo = (env: Record<string, string> = {}) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: (t) => err.push(t), env };
  return { io, out, err };
};

const SCHEMA_ID = '9f1c2a7e-0d3b-4c55-9a51-6b3f0e2d7c11';

describe('schemaVersionTokenOf', () => {
  it('reads the SCHEMA_VERSION from the source, and nothing from an older server’s', () => {
    expect(schemaVersionTokenOf(`// x\nexport const SCHEMA_VERSION = '${SCHEMA_ID}:42' as const;\n`)).toBe(
      `${SCHEMA_ID}:42`,
    );
    expect(schemaVersionTokenOf('// Schema version 42\nexport type Page = {};\n')).toBeUndefined();
  });
});

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
      const url = new URL(req.url ?? '/', 'http://cli.test');
      if (url.pathname === '/api/docs/typescript' && req.headers.authorization === 'Bearer shp_lens') {
        const requested = url.searchParams.get('schemaVersion');
        const version = requested === null ? 9 : Number(requested.split(':')[1]);
        res.end(
          JSON.stringify({
            schemaVersion: version,
            source: `// Schema version ${version}\n\nexport const SCHEMA_VERSION = '${SCHEMA_ID}:${version}' as const;\n\nexport type Page = { title: string | null };\n`,
          }),
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

  it('writes the SCHEMA_VERSION the server sends and prints it', async () => {
    const out = join(dir, 'lens', 'types.ts');
    const { io, out: stdout } = captureIo({ SHAPIO_TOKEN: 'shp_lens' });
    expect(await typesCommand.run(['generate', '--url', baseUrl, '--out', out], io)).toBe(0);
    const source = await readFile(out, 'utf8');
    expect(source).toContain(`export const SCHEMA_VERSION = '${SCHEMA_ID}:9' as const;`);
    expect(source.startsWith('// Schema version 9\n')).toBe(true);
    expect(stdout.join('')).toContain(`schema version 9 (SCHEMA_VERSION ${SCHEMA_ID}:9)`);
  });

  it('writes a .d.ts that passes tsc --strict: the constant declared, not initialized', async () => {
    const out = join(dir, 'declared', 'shapio-types.d.ts');
    const { io, out: stdout } = captureIo({ SHAPIO_TOKEN: 'shp_lens' });
    expect(await typesCommand.run(['generate', '--url', baseUrl, '--out', out], io)).toBe(0);
    const source = await readFile(out, 'utf8');
    expect(source).toContain(`export declare const SCHEMA_VERSION: '${SCHEMA_ID}:9';`);
    expect(source).not.toContain('as const');
    expect(stdout.join('')).toContain(`(SCHEMA_VERSION ${SCHEMA_ID}:9)`);
    const program = ts.createProgram([out], { strict: true, noEmit: true, types: [] });
    expect(ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.messageText)).toEqual([]);
  });

  it('leaves a source without SCHEMA_VERSION as it is in a .d.ts', () => {
    const source = 'export type Page = { title: string | null };\n';
    expect(asDeclarationFile(source)).toBe(source);
  });

  it('renders an older version’s types with --schema-version', async () => {
    const out = join(dir, 'older.ts');
    const { io, out: stdout } = captureIo({ SHAPIO_TOKEN: 'shp_lens' });
    expect(
      await typesCommand.run(
        ['generate', '--url', baseUrl, '--out', out, '--schema-version', `${SCHEMA_ID}:4`],
        io,
      ),
    ).toBe(0);
    expect(await readFile(out, 'utf8')).toContain(`'${SCHEMA_ID}:4'`);
    expect(stdout.join('')).toContain(`(SCHEMA_VERSION ${SCHEMA_ID}:4)`);
  });

  it('says when an older server sends no SCHEMA_VERSION', async () => {
    const { io, out: stdout } = captureIo({ SHAPIO_TOKEN: 'shp_good' });
    expect(await typesCommand.run(['generate', '--url', baseUrl, '--out', join(dir, 'old.ts')], io)).toBe(0);
    expect(stdout.join('')).toContain('sent no SCHEMA_VERSION');
  });

  it('refuses an empty --schema-version', async () => {
    const { io, err } = captureIo({ SHAPIO_TOKEN: 'shp_lens' });
    expect(
      await typesCommand.run(
        ['generate', '--url', baseUrl, '--schema-version', ' ', '--out', join(dir, 'e.ts')],
        io,
      ),
    ).toBe(1);
    expect(err.join('')).toContain('--schema-version needs a schema version');
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
