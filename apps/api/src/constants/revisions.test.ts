import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REVISION_REASONS } from './revisions.js';

const MIGRATIONS = join(import.meta.dirname, '..', 'db', 'migrations');

/** The widest list of reasons a migration's `content_revisions_reason_check` allows. */
const widestCheckIn = (file: string): string[] => {
  const source = readFileSync(join(MIGRATIONS, file), 'utf8');
  const lists = [...source.matchAll(/reason\W{0,3}\s+(?:in|IN)\s+\(([^)]*)\)/g)].map((match) =>
    [...(match[1] ?? '').matchAll(/'([a-z]+)'/g)].map((value) => value[1] as string),
  );
  return lists.sort((left, right) => right.length - left.length)[0] ?? [];
};

describe('revision reasons', () => {
  // The PostgreSQL migration that last widened the constraint, and the two baselines.
  it.each(['20261002180200_create_change_sets.ts', 'sqlite/0001_baseline.ts', 'mysql/0001_baseline.ts'])(
    'are exactly what the check constraint in %s allows',
    (file) => {
      expect([...widestCheckIn(file)].sort()).toEqual([...REVISION_REASONS].sort());
    },
  );
});
