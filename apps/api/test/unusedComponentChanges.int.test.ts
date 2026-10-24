import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, runContentSchemaJobs, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type ChangeOutcome = { status: 'activated' | 'pending'; changeId?: string };
type ChangeBody = { status: string; error: unknown };

/**
 * A component that no type uses yet has no entries to convert, so a change that converts values (a relation's
 * new target, a field's new type) must activate without scanning anything. The scan once built `model_id in ()`
 * for the empty list of types, which PostgreSQL and MySQL reject: the change failed with a SQL error.
 */
describe('changing a field on a component that no type uses', () => {
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

  const createInterface = async (definition: Record<string, unknown>) => {
    const created = await admin.post('/api/admin/interfaces', { definition });
    expect(created.statusCode, created.body).toBe(201);
    const { definitionId } = created.json<{ definitionId: string }>();
    return (await admin.get(`/api/admin/interfaces/${definitionId}`)).json<ModelBody>();
  };
  const reload = async (id: string) => (await admin.get(`/api/admin/components/${id}`)).json<ModelBody>();

  /** Applies the component's fields, runs any background change to its end, and returns the new version. */
  const changeFields = async (current: ModelBody, fields: unknown[]) => {
    const response = await admin.put(`/api/admin/components/${current.definition.id}`, {
      definition: { ...current.definition, fields },
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect(response.statusCode, response.body).toBeLessThan(300);
    const outcome = response.json<ChangeOutcome>();
    if (outcome.status === 'pending') {
      await runContentSchemaJobs(database.current.db);
      const change = (await admin.get(`/api/admin/schema/changes/${outcome.changeId}`)).json<ChangeBody>();
      expect(change, JSON.stringify(change)).toMatchObject({ status: 'activated', error: null });
    }
    return reload(current.definition.id);
  };

  it('retargets a relation to an interface', async () => {
    const note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'ucNote',
      label: 'Notes',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
    });
    const spotlight = await createInterface({
      kind: 'interface',
      apiKey: 'ucSpotlight',
      label: 'Spotlight',
      fields: [],
    });
    const card = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'ucLinkCard',
        label: 'Link card',
        fields: [
          {
            apiKey: 'opens',
            label: 'Opens',
            type: 'relation',
            settings: { target: note.definition.id, cardinality: 'one' },
          },
        ],
      },
      'components',
    );
    const [opens] = card.definition.fields as Record<string, unknown>[];

    const changed = await changeFields(card, [
      { ...opens, settings: { target: spotlight.definition.id, cardinality: 'one' } },
    ]);

    expect(changed.version).toBe(card.version + 1);
    expect((changed.definition.fields as Record<string, unknown>[])[0]?.settings).toEqual({
      target: spotlight.definition.id,
      cardinality: 'one',
    });
  });

  it('changes a field’s type', async () => {
    const quote = await createDefinition(
      admin,
      {
        kind: 'component',
        apiKey: 'ucQuote',
        label: 'Quote',
        fields: [{ apiKey: 'rating', label: 'Rating', type: 'string' }],
      },
      'components',
    );
    const [rating] = quote.definition.fields as Record<string, unknown>[];

    const changed = await changeFields(quote, [
      { ...rating, type: 'integer', settings: {}, editor: undefined },
    ]);

    expect(changed.version).toBe(quote.version + 1);
    expect((changed.definition.fields as Record<string, unknown>[])[0]?.type).toBe('integer');
  });
});
