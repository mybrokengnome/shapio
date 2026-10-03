import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { down, up } from '../src/db/migrations/20261003120000_add_changes_ship_permission.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { getPermissionsVersion } from '../src/repositories/permissionsVersion.js';
import { dialectSkipReason, withSkipReason } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const sqliteSkip = dialectSkipReason(import.meta.url);

/** The `changes.ship` split keeps every existing role able to do what it could (agentic plan §I). */
describe.skipIf(sqliteSkip)(withSkipReason('migration: changes.ship', sqliteSkip), () => {
  const database = useTestDatabase();

  const actionsOf = async (roleId: string) =>
    (
      await database.current.db
        .selectFrom('admin_role_permissions')
        .select('action')
        .where('role_id', '=', roleId)
        .execute()
    )
      .map((row) => row.action)
      .sort();

  it('grants changes.ship to roles holding changes.manage, and down removes it', async () => {
    const { db } = database.current;
    const grant = (roleId: string, action: string) => ({
      role_id: roleId,
      action,
      model_id: null,
      condition: null,
      field_ids: null,
    });
    const manager = await adminRolesRepository.insert(
      { key: 'release-manager', name: 'Release manager', description: '', kind: 'admin', is_system: false },
      db,
    );
    const reader = await adminRolesRepository.insert(
      { key: 'reader', name: 'Reader', description: '', kind: 'admin', is_system: false },
      db,
    );
    await adminRolesRepository.insertPermissionsIfAbsent(
      [grant(manager.id, 'read'), grant(manager.id, 'changes.manage'), grant(reader.id, 'read')],
      db,
    );

    // Migrations run on an untyped Kysely (they predate the generated types they create).
    const migrationDb = db as unknown as Kysely<unknown>;
    const before = await getPermissionsVersion(db);
    await up(migrationDb);
    expect(await actionsOf(manager.id)).toEqual(['changes.manage', 'changes.ship', 'read']);
    expect(await actionsOf(reader.id)).toEqual(['read']);
    expect(await getPermissionsVersion(db)).toBe(before + 1);

    // Running it again changes nothing, so caches are not invalidated for nothing.
    await up(migrationDb);
    expect(await getPermissionsVersion(db)).toBe(before + 1);

    await down(migrationDb);
    expect(await actionsOf(manager.id)).toEqual(['changes.manage', 'read']);
    expect(await getPermissionsVersion(db)).toBe(before + 2);
    await up(migrationDb);
  });
});
