import { describe, expect, it } from 'vitest';
import { SQLITE_BASELINE_COVERS, SQLITE_MIGRATIONS } from './sqlite/index.js';
import { MIGRATIONS } from './index.js';

/**
 * The twin rule (CONTRIBUTING.md): after the SQLite baseline, every PostgreSQL migration exists under the
 * same name for SQLite, as its own SQLite file or, when it declares `dialectNeutral`, as the same module.
 */
const postgresNames = Object.keys(MIGRATIONS).sort();
const afterBaseline = postgresNames.filter((name) => name > SQLITE_BASELINE_COVERS);

describe('migration twins', () => {
  it('has a baseline that covers an existing PostgreSQL migration', () => {
    expect(postgresNames).toContain(SQLITE_BASELINE_COVERS);
    expect(Object.keys(SQLITE_MIGRATIONS).sort()[0]).toBe('0001_baseline');
  });

  it('lists every later migration for SQLite under the same name, and nothing else', () => {
    const sqliteNames = Object.keys(SQLITE_MIGRATIONS)
      .filter((name) => name !== '0001_baseline')
      .sort();
    expect(sqliteNames).toEqual(afterBaseline);
  });

  it('shares dialect-neutral migrations and gives the others a SQLite twin', () => {
    for (const name of afterBaseline) {
      const postgres = MIGRATIONS[name] as { dialectNeutral?: boolean } | undefined;
      const sqlite = SQLITE_MIGRATIONS[name];
      if (postgres?.dialectNeutral === true) {
        expect(sqlite, name).toBe(postgres);
      } else {
        expect(sqlite, name).not.toBe(postgres);
      }
    }
  });
});
