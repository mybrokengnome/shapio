import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { describe, expect, it } from 'vitest';
import { migrationProviderFor } from '../src/db/migrations/index.js';
import { sqliteDriverOf } from '../src/db/sqlite/index.js';
import { testDialect } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Step = (db: Kysely<unknown>) => Promise<void>;

/**
 * Interfaces (plan interfaces, decision 1): `models.kind` accepts `interface`, rolling back refuses while one
 * exists, and the tables that reference `models` keep their references (SQLite rebuilds the table).
 */
describe('migration: interface kind', () => {
  const database = useTestDatabase();

  it('accepts interface rows, and down refuses while one exists', async () => {
    const migrations = await migrationProviderFor(testDialect()).getMigrations();
    const migration = migrations['20261021120000_interface_kind'] as Migration;
    const up: Step = (target) => migration.up(target);
    const down: Step = async (target) => {
      await migration.down?.(target);
    };
    const { db } = database.current;
    const untyped = db as unknown as Kysely<unknown>;
    // As the migrator runs it: SQLite rebuilds `models` with foreign keys off (sqlite/driver.ts).
    const run = (step: Step) => {
      const sqlite = sqliteDriverOf(db);
      return sqlite ? sqlite.withForeignKeysOff(() => step(untyped)) : step(untyped);
    };
    const insert = async (kind: string) => {
      const id = randomUUID();
      await db
        .insertInto('models')
        .values({ id, kind, api_key: `probe${id.slice(0, 8)}` })
        .execute();
      return id;
    };
    const insertRevision = (modelId: string) =>
      db
        .insertInto('schema_revisions')
        .values({ model_id: modelId, version: 1, definition: '{}', hash: 'h', created_by_type: 'system' })
        .execute();
    try {
      await insert('interface');
      await expect(run(down)).rejects.toThrow(/Cannot roll back interfaces while models holds/);

      await db.deleteFrom('models').where('kind', '=', 'interface').execute();
      await run(down);
      await expect(insert('interface')).rejects.toThrow(/check|constraint/i);
      await insertRevision(await insert('component'));

      await run(up);
      await insertRevision(await insert('interface'));
      await expect(insertRevision(randomUUID())).rejects.toThrow(/foreign|constraint/i);
    } finally {
      const probes = db.selectFrom('models').select('id').where('api_key', 'like', 'probe%');
      await db.deleteFrom('schema_revisions').where('model_id', 'in', probes).execute();
      await db.deleteFrom('models').where('api_key', 'like', 'probe%').execute();
    }
  });
});
