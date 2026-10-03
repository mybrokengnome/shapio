import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/migrations/index.js';
import { getPendingMigrations, migrateToLatest } from '../src/db/migrator.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { silentLogger } from './helpers/silentLogger.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const sqliteSkip = dialectSkipReason(import.meta.url);

describe.skipIf(sqliteSkip)(withSkipReason('startup migrations', sqliteSkip), () => {
  const database = useTestDatabase({ empty: true });

  it('applies every migration exactly once when several instances start together', async () => {
    const instances = Array.from({ length: 4 }, () =>
      createDb({ connectionString: database.current.url, poolMax: 3 }),
    );
    try {
      const results = await Promise.all(instances.map((db) => migrateToLatest(db, silentLogger)));

      const applied = results.flat().filter((result) => result.status === 'Success');
      expect(applied.map((result) => result.migrationName).sort()).toEqual(Object.keys(MIGRATIONS).sort());
      expect(await getPendingMigrations(database.current.db)).toEqual([]);
      const { rows } = await sql<{ count: string }>`select count(*) as count from kysely_migration`.execute(
        database.current.db,
      );
      expect(Number(rows[0]?.count)).toBe(Object.keys(MIGRATIONS).length);
    } finally {
      await Promise.all(instances.map((db) => db.destroy()));
    }
  });

  it('seeds the system_versions singleton and rejects a second row', async () => {
    const { db } = database.current;
    const versions = await db.selectFrom('system_versions').selectAll().execute();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ schema_version: 0, permissions_version: 0 });
    await expect(db.insertInto('system_versions').values({ id: false }).execute()).rejects.toThrow();
  });
});
