import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type RemovalImpact = { affectedHeads: number; deletedEntries: number; movedEntries: number };

/**
 * Deleting a locale (ADR 0004): entries of non-localized models stored in it move to the default locale;
 * entries of localized models that only existed in it are deleted like a normal delete (event, unique values
 * released); entries that merely lose it keep only the unique values their other locales hold.
 */
describe('deleting a locale', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let tag: ModelBody;
  let product: ModelBody;
  let token: string;

  const deliver = (url: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const setDefault = async (code: string) =>
    expectStatus(await admin.post(`/api/admin/locales/${code}/default`, { acknowledgeBreaking: true }), 200);
  const create = async (modelKey: string, body: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, body), 201).json<EntryBody>();
  const outboxFor = (entryId: string, type: string) =>
    database.current.db
      .selectFrom('outbox_events')
      .select('payload')
      .where('aggregate_id', '=', entryId)
      .where('type', '=', type)
      .execute();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    tag = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'tag',
      label: 'Tag',
      localized: false,
      fields: [{ apiKey: 'name', label: 'Name', type: 'string', unique: true }],
    });
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      localized: true,
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', localized: true },
        { apiKey: 'sku', label: 'SKU', type: 'string', unique: true },
      ],
    });
    token = await createDeliveryToken(database.current.db, [
      { modelId: tag.definition.id },
      { modelId: product.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('moves a non-localized entry created while that locale was the default to the new default', async () => {
    expectStatus(await admin.post('/api/admin/locales', { code: 'pt', label: 'Portuguese' }), 201);
    await setDefault('pt');
    const created = await create('tag', { publish: true, data: { name: 'pt-made' } });
    expect(created.locale).toBe('pt');
    await setDefault('en');
    const edited = expectStatus(
      await admin.put(`/api/admin/content/tag/${created.id}`, {
        expectedVersion: created.version,
        data: { name: 'pt-edited' },
      }),
      200,
    ).json<EntryBody>();
    expect(edited.locale).toBe('pt');

    // Nothing is lost, so no acknowledgement is needed; the plan says what moves.
    const deleted = expectStatus(await admin.delete('/api/admin/locales/pt'), 200).json<RemovalImpact>();
    expect(deleted).toEqual({ code: 'pt', affectedHeads: 0, deletedEntries: 0, movedEntries: 1 });
    await runContentSchemaJobs(database.current.db);

    const read = expectStatus(await admin.get(`/api/admin/content/tag/${created.id}`), 200).json<EntryBody>();
    expect(read).toMatchObject({ locale: 'en', data: { name: 'pt-edited' } });
    const live = expectStatus(await deliver(`/api/content/tags/${created.id}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(live.data).toMatchObject({ name: 'pt-made' });
    const entry = await database.current.db
      .selectFrom('entries')
      .select('deleted_at')
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(entry.deleted_at).toBeNull();
    expect(await outboxFor(created.id, 'entry.deleted')).toEqual([]);

    // Its history (written under the deleted locale) can still be restored, and it still publishes.
    const restored = expectStatus(
      await admin.post(`/api/admin/content/tag/${created.id}/revisions/${created.revisionId}/restore`, {
        expectedVersion: read.version,
      }),
      200,
    ).json<EntryBody>();
    expect(restored).toMatchObject({ locale: 'en', data: { name: 'pt-made' } });
    expectStatus(await admin.post(`/api/admin/content/tag/${created.id}/publish`, {}), 200);

    // Its unique value is still its own.
    const duplicate = await admin.post('/api/admin/content/tag', { data: { name: 'pt-made' } });
    expect(duplicate.statusCode).toBe(422);
  });

  it('deletes entries that only existed in the locale like a normal delete, and releases what others held through it', async () => {
    expectStatus(await admin.post('/api/admin/locales', { code: 'it', label: 'Italian' }), 201);
    const onlyItalian = await create('product', {
      locale: 'it',
      publish: true,
      data: { name: 'Solo', sku: 'SOLO-1' },
    });
    const both = await create('product', { locale: 'en', data: { name: 'Sofa', sku: 'SOFA-1' } });
    expectStatus(
      await admin.put(`/api/admin/content/product/${both.id}`, {
        locale: 'it',
        expectedVersion: null,
        data: { name: 'Divano' },
      }),
      200,
    );
    expectStatus(await admin.post(`/api/admin/content/product/${both.id}/publish`, { locales: ['it'] }), 200);
    const skuId = fieldIdOf(product, 'sku');
    const publishedSku = () =>
      database.current.db
        .selectFrom('unique_values')
        .select('entry_id')
        .where('field_id', '=', skuId)
        .where('state', '=', 'published')
        .where('entry_id', '=', both.id)
        .execute();
    expect(await publishedSku()).toHaveLength(1);

    const refused = await admin.delete('/api/admin/locales/it');
    expect(refused.statusCode).toBe(409);
    const impact = { affectedHeads: 4, deletedEntries: 1, movedEntries: 0 };
    expect(refused.json()).toMatchObject({ error: { details: { plan: { impact } } } });
    const deleted = expectStatus(
      await admin.delete('/api/admin/locales/it?acknowledgeDestructive=true'),
      200,
    ).json<RemovalImpact>();
    expect(deleted).toEqual({ code: 'it', ...impact });
    await runContentSchemaJobs(database.current.db);

    expect((await admin.get(`/api/admin/content/product/${onlyItalian.id}`)).statusCode).toBe(404);
    expect((await outboxFor(onlyItalian.id, 'entry.deleted')).map((row) => row.payload)).toEqual([
      {
        modelId: product.definition.id,
        modelKey: 'product',
        // A root model's route key is its plural; it has no ancestors (plan polymorphic-types).
        routeKey: 'products',
        ancestors: [],
        // The routes of the interfaces it implements (plan interfaces): none.
        interfaces: [],
        entryId: onlyItalian.id,
        wasPublished: true,
        snapshot: null,
        locale: 'it',
        reason: 'localeRemoved',
      },
    ]);
    // Its unique value is free again, as after a normal delete.
    await create('product', { locale: 'en', data: { name: 'Again', sku: 'SOLO-1' } });

    // The other entry keeps its English draft, but no longer holds a published SKU.
    expect((await admin.get(`/api/admin/content/product/${both.id}?locale=en`)).statusCode).toBe(200);
    expect(await publishedSku()).toEqual([]);
  });

  it('releases the shared unique values a kind inherits, like its parent’s own', async () => {
    const furniture = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'furniture',
      label: 'Furniture',
      localized: true,
      extends: product.definition.id,
      fields: [{ apiKey: 'material', label: 'Material', type: 'string', localized: true }],
    });
    expect(furniture.definition.fields.some((field) => field.unique)).toBe(false);
    expectStatus(await admin.post('/api/admin/locales', { code: 'de', label: 'German' }), 201);
    const chair = await create('furniture', { locale: 'en', data: { name: 'Chair', sku: 'CHAIR-1' } });
    expectStatus(
      await admin.put(`/api/admin/content/furniture/${chair.id}`, {
        locale: 'de',
        expectedVersion: null,
        data: { name: 'Stuhl' },
      }),
      200,
    );
    expectStatus(
      await admin.post(`/api/admin/content/furniture/${chair.id}/publish`, { locales: ['de'] }),
      200,
    );
    const publishedSku = () =>
      database.current.db
        .selectFrom('unique_values')
        .select('locale')
        .where('field_id', '=', fieldIdOf(product, 'sku'))
        .where('state', '=', 'published')
        .where('entry_id', '=', chair.id)
        .execute();
    expect(await publishedSku()).toEqual([{ locale: '*' }]);

    expectStatus(await admin.delete('/api/admin/locales/de?acknowledgeDestructive=true'), 200);
    await runContentSchemaJobs(database.current.db);

    // The English draft stays; the published SKU was held only through German, so it is released.
    expect((await admin.get(`/api/admin/content/furniture/${chair.id}?locale=en`)).statusCode).toBe(200);
    expect(await publishedSku()).toEqual([]);
  });
});
