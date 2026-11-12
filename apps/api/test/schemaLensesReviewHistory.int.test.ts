import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OLDER_CLIENT_HISTORY_STEPS_CAP } from '../src/services/changeSetReviewOlderClients.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
  expectStatus,
  runContentSchemaJobs,
  type ModelBody,
} from './helpers/content.js';
import type { TestApp } from './helpers/createTestApp.js';
import { createPublishingTestApp } from './helpers/publishing.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type OlderField = {
  fieldId: string;
  apiKey: string;
  effect: string;
  proposedEffect?: string;
  pastEffect?: string;
  pastSince?: number | null;
};
type OlderDefinition = { definitionId: string; fields: OlderField[]; historyTruncated?: boolean };
type Review = {
  olderClients: { versions: Array<{ schemaVersion: number; definitions: OlderDefinition[] }> } | null;
};
type Definition = ModelBody['definition'];
type Field = Definition['fields'][number];

/**
 * The review's older-clients effects account for what activations did to stored VALUES, not only for the
 * shapes at both ends (plan schema-lenses; counterexamples D and D2 of content/lens/lens.property.test.ts): a
 * step that dropped values, or cut a list to its first item, is reported even when the two shapes agree.
 */
describe('schema lenses: older clients and the history of stored values', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;

  /** A model, a token that reads it naming today's version, and that version. */
  const setUp = async (apiKey: string, fields: Array<Record<string, unknown>>) => {
    const model = await createDefinition(admin, {
      kind: 'collection',
      apiKey,
      pluralApiKey: `${apiKey}s`,
      label: apiKey,
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }, ...fields],
    });
    const token = await createTokenForRole(
      database.current.db,
      await createRole(database.current.db, 'delivery', [
        { action: 'read', modelId: model.definition.id },
        { action: 'read', modelId: author.definition.id },
      ]),
    );
    const read = (query = '') =>
      testApp.app.inject({
        method: 'GET',
        url: `/api/content/${apiKey}s${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
    const v = expectStatus(await read(), 200).headers['shapio-schema-version-current'] as string;
    expectStatus(await read(`?schemaVersion=${encodeURIComponent(v)}`), 200);
    await testApp.app.usage.flush();
    return { model, version: Number(v.split(':')[1]) };
  };
  const reload = async (model: ModelBody) =>
    expectStatus(await admin.get(`/api/admin/models/${model.definition.id}`), 200).json<ModelBody>();
  const withField = (definition: Definition, apiKey: string, patch: (field: Field) => Field) => ({
    ...definition,
    fields: definition.fields.map((field) => (field.apiKey === apiKey ? patch(field) : field)),
  });
  /** Makes a change live, as an earlier activation. */
  const changeLive = async (
    model: ModelBody,
    update: (definition: Definition) => Record<string, unknown>,
  ) => {
    const current = await reload(model);
    const response = await admin.put(`/api/admin/models/${current.definition.id}`, {
      definition: update(current.definition),
      expectedVersion: current.version,
      acknowledgeBreaking: true,
      acknowledgeDestructive: true,
    });
    expect([200, 202], response.body).toContain(response.statusCode);
    await runContentSchemaJobs(database.current.db);
  };
  /** The change set review of a proposal for the model, at the client's version. */
  const reviewAt = async (
    model: ModelBody,
    version: number,
    propose: (definition: Definition) => Record<string, unknown>,
  ) => {
    const current = await reload(model);
    const set = expectStatus(
      await admin.post('/api/admin/change-sets', { title: `Review ${Math.random()}` }),
      201,
    ).json<{ id: string }>();
    expectStatus(
      await admin.put(`/api/admin/change-sets/${set.id}/schema/${current.definition.id}`, {
        category: 'model',
        definition: propose(current.definition),
        baseVersion: current.version,
      }),
      200,
    );
    const review = expectStatus(
      await admin.get(`/api/admin/change-sets/${set.id}/review`),
      200,
    ).json<Review>();
    return review.olderClients?.versions
      .find((entry) => entry.schemaVersion === version)
      ?.definitions.find((definition) => definition.definitionId === model.definition.id);
  };
  const fieldOf = (definition: OlderDefinition | undefined, apiKey: string) =>
    definition?.fields.find((field) => field.apiKey === apiKey);
  const retitle = (definition: Definition) =>
    withField(definition, 'title', (field) => ({ ...field, apiKey: 'heading' }));

  beforeAll(async () => {
    testApp = await createPublishingTestApp(database.current);
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('D: a type change that drops every stored value reads empty, not converted', async () => {
    const { model, version } = await setUp('priced', [{ apiKey: 'price', label: 'Price', type: 'string' }]);
    const definition = await reviewAt(model, version, (current) =>
      withField(current, 'price', ({ editor: _editor, ...field }) => ({
        ...field,
        type: 'number',
        settings: {},
      })),
    );
    expect(fieldOf(definition, 'price')).toMatchObject({
      effect: 'nulled',
      proposedEffect: 'nulled',
      pastEffect: 'transparent',
    });
  });

  it('D2: a list an earlier activation cut to its first item reads some values empty, blamed on the past', async () => {
    const many = { target: author.definition.id, cardinality: 'many' };
    const { model, version } = await setUp('linked', [
      { apiKey: 'links', label: 'Links', type: 'relation', settings: many },
    ]);
    await changeLive(model, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: { ...many, cardinality: 'one' } })),
    );
    // The schema version the cut went live at.
    const cutAt = Number(
      (
        await database.current.db
          .selectFrom('schema_activations')
          .select((eb) => eb.fn.max('schema_version').as('version'))
          .where('model_id', '=', model.definition.id)
          .executeTakeFirstOrThrow()
      ).version,
    );
    await changeLive(model, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: many })),
    );
    // The proposal only renames another field: the loss is not its doing.
    const definition = await reviewAt(model, version, retitle);
    expect(fieldOf(definition, 'links')).toMatchObject({
      effect: 'lossy',
      pastEffect: 'lossy',
      pastSince: cutAt,
      proposedEffect: 'transparent',
    });
    expect(definition?.historyTruncated).toBe(false);
  });

  it('walks at most a fixed number of steps, then reports the direct effect and says so', async () => {
    const many = { target: author.definition.id, cardinality: 'many' };
    const { model, version } = await setUp('busy', [
      { apiKey: 'links', label: 'Links', type: 'relation', settings: many },
    ]);
    await changeLive(model, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: { ...many, cardinality: 'one' } })),
    );
    await changeLive(model, (current) =>
      withField(current, 'links', (field) => ({ ...field, settings: many })),
    );
    for (let step = 0; step < OLDER_CLIENT_HISTORY_STEPS_CAP; step += 1) {
      await changeLive(model, (current) =>
        withField(current, 'title', (field) => ({ ...field, label: `Title ${step}` })),
      );
    }
    const definition = await reviewAt(model, version, retitle);
    expect(definition?.historyTruncated).toBe(true);
    // The shapes at both ends agree: the direct effect, as stated.
    expect(fieldOf(definition, 'links')).toBeUndefined();
  });
});
