import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SITE_HEADER } from '../src/constants/sites.js';
import * as schemaActivationsRepository from '../src/repositories/schemaActivations.js';
import { backfillActivationHistory } from '../src/schema/lens/history.js';
import { expectStatus, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** A crash right after the backfill's writes: `crash.next` makes the next write throw once it is done. */
const crash = vi.hoisted(() => ({ next: false }));

vi.mock('../src/repositories/schemaActivations.js', async (importOriginal) => {
  const original = await importOriginal<typeof schemaActivationsRepository>();
  return {
    ...original,
    replaceBackfilled: async (...args: Parameters<typeof original.replaceBackfilled>) => {
      await original.replaceBackfilled(...args);
      if (crash.next) {
        crash.next = false;
        throw new Error('crashed after writing a batch');
      }
    },
  };
});

/**
 * The history backfill is all or nothing (plan schema-lenses, third review): a run that fails after writing
 * leaves history as the migration left it, so a lensed read never sees a model's older revision without its
 * newer one.
 */
describe('schema lens history backfill: atomicity', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('writes nothing when the run fails after a write', async () => {
    const { db } = database.current;
    const headers = { [SITE_HEADER]: 'default' };
    const created = expectStatus(
      await admin.request({
        method: 'POST',
        url: '/api/admin/models',
        headers,
        payload: {
          definition: {
            kind: 'collection',
            apiKey: 'note',
            label: 'Note',
            fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
          },
        },
      }),
      201,
    ).json<{ definitionId: string }>();
    const model = expectStatus(
      await admin.request({ method: 'GET', url: `/api/admin/models/${created.definitionId}`, headers }),
      200,
    ).json<ModelBody>();
    expectStatus(
      await admin.request({
        method: 'PUT',
        url: `/api/admin/models/${model.definition.id}`,
        headers,
        payload: { definition: { ...model.definition, label: 'Notes' }, expectedVersion: model.version },
      }),
      200,
    );
    // What the migration leaves: the newest row only, as a backfilled baseline.
    const rows = await db
      .selectFrom('schema_activations')
      .select('schema_version')
      .where('model_id', '=', model.definition.id)
      .orderBy('schema_version')
      .execute();
    expect(rows).toHaveLength(2);
    await db
      .deleteFrom('schema_activations')
      .where('model_id', '=', model.definition.id)
      .where('schema_version', '=', rows[0]?.schema_version ?? 0)
      .execute();
    await db.updateTable('schema_activations').set({ backfilled: true }).execute();
    const before = await schemaActivationsRepository.findRowsPage(null, 1000, db);

    crash.next = true;
    await expect(backfillActivationHistory(db)).rejects.toThrow('crashed after writing a batch');
    expect(await schemaActivationsRepository.findRowsPage(null, 1000, db)).toEqual(before);

    await backfillActivationHistory(db);
    expect(await schemaActivationsRepository.findRowsPage(null, 1000, db)).toHaveLength(before.length + 1);
  });
});
