import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupDatabase } from '../src/db/backup.js';
import { createMigrator } from '../src/db/migrator.js';
import { createSqliteDb } from '../src/db/sqlite/index.js';
import type { DB } from '../src/db/types.js';
import { isSqliteRun } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** `shapio backup` on SQLite: `VACUUM INTO` a new file while the database stays in use. */
describe('SQLite backup', () => {
  let directory: string;
  const source = () => join(directory, 'live.db');

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'shapio-backup-'));
  });
  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('copies a consistent database that opens and migrates as it is', async () => {
    const db = createSqliteDb<DB>({ location: { kind: 'file', path: source() }, readers: 1 });
    try {
      expect((await createMigrator(db).migrateToLatest()).error).toBeUndefined();
      await db.insertInto('locales').values({ code: 'fr', label: 'Français' }).execute();
      const open = db.transaction().execute(async (trx) => {
        await trx.insertInto('locales').values({ code: 'de', label: 'Deutsch' }).execute();
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const copied = await backupDatabase(db, join(directory, 'copy.db'));
      await open;
      await expect(backupDatabase(db, copied)).rejects.toThrow(/already exists/);

      const copy = createSqliteDb<DB>({ location: { kind: 'file', path: copied }, readers: 1 });
      try {
        const codes = await copy.selectFrom('locales').select('code').orderBy('code').execute();
        expect(codes.map((row) => row.code)).toEqual(expect.arrayContaining(['en', 'fr']));
        expect((await createMigrator(copy).migrateToLatest()).results).toEqual([]);
      } finally {
        await copy.destroy();
      }
    } finally {
      await db.destroy();
    }
  });
});

describe.skipIf(isSqliteRun())('backup command on PostgreSQL', () => {
  const database = useTestDatabase();

  it('refuses and points at pg_dump', async () => {
    await expect(backupDatabase(database.current.db, join(tmpdir(), 'never.db'))).rejects.toThrow(/pg_dump/);
  });
});
