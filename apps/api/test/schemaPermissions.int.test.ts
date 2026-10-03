import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPermissionEvaluator } from '../src/permissions/evaluator.js';
import type { Grant } from '../src/permissions/policy.js';
import { createSchemaFieldVisibility } from '../src/schema/fieldVisibility.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { principalFactory } from './helpers/principalFactory.js';
import { createRoleToken, pageDefinition, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ModelBody = {
  definition: { fields: Array<{ id: string; apiKey: string } & Record<string, unknown>> } & Record<
    string,
    unknown
  >;
  version: number;
};

describe('field visibility from the schema registry (public flags)', () => {
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

  const readEverything: Grant = {
    roleId: 'delivery-role',
    action: 'read',
    modelId: null,
    condition: null,
    fieldIds: null,
  };

  it('masks public: false and deprecated fields for delivery principals through the real evaluator', async () => {
    const created = await admin.post('/api/admin/models', {
      definition: pageDefinition({
        fields: [
          { apiKey: 'title', label: 'Title', type: 'string' },
          { apiKey: 'internalNotes', label: 'Notes', type: 'text', public: false },
          { apiKey: 'legacy', label: 'Legacy', type: 'string', deprecated: true },
        ],
      }),
    });
    const { definitionId } = created.json<{ definitionId: string }>();
    const model = (await admin.get(`/api/admin/models/${definitionId}`)).json<ModelBody>();
    const [title, notes] = model.definition.fields;

    const evaluator = createPermissionEvaluator({
      grants: { getGrants: async () => [readEverything], getSiteAppRoleIds: async () => [] },
      fields: createSchemaFieldVisibility(testApp.app.schemaRegistry),
    });
    const delivery = principalFactory.token({ scope: 'delivery', roleId: 'delivery-role' });
    const policy = await evaluator.evaluate(delivery, { action: 'read', modelId: definitionId });
    expect(policy).toMatchObject({ allowed: true, readMask: { mode: 'only', fieldIds: [title?.id] } });

    const adminPolicy = await evaluator.evaluate(
      principalFactory.token({ scope: 'admin', roleId: 'delivery-role' }),
      {
        action: 'read',
        modelId: definitionId,
      },
    );
    expect(adminPolicy.readMask).toEqual({ mode: 'all' });

    // Making the field public is visible to the very next evaluation: the lookup checks the durable version.
    const published = {
      ...model.definition,
      fields: model.definition.fields.map((field) =>
        field.apiKey === 'internalNotes' ? { ...field, public: true } : field,
      ),
    };
    expect(
      (await admin.put(`/api/admin/models/${definitionId}`, { definition: published, expectedVersion: 1 }))
        .statusCode,
    ).toBe(200);
    const after = await evaluator.evaluate(delivery, { action: 'read', modelId: definitionId });
    expect(after.readMask).toEqual({ mode: 'only', fieldIds: [title?.id, notes?.id] });
  });

  it('is the lookup the app wires into its own evaluator, and knows nothing of components or unknown IDs', async () => {
    const created = await admin.post('/api/admin/components', {
      definition: {
        kind: 'component',
        apiKey: 'quote',
        label: 'Quote',
        fields: [{ apiKey: 'text', label: 'Text', type: 'text' }],
      },
    });
    const { definitionId } = created.json<{ definitionId: string }>();
    expect(await testApp.app.schemaLookup.getModelFields(definitionId)).toBeUndefined();
    expect(
      await testApp.app.schemaLookup.getModelFields('00000000-0000-4000-8000-0000000000ff'),
    ).toBeUndefined();
    const models = (await admin.get('/api/admin/models')).json<{
      items: Array<{ definition: { id: string } }>;
    }>();
    const modelId = models.items[0]?.definition.id ?? '';
    expect(await testApp.app.schemaLookup.getModelFields(modelId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ public: true })]),
    );
  });
});
