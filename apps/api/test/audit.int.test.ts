import { describe, expect, it } from 'vitest';
import { recordAudit } from '../src/services/audit.js';
import { principalFactory } from './helpers/principalFactory.js';
import { useTestDatabase } from './helpers/testDatabase.js';

describe('recordAudit', () => {
  const database = useTestDatabase();

  it('writes the actor, action, target and metadata', async () => {
    const admin = principalFactory.admin();
    await database.current.db.transaction().execute((trx) =>
      recordAudit(trx, {
        actor: admin,
        action: 'schema.activate',
        target: { type: 'model', id: 'model-1' },
        metadata: { fromVersion: 3, toVersion: 4 },
        requestId: 'req-1',
      }),
    );
    const row = await database.current.db
      .selectFrom('audit_events')
      .selectAll()
      .where('request_id', '=', 'req-1')
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      actor_type: 'admin',
      actor_id: admin.adminUserId,
      action: 'schema.activate',
      target_type: 'model',
      target_id: 'model-1',
      outcome: 'success',
      metadata: { fromVersion: 3, toVersion: 4 },
    });
  });

  it('rolls back with the audited change', async () => {
    const { db } = database.current;
    await expect(
      db.transaction().execute(async (trx) => {
        await recordAudit(trx, {
          actor: principalFactory.system('scheduler'),
          action: 'change_set.ship',
          requestId: 'rb',
        });
        throw new Error('ship failed');
      }),
    ).rejects.toThrow('ship failed');
    expect(await db.selectFrom('audit_events').where('request_id', '=', 'rb').selectAll().execute()).toEqual(
      [],
    );
  });

  it.each([
    [principalFactory.appUser(), 'app_user'],
    [principalFactory.token(), 'token'],
    [principalFactory.anonymous(), 'anonymous'],
    [principalFactory.system('worker'), 'system'],
  ] as const)('maps %o to actor_type %s', async (actor, actorType) => {
    const { id } = await recordAudit(database.current.db, { actor, action: 'test.map', outcome: 'failure' });
    const row = await database.current.db
      .selectFrom('audit_events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ actor_type: actorType, outcome: 'failure' });
  });
});
