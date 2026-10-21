import { randomUUID } from 'node:crypto';
import type { Kysely, Migration } from 'kysely';
import { describe, expect, it } from 'vitest';
import { migrationProviderFor } from '../src/db/migrations/index.js';
import { testDialect } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** Interfaces (plan interfaces, decision 1): `models.kind` accepts `interface`, and rolling back refuses while one exists. */
describe('migration: interface kind', () => {
  const database = useTestDatabase();

  it('accepts interface rows, and down refuses while one exists', async () => {
    const migrations = await migrationProviderFor(testDialect()).getMigrations();
    const migration = migrations['20261021120000_interface_kind'] as Migration;
    const { db } = database.current;
    const insert = (kind: string) =>
      db
        .insertInto('models')
        .values({ id: randomUUID(), kind, api_key: `probe${randomUUID().slice(0, 8)}` })
        .execute();
    const untyped = db as unknown as Kysely<unknown>;
    try {
      await insert('interface');
      await expect(migration.down?.(untyped)).rejects.toThrow(
        /Cannot roll back interfaces while models holds/,
      );

      await db.deleteFrom('models').where('kind', '=', 'interface').execute();
      await migration.down?.(untyped);
      await expect(insert('interface')).rejects.toThrow(/check|constraint/i);
      await insert('component');

      await migration.up(untyped);
      await insert('interface');
    } finally {
      await db.deleteFrom('models').where('api_key', 'like', 'probe%').execute();
    }
  });
});
