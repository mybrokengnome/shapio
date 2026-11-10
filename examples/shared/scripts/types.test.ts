import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schemaVersionTokenOf } from './types.js';

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
