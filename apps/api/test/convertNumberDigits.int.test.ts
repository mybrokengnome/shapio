import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type FieldBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ChangeBody = { status: string; error?: unknown };

/**
 * A number field made decimal or big integer converts every stored number to exact digits: `1e21` and `1e-7`,
 * which `String` writes in exponent notation, used to fail the activation's check instead.
 */
describe('number → decimal and big integer over very large and very small numbers', () => {
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

  const retype = async (model: ModelBody, apiKey: string, type: string) => {
    const { editor: _editor, ...field } = model.definition.fields.find(
      (candidate) => candidate.apiKey === apiKey,
    ) as FieldBody;
    const response = await admin.put(`/api/admin/models/${model.definition.id}`, {
      definition: { ...model.definition, fields: [{ ...field, type, settings: {} }] },
      expectedVersion: model.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202]).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
    const { changeId } = response.json<{ changeId?: string }>();
    if (changeId) {
      const change = (await admin.get(`/api/admin/schema/changes/${changeId}`)).json<ChangeBody>();
      expect(change.status, JSON.stringify(change)).toBe('activated');
    }
  };

  it('converts to decimal with exact digits', async () => {
    const measure = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'measure',
      label: 'Measure',
      fields: [{ apiKey: 'amount', label: 'Amount', type: 'number' }],
    });
    const values = [1e21, 1e-7, -2.5e-8, 12.5];
    const entries = [];
    for (const amount of values) {
      entries.push(
        expectStatus(
          await admin.post('/api/admin/content/measure', { data: { amount } }),
          201,
        ).json<EntryBody>(),
      );
    }
    await retype(measure, 'amount', 'decimal');
    const read = await Promise.all(
      entries.map(async (entry) =>
        expectStatus(await admin.get(`/api/admin/content/measure/${entry.id}`), 200).json<EntryBody>(),
      ),
    );
    expect(read.map((entry) => entry.data.amount)).toEqual([
      '1000000000000000000000',
      '0.0000001',
      '-0.000000025',
      '12.5',
    ]);
  });

  it('converts to big integer with exact digits', async () => {
    const counter = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'counter',
      label: 'Counter',
      fields: [{ apiKey: 'total', label: 'Total', type: 'number' }],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/counter', { data: { total: 1e21 } }),
      201,
    ).json<EntryBody>();
    await retype(counter, 'total', 'biginteger');
    expect(
      expectStatus(await admin.get(`/api/admin/content/counter/${entry.id}`), 200).json<EntryBody>().data
        .total,
    ).toBe('1000000000000000000000');
  });
});
