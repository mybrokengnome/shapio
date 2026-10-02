import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql } from './helpers/graphql.js';
import { createRoleToken, pageDefinition, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DefinitionBody = {
  definition: {
    id: string;
    apiKey: string;
    label: string;
    fields: Array<{ id: string; apiKey: string; label: string }>;
  };
  version: number;
  hash: string;
};

describe('admin model API', () => {
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

  const createModel = async (overrides: Record<string, unknown> = {}) => {
    const response = await admin.post('/api/admin/models', { definition: pageDefinition(overrides) });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ definitionId: string; version: number; schemaVersion: number }>();
  };
  const getModel = async (id: string) => (await admin.get(`/api/admin/models/${id}`)).json<DefinitionBody>();

  it('creates a model live and bumps the global schema version', async () => {
    const before = (await admin.get('/api/admin/schema')).json<{ schemaVersion: number }>().schemaVersion;
    const created = await createModel({ apiKey: 'article', label: 'Article' });
    expect(created).toMatchObject({ status: 'activated', version: 1, schemaVersion: before + 1 });
    const model = await getModel(created.definitionId);
    expect(model).toMatchObject({
      version: 1,
      definition: { apiKey: 'article', fields: [{ apiKey: 'title' }] },
    });
    expect(model.hash).toMatch(/^sha256:/);
  });

  it('rejects invalid definitions with JSON-pointer issues', async () => {
    const response = await admin.post('/api/admin/models', {
      definition: pageDefinition({
        apiKey: 'broken',
        fields: [{ apiKey: 'id', label: 'ID', type: 'string' }],
      }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'SCHEMA_INVALID',
        details: { issues: [{ path: '/fields/0/apiKey', code: 'API_KEY_RESERVED' }] },
      },
    });
  });

  it('rejects GraphQL generated-name collisions across models', async () => {
    await createModel({ apiKey: 'product', label: 'Product' });
    const response = await admin.post('/api/admin/models', {
      definition: pageDefinition({ apiKey: 'productFilter', label: 'X' }),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { details: { issues: [{ code: 'GENERATED_NAME_COLLISION' }] } },
    });
  });

  it('a label rename is metadata-only and keeps every stable ID', async () => {
    const { definitionId } = await createModel({ apiKey: 'post', label: 'Post' });
    const current = await getModel(definitionId);
    const renamed = {
      ...current.definition,
      label: 'Blog post',
      fields: current.definition.fields.map((field) => ({ ...field, label: 'Headline' })),
    };
    const preview = await admin.post(`/api/admin/models/${definitionId}/plan`, {
      definition: renamed,
      expectedVersion: 1,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      plan: { summary: { metadataOnly: true, breaking: false, prerequisites: [] }, prerequisites: [] },
      impact: { affectedHeads: 0 },
    });
    const response = await admin.put(`/api/admin/models/${definitionId}`, {
      definition: renamed,
      expectedVersion: 1,
    });
    expect(response.statusCode, response.body).toBe(200);
    const after = await getModel(definitionId);
    expect(after.version).toBe(2);
    expect(after.definition.id).toBe(current.definition.id);
    expect(after.definition.fields.map((field) => field.id)).toEqual(
      current.definition.fields.map((field) => field.id),
    );
    expect(after.definition.fields[0]?.label).toBe('Headline');
  });

  it('an API-key rename returns a flagged breaking-change plan and needs acknowledgement', async () => {
    const { definitionId } = await createModel({ apiKey: 'event', label: 'Event' });
    const current = await getModel(definitionId);
    const renamed = {
      ...current.definition,
      fields: current.definition.fields.map((field) => ({ ...field, apiKey: 'name' })),
    };
    const preview = await admin.post(`/api/admin/models/${definitionId}/plan`, {
      definition: renamed,
      expectedVersion: 1,
    });
    expect(preview.json()).toMatchObject({
      plan: {
        summary: { breaking: true },
        changes: [{ kind: 'field.apiKey', category: 'contract', breaking: true, from: 'title', to: 'name' }],
      },
    });
    const refused = await admin.put(`/api/admin/models/${definitionId}`, {
      definition: renamed,
      expectedVersion: 1,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'SCHEMA_CHANGE_NOT_ACKNOWLEDGED' } });
    const accepted = await admin.put(`/api/admin/models/${definitionId}`, {
      definition: renamed,
      expectedVersion: 1,
      acknowledgeBreaking: true,
    });
    expect(accepted.statusCode).toBe(200);
    expect((await getModel(definitionId)).definition.fields[0]?.apiKey).toBe('name');
  });

  it('two admins changing the same model: exactly one wins, the other gets a 409', async () => {
    const { definitionId } = await createModel({ apiKey: 'faq', label: 'FAQ' });
    const current = await getModel(definitionId);
    const other = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const [a, b] = await Promise.all([
      admin.put(`/api/admin/models/${definitionId}`, {
        definition: { ...current.definition, label: 'FAQ A' },
        expectedVersion: 1,
      }),
      other.put(`/api/admin/models/${definitionId}`, {
        definition: { ...current.definition, label: 'FAQ B' },
        expectedVersion: 1,
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json()).toMatchObject({
      error: { code: 'SCHEMA_VERSION_CONFLICT', details: { expectedVersion: 1, currentVersion: 2 } },
    });
    expect((await getModel(definitionId)).version).toBe(2);
  });

  it('records the activation in the audit log and the outbox, in the same transaction', async () => {
    const { definitionId } = await createModel({ apiKey: 'audited', label: 'Audited' });
    const { db } = database.current;
    const audit = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('target_id', '=', definitionId)
      .execute();
    expect(audit).toMatchObject([
      { action: 'schema.activate', actor_type: 'token', metadata: { operation: 'create', toVersion: 1 } },
    ]);
    const events = await db
      .selectFrom('outbox_events')
      .selectAll()
      .where('aggregate_id', '=', definitionId)
      .execute();
    expect(events).toMatchObject([{ type: 'schema.activated', aggregate_type: 'model' }]);
  });

  it('keeps revisions immutable and lists them newest first', async () => {
    const { definitionId } = await createModel({ apiKey: 'history', label: 'History' });
    const current = await getModel(definitionId);
    await admin.put(`/api/admin/models/${definitionId}`, {
      definition: { ...current.definition, label: 'History 2' },
      expectedVersion: 1,
    });
    const revisions = (await admin.get(`/api/admin/models/${definitionId}/revisions`)).json<{
      items: Array<{ id: string; version: number }>;
    }>();
    expect(revisions.items.map((item) => item.version)).toEqual([2, 1]);
    await expect(
      database.current.db
        .updateTable('schema_revisions')
        .set({ hash: 'x' })
        .where('model_id', '=', definitionId)
        .execute(),
    ).rejects.toThrow(/immutable/);
    const first = await admin.get(
      `/api/admin/models/${definitionId}/revisions/${revisions.items[1]?.id ?? ''}`,
    );
    expect(first.json()).toMatchObject({ version: 1, definition: { label: 'History' } });
  });

  it('refuses to delete a model another model references, then soft-deletes and restores it by ID', async () => {
    const author = await createModel({ apiKey: 'author', label: 'Author' });
    const book = await createModel({
      apiKey: 'book',
      label: 'Book',
      fields: [
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: author.definitionId, cardinality: 'one' },
        },
      ],
    });
    const blocked = await admin.delete(`/api/admin/models/${author.definitionId}?expectedVersion=1`);
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json()).toMatchObject({
      error: { details: { issues: [{ code: 'REFERENCED_DEFINITION' }] } },
    });

    const authorDefinition = (await getModel(author.definitionId)).definition;
    expect((await admin.delete(`/api/admin/models/${book.definitionId}?expectedVersion=1`)).statusCode).toBe(
      200,
    );
    expect(
      (await admin.delete(`/api/admin/models/${author.definitionId}?expectedVersion=1`)).statusCode,
    ).toBe(200);
    expect((await admin.get(`/api/admin/models/${author.definitionId}`)).statusCode).toBe(404);

    const restored = await admin.post('/api/admin/models', { definition: authorDefinition });
    expect(restored.statusCode, restored.body).toBe(201);
    expect(restored.json()).toMatchObject({ definitionId: author.definitionId, version: 2 });
  });

  it('serves components on their own route', async () => {
    const response = await admin.post('/api/admin/components', {
      definition: {
        kind: 'component',
        apiKey: 'hero',
        label: 'Hero',
        fields: [{ apiKey: 'heading', label: 'Heading', type: 'string' }],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const { definitionId } = response.json<{ definitionId: string }>();
    expect((await admin.get(`/api/admin/components/${definitionId}`)).statusCode).toBe(200);
    expect((await admin.get(`/api/admin/models/${definitionId}`)).statusCode).toBe(404);
    const wrongKind = await admin.post('/api/admin/models', {
      definition: { kind: 'component', apiKey: 'banner', label: 'Banner', fields: [] },
    });
    expect(wrongKind.statusCode).toBe(400);
  });

  it('honours the opt-in read-only lock for admin changes', async () => {
    const { definitionId } = await createModel({ apiKey: 'locked', label: 'Locked' });
    const current = await getModel(definitionId);
    expect(
      (await admin.put('/api/admin/schema/settings', { readOnly: true, readOnlyReason: 'git only' }))
        .statusCode,
    ).toBe(200);
    const refused = await admin.put(`/api/admin/models/${definitionId}`, {
      definition: { ...current.definition, label: 'X' },
      expectedVersion: 1,
    });
    expect(refused.statusCode).toBe(423);
    expect(refused.json()).toMatchObject({
      error: { code: 'SCHEMA_READ_ONLY', details: { reason: 'git only' } },
    });
    expect((await admin.put('/api/admin/schema/settings', { readOnly: false })).statusCode).toBe(200);
  });
  it('renaming a model label and a field label keeps every value, ID and API response (brief §10)', async () => {
    const before: ModelBody = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'catalogItem',
      label: 'Catalog item',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'price', label: 'Price', type: 'integer' },
        { apiKey: 'notes', label: 'Notes', type: 'text' },
      ],
    });
    const modelId = before.definition.id;
    const deliveryToken = await createDeliveryToken(database.current.db, [{ modelId }]);
    const published = expectStatus(
      await admin.post('/api/admin/content/catalogItem', {
        data: { title: 'Lamp', price: 40, notes: 'Brass' },
      }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/catalogItem/${published.id}/publish`, {}), 200);
    const draft = expectStatus(
      await admin.post('/api/admin/content/catalogItem', { data: { title: 'Chair', price: 75 } }),
      201,
    ).json<EntryBody>();

    const deliver = (url: string) =>
      testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${deliveryToken}` } });
    const snapshotReads = async () => ({
      adminPublished: expectStatus(
        await admin.get(`/api/admin/content/catalogItem/${published.id}`),
        200,
      ).json<unknown>(),
      adminDraft: expectStatus(
        await admin.get(`/api/admin/content/catalogItem/${draft.id}`),
        200,
      ).json<unknown>(),
      adminList: expectStatus(
        await admin.get('/api/admin/content/catalogItem?sort=createdAt:asc'),
        200,
      ).json<unknown>(),
      delivered: expectStatus(
        await deliver(`/api/content/catalogItems/${published.id}`),
        200,
      ).json<unknown>(),
      deliveredList: expectStatus(await deliver('/api/content/catalogItems'), 200).json<unknown>(),
      graphql: dataOf(
        await graphql(
          testApp.app,
          `
            query ($id: ID!) {
              catalogItem(id: $id) {
                id
                title
                price
                notes
              }
            }
          `,
          { variables: { id: published.id }, headers: { authorization: `Bearer ${deliveryToken}` } },
        ),
      ),
    });
    const storedHeads = () =>
      database.current.db
        .selectFrom('entry_heads')
        .select(['entry_id', 'locale', 'state', 'data', 'change_seq'])
        .where('model_id', '=', modelId)
        .orderBy('entry_id')
        .orderBy('state')
        .execute();
    const revisionCount = async () =>
      Number(
        (
          await database.current.db
            .selectFrom('content_revisions')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .where('entry_id', 'in', [published.id, draft.id])
            .executeTakeFirstOrThrow()
        ).n,
      );

    const readsBefore = await snapshotReads();
    const headsBefore = await storedHeads();
    const revisionsBefore = await revisionCount();

    const renamed = await admin.put(`/api/admin/models/${modelId}`, {
      definition: {
        ...before.definition,
        label: 'Product',
        fields: before.definition.fields.map((field) =>
          field.apiKey === 'title' ? { ...field, label: 'Headline' } : field,
        ),
      },
      expectedVersion: before.version,
    });
    // A label is presentation only: the change activates at once, with no content work.
    expect(renamed.statusCode, renamed.body).toBe(200);
    const after = await getModel(modelId);
    expect(after.version).toBe(before.version + 1);
    expect(after.definition).toMatchObject({ id: modelId, apiKey: 'catalogItem', label: 'Product' });
    expect(after.definition.fields.map(({ id, apiKey, label }) => ({ id, apiKey, label }))).toEqual(
      before.definition.fields.map(({ id, apiKey, label }) => ({
        id,
        apiKey,
        label: apiKey === 'title' ? 'Headline' : label,
      })),
    );

    // Stored content is untouched (not even rewritten) and every API answers exactly as before.
    expect(await storedHeads()).toEqual(headsBefore);
    expect(await revisionCount()).toBe(revisionsBefore);
    expect(await snapshotReads()).toEqual(readsBefore);
  });
});

describe('admin model API authorization', () => {
  const database = useTestDatabase();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('rejects anonymous callers with 401 UNAUTHENTICATED', async () => {
    const response = await schemaClient(testApp.app, undefined).get('/api/admin/models');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects roles without schema permissions with 403', async () => {
    const editor = schemaClient(testApp.app, await createRoleToken(database.current.db, 'editor'));
    const create = await editor.post('/api/admin/models', { definition: pageDefinition() });
    expect(create.statusCode).toBe(403);
    const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const { definitionId } = (await admin.post('/api/admin/models', { definition: pageDefinition() })).json<{
      definitionId: string;
    }>();
    const model = (await editor.get(`/api/admin/models/${definitionId}`)).json<DefinitionBody>();
    // Editors can read the definition (to edit content) but not change it.
    expect(model.version).toBe(1);
    const update = await editor.put(`/api/admin/models/${definitionId}`, {
      definition: { ...model.definition, label: 'X' },
      expectedVersion: 1,
    });
    expect(update.statusCode).toBe(403);
  });
});
