import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { schemaVersionTokenOf } from './lib/schemaVersionToken.js';

/** Run with `node --import tsx --test scripts/types.test.ts` (node:test: no test framework needed). */
const sourceWith = (token: string) => `export const SCHEMA_VERSION = '${token}' as const;\n`;

void test('takes a strict <schemaId>:<version> token', () => {
  const warnings: string[] = [];
  const token = '71e6c1ac-e8d6-45ad-8e4a-79b11ff665ba:42';
  assert.equal(
    schemaVersionTokenOf(sourceWith(token), (message) => warnings.push(message)),
    token,
  );
  assert.equal(
    schemaVersionTokenOf('export type Article = {};\n', (message) => warnings.push(message)),
    undefined,
  );
  assert.deepEqual(warnings, []);
});

void test('treats anything else as no token, with a warning, never as source', () => {
  for (const token of ["abc:1'; process.exit(1); '", 'abc:', 'abc', 'a b:1', 'abc:12345678901', 'abc:1\\x']) {
    const warnings: string[] = [];
    assert.equal(
      schemaVersionTokenOf(sourceWith(token), (message) => warnings.push(message)),
      undefined,
      token,
    );
    assert.equal(warnings.length, 1, token);
  }
});

void test('runs when invoked through a symlinked folder (never a silent no-op)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'shapio-types-'));
  try {
    const linked = join(scratch, 'scripts');
    symlinkSync(dirname(fileURLToPath(import.meta.url)), linked, 'dir');
    // Nothing listens on port 9: the script must try, fail loudly, and exit non-zero.
    const run = spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), join(linked, 'types.ts')],
      {
        cwd: scratch,
        // NODE_ENV too: a Next project types the environment with it required (this file ships in the starters).
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH ?? '',
          SHAPIO_URL: 'http://127.0.0.1:9',
          SHAPIO_TOKEN: 'shp_test',
        },
        encoding: 'utf8',
      },
    );
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, /types failed:/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
