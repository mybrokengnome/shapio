import type { Migration } from 'kysely/migration';
import { describe, expect, it } from 'vitest';
import { MYSQL_BASELINE_COVERS, MYSQL_MIGRATIONS } from './mysql/index.js';
import { SQLITE_BASELINE_COVERS, SQLITE_MIGRATIONS } from './sqlite/index.js';
import { MIGRATIONS } from './index.js';

/**
 * The twin rule (CONTRIBUTING.md): after a dialect's baseline, every PostgreSQL migration exists under the
 * same name for that dialect, as its own file or, when it declares `dialectNeutral`, as the same module.
 */
const postgresNames = Object.keys(MIGRATIONS).sort();

const DIALECTS: ReadonlyArray<{
  name: string;
  covers: string;
  migrations: Readonly<Record<string, Migration>>;
}> = [
  { name: 'SQLite', covers: SQLITE_BASELINE_COVERS, migrations: SQLITE_MIGRATIONS },
  { name: 'MySQL', covers: MYSQL_BASELINE_COVERS, migrations: MYSQL_MIGRATIONS },
];

describe.each(DIALECTS)('migration twins ($name)', ({ name, covers, migrations }) => {
  const afterBaseline = postgresNames.filter((migration) => migration > covers);

  it('has a baseline that covers an existing PostgreSQL migration', () => {
    expect(postgresNames).toContain(covers);
    expect(Object.keys(migrations).sort()[0]).toBe('0001_baseline');
  });

  it(`lists every later migration for ${name} under the same name, and nothing else`, () => {
    const names = Object.keys(migrations)
      .filter((migration) => migration !== '0001_baseline')
      .sort();
    expect(names).toEqual(afterBaseline);
  });

  it(`shares dialect-neutral migrations and gives the others a ${name} twin`, () => {
    for (const migration of afterBaseline) {
      const postgres = MIGRATIONS[migration] as { dialectNeutral?: boolean } | undefined;
      const twin = migrations[migration];
      if (postgres?.dialectNeutral === true) {
        expect(twin, migration).toBe(postgres);
      } else {
        expect(twin, migration).not.toBe(postgres);
      }
    }
  });
});
