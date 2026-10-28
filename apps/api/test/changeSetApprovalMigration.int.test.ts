import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import { APPROVAL_WORKFLOW_SETTING } from '../src/constants/approval.js';
import * as postgresMigration from '../src/db/migrations/20261028120000_change_set_approval.js';
import * as mysqlMigration from '../src/db/migrations/mysql/20261028120000_change_set_approval.js';
import * as sqliteMigration from '../src/db/migrations/sqlite/20261028120000_change_set_approval.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { getPermissionsVersion } from '../src/repositories/permissionsVersion.js';
import * as systemSettingsRepository from '../src/repositories/systemSettings.js';
import { testDialect } from './helpers/dialect.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const MIGRATIONS = { postgres: postgresMigration, mysql: mysqlMigration, sqlite: sqliteMigration } as const;

/**
 * Approval workflows on change sets (plans approval and approval-workflows), on every dialect: roles that
 * ship get `changes.approve`, the new columns start empty, and `down` removes the grant, the approval events
 * from webhook subscriptions, the instance default, the sign-offs and the columns. The permissions version
 * moves only when grants changed.
 */
describe('migration: change set approval', () => {
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

  const grant = (roleId: string, action: string) => ({
    role_id: roleId,
    action,
    model_id: null,
    condition: null,
    field_ids: null,
  });

  it('grants changes.approve to roles holding changes.ship; down removes it, the events and the columns', async () => {
    const { db } = database.current;
    const shipper = await adminRolesRepository.insert(
      { key: 'shipper', name: 'Shipper', description: '', kind: 'admin', is_system: false },
      db,
    );
    const preparer = await adminRolesRepository.insert(
      { key: 'preparer', name: 'Preparer', description: '', kind: 'admin', is_system: false },
      db,
    );
    await adminRolesRepository.insertPermissionsIfAbsent(
      [
        grant(shipper.id, 'changes.manage'),
        grant(shipper.id, 'changes.ship'),
        grant(preparer.id, 'changes.manage'),
      ],
      db,
    );
    await db
      .insertInto('webhooks')
      .values({
        name: 'Approvals',
        url: 'https://example.com/hook',
        events: [
          'change_set.approved',
          'change_set.shipped',
          'change_set.approval_stage_completed',
          'change_set.changes_requested',
        ],
        secret_encrypted: 'x',
      })
      .execute();

    const migrationDb = db as unknown as Kysely<unknown>;
    await down(migrationDb);
    expect(await actionsOf(shipper.id)).toEqual(['changes.manage', 'changes.ship']);
    const hooks = await db.selectFrom('webhooks').select('events').execute();
    expect(hooks.map((hook) => hook.events)).toEqual([['change_set.shipped']]);

    const before = await getPermissionsVersion(db);
    await up(migrationDb);
    expect(await actionsOf(shipper.id)).toEqual(['changes.approve', 'changes.manage', 'changes.ship']);
    expect(await actionsOf(preparer.id)).toEqual(['changes.manage']);
    expect(await getPermissionsVersion(db)).toBe(before + 1);

    // down and up again round-trip cleanly.
    await down(migrationDb);
    await up(migrationDb);
    const sites = await db.selectFrom('sites').select(['approval_mode', 'approval_workflow']).execute();
    expect(sites.every((site) => site.approval_mode === 'inherit' && site.approval_workflow === null)).toBe(
      true,
    );
  });

  it('starts every existing change set with no approval', async () => {
    const { db } = database.current;
    const [site] = await db.selectFrom('sites').select('id').execute();
    await db
      .insertInto('change_sets')
      .values({ site_id: site?.id ?? '', title: 'Before approval' })
      .execute();
    const [set] = await db.selectFrom('change_sets').select(['id', 'site_id']).execute();
    await db
      .insertInto('change_set_approvals')
      .values({
        change_set_id: set?.id ?? '',
        site_id: set?.site_id ?? '',
        round: 1,
        stage_index: 0,
        stage_id: 'editorial',
        decision: 'approve',
        fingerprint: 'sha256:x',
      })
      .execute();
    await systemSettingsRepository.upsertValue(
      APPROVAL_WORKFLOW_SETTING,
      '{"version":1,"workflow":null}',
      db,
    );
    const migrationDb = db as unknown as Kysely<unknown>;
    await down(migrationDb);
    expect(await systemSettingsRepository.findValue(APPROVAL_WORKFLOW_SETTING, db)).toBeUndefined();
    await up(migrationDb);
    expect(await db.selectFrom('change_set_approvals').selectAll().execute()).toEqual([]);
    const rows = await db
      .selectFrom('change_sets')
      .select([
        'approval_status',
        'approval_note',
        'approval_fingerprint',
        'approval_workflow',
        'approval_round',
        'approval_stage',
        'approved_at_ship',
      ])
      .execute();
    expect(rows).toEqual([
      {
        approval_status: 'none',
        approval_note: '',
        approval_fingerprint: null,
        approval_workflow: null,
        approval_round: 0,
        approval_stage: 0,
        approved_at_ship: null,
      },
    ]);
  });
});
