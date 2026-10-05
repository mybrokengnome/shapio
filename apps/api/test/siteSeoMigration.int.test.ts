import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import * as postgresMigration from '../src/db/migrations/20261004130000_site_seo_settings.js';
import * as mysqlMigration from '../src/db/migrations/mysql/20261004130000_site_seo_settings.js';
import * as sqliteMigration from '../src/db/migrations/sqlite/20261004130000_site_seo_settings.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { getPermissionsVersion } from '../src/repositories/permissionsVersion.js';
import { testDialect } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const MIGRATIONS = { postgres: postgresMigration, mysql: mysqlMigration, sqlite: sqliteMigration } as const;

/**
 * `sites.seo_defaults` and the `site.settings` action (plan seo-fields), on every dialect: roles that manage
 * publishing get the new action, `down` removes both, and the permissions version moves only on a change.
 */
describe('migration: site SEO settings', () => {
  const database = useTestDatabase();
  const { up, down } = MIGRATIONS[testDialect()];

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

  it('grants site.settings to roles holding publishing.manage; down removes it and the column', async () => {
    const { db } = database.current;
    const grant = (roleId: string, action: string) => ({
      role_id: roleId,
      action,
      model_id: null,
      condition: null,
      field_ids: null,
    });
    const publisher = await adminRolesRepository.insert(
      { key: 'publisher', name: 'Publisher', description: '', kind: 'admin', is_system: false },
      db,
    );
    const reader = await adminRolesRepository.insert(
      { key: 'reader', name: 'Reader', description: '', kind: 'admin', is_system: false },
      db,
    );
    await adminRolesRepository.insertPermissionsIfAbsent(
      [grant(publisher.id, 'read'), grant(publisher.id, 'publishing.manage'), grant(reader.id, 'read')],
      db,
    );
    await db
      .updateTable('sites')
      .set({ seo_defaults: JSON.stringify({ locales: {} }) })
      .execute();

    const migrationDb = db as unknown as Kysely<unknown>;
    await down(migrationDb);
    expect(await actionsOf(publisher.id)).toEqual(['publishing.manage', 'read']);
    const before = await getPermissionsVersion(db);
    await up(migrationDb);
    expect(await actionsOf(publisher.id)).toEqual(['publishing.manage', 'read', 'site.settings']);
    expect(await actionsOf(reader.id)).toEqual(['read']);
    expect(await getPermissionsVersion(db)).toBe(before + 1);
    const sites = await db.selectFrom('sites').select('seo_defaults').execute();
    expect(sites.every((site) => site.seo_defaults === null)).toBe(true);
  });
});
