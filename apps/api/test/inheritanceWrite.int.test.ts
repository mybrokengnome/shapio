import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setPublicGrants } from './helpers/appUsers.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Writing in a family (plan polymorphic-types, D6): each route creates its own kind; an entry changed or
 * deleted through an ancestor's route is validated as its own kind; relation targets must be in the target's
 * family; write events and audit rows carry the nested route key and the ancestors.
 */
describe('model inheritance: writing in a family', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let product: ModelBody;
  let digital: ModelBody;

  const json = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T;
  const anonymous = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    testApp.app.inject({ method, url, ...(payload ? { payload: payload } : {}) });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      pluralApiKey: 'products',
      label: 'Product',
      draftAndPublish: true,
      fields: [{ apiKey: 'name', label: 'Name', type: 'string', required: true }],
    });
    digital = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'digitalProduct',
      pluralApiKey: 'digital',
      label: 'Digital',
      extends: product.definition.id,
      fields: [{ apiKey: 'url', label: 'URL', type: 'string' }],
    });
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'physicalProduct',
      pluralApiKey: 'physical',
      label: 'Physical',
      extends: product.definition.id,
      fields: [
        { apiKey: 'weight', label: 'Weight', type: 'integer' },
        {
          apiKey: 'download',
          label: 'Download',
          type: 'relation',
          settings: { target: digital.definition.id, cardinality: 'one' },
        },
      ],
    });
    // Anonymous callers may create and change products of every kind (the grant flows down, D8).
    await setPublicGrants(database.current.db, [
      { action: 'create', modelId: product.definition.id },
      { action: 'update', modelId: product.definition.id },
      { action: 'delete', modelId: product.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it("creates each route's own kind and changes an entry through its parent's route as its own kind", async () => {
    const plain = expectStatus(
      await anonymous('POST', '/api/content/products', { data: { name: 'Plain' } }),
      201,
    ).json<{ data: { id: string } }>().data;
    const created = expectStatus(
      await anonymous('POST', '/api/content/products/digital', { data: { name: 'Ebook', url: 'a.pdf' } }),
      201,
    ).json<{ data: { id: string; version: number } }>().data;
    const models = await database.current.db
      .selectFrom('entries')
      .select(['id', 'model_id'])
      .where('id', 'in', [plain.id, created.id])
      .execute();
    expect(Object.fromEntries(models.map((row) => [row.id, row.model_id]))).toEqual({
      [plain.id]: product.definition.id,
      [created.id]: digital.definition.id,
    });
    // A child's field on the parent's route is unknown there.
    expect(
      (await anonymous('POST', '/api/content/products', { data: { name: 'X', url: 'x' } })).statusCode,
    ).toBe(422);
    // Through the parent's route the entry is a Digital: its own field validates.
    const updated = expectStatus(
      await anonymous('PUT', `/api/content/products/${created.id}`, {
        expectedVersion: created.version,
        data: { url: 'b.pdf' },
      }),
      200,
    ).json<{ data: { version: number } }>().data;
    expect(updated.version).toBe(created.version + 1);
    // `__model` is never writable.
    const refused = await anonymous('PUT', `/api/content/products/${created.id}`, {
      expectedVersion: updated.version,
      data: { __model: 'product' },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({ error: { details: { issues: [{ code: 'UNKNOWN_FIELD' }] } } });
    // The admin edits it through the parent's API ID too.
    const view = expectStatus(
      await admin.put(`/api/admin/content/product/${created.id}`, {
        expectedVersion: updated.version,
        data: { url: 'c.pdf' },
      }),
      200,
    ).json<EntryBody & { model: string }>();
    expect(view).toMatchObject({ model: 'digitalProduct', data: { url: 'c.pdf' } });
    // A kind outside the route's family is not there.
    expect(
      (
        await anonymous('PUT', `/api/content/products/physical/${created.id}`, {
          expectedVersion: view.version,
          data: { name: 'Nope' },
        })
      ).statusCode,
    ).toBe(404);
    expectStatus(await anonymous('DELETE', `/api/content/products/${created.id}`), 204);
    expect(
      (
        await database.current.db
          .selectFrom('entries')
          .select('deleted_at')
          .where('id', '=', created.id)
          .executeTakeFirstOrThrow()
      ).deleted_at,
    ).not.toBeNull();
  });

  it('accepts a relation target of the target family only', async () => {
    const book = expectStatus(
      await admin.post('/api/admin/content/digitalProduct', { data: { name: 'Book' } }),
      201,
    ).json<EntryBody>();
    const crate = expectStatus(
      await admin.post('/api/admin/content/physicalProduct', { data: { name: 'Crate' } }),
      201,
    ).json<EntryBody>();
    expectStatus(
      await admin.post('/api/admin/content/physicalProduct', { data: { name: 'Box', download: book.id } }),
      201,
    );
    // A Physical is a product, but not a Digital.
    const refused = await admin.post('/api/admin/content/physicalProduct', {
      data: { name: 'Box 2', download: crate.id },
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      error: { details: { issues: [{ code: 'RELATION_TARGET_MISSING' }] } },
    });
  });

  it('writes events and audit rows with the nested route key and the ancestors', async () => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/digitalProduct', { data: { name: 'Tracked' }, publish: true }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.delete(`/api/admin/content/product/${entry.id}`), 204);
    const events = await database.current.db
      .selectFrom('outbox_events')
      .select(['type', 'payload'])
      .where('aggregate_id', '=', entry.id)
      .execute();
    expect(events.map((event) => event.type).sort()).toEqual([
      'entry.created',
      'entry.deleted',
      'entry.published',
    ]);
    for (const event of events) {
      expect(json(event.payload)).toMatchObject({
        modelKey: 'digitalProduct',
        routeKey: 'products/digital',
        ancestors: ['product'],
      });
    }
    const audit = await database.current.db
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('target_id', '=', entry.id)
      .where('action', '=', 'content.delete')
      .executeTakeFirstOrThrow();
    expect(json(audit.metadata)).toMatchObject({ modelKey: 'digitalProduct', routeKey: 'products/digital' });
  });
});
