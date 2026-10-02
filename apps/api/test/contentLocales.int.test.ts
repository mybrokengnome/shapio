import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Delivered = { data: Record<string, unknown>; meta: { locale: string } };

/** Brief §10 locale tests and ADR 0004 (fan-out of shared fields, per-locale publishing, fallback). */
describe('content localization', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let product: ModelBody;
  let token: string;

  const deliver = (url: string) =>
    testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  const entryIn = async (id: string, locale: string) =>
    expectStatus(await admin.get(`/api/admin/content/product/${id}?locale=${locale}`), 200).json<EntryBody>();
  /** Saves a locale's draft, creating that locale's version when it has none yet. */
  const save = async (id: string, locale: string, data: Record<string, unknown>) => {
    const current = await admin.get(`/api/admin/content/product/${id}?locale=${locale}`);
    const expectedVersion = current.statusCode === 404 ? null : current.json<EntryBody>().version;
    return expectStatus(
      await admin.put(`/api/admin/content/product/${id}`, { locale, expectedVersion, data }),
      200,
    ).json<EntryBody>();
  };
  const publish = async (id: string, locales: string[]) =>
    expectStatus(
      await admin.post(`/api/admin/content/product/${id}/publish`, { locales }),
      200,
    ).json<EntryBody>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    expectStatus(
      await admin.post('/api/admin/locales', { code: 'de', label: 'German', fallbacks: ['fr'] }),
      201,
    );
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      localized: true,
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', localized: true, required: true },
        { apiKey: 'price', label: 'Price', type: 'integer' },
        { apiKey: 'sku', label: 'SKU', type: 'string', unique: true },
      ],
    });
    token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a shared field edited in one locale appears in every draft; a localized one does not', async () => {
    const created = expectStatus(
      await admin.post('/api/admin/content/product', {
        locale: 'en',
        data: { name: 'Chair', price: 10, sku: 'C-1' },
      }),
      201,
    ).json<EntryBody>();
    // Creating the French version copies the shared values.
    const fr = expectStatus(
      await admin.put(`/api/admin/content/product/${created.id}`, {
        locale: 'fr',
        expectedVersion: null,
        data: { name: 'Chaise' },
      }),
      200,
    ).json<EntryBody>();
    expect(fr.data).toEqual({ name: 'Chaise', price: 10, sku: 'C-1' });

    await save(created.id, 'fr', { price: 20, name: 'Chaise haute' });
    expect((await entryIn(created.id, 'en')).data).toEqual({ name: 'Chair', price: 20, sku: 'C-1' });
    expect((await entryIn(created.id, 'fr')).data).toEqual({ name: 'Chaise haute', price: 20, sku: 'C-1' });

    // Shared unique values register once (locale `*`): another entry cannot take the SKU in any locale.
    const clash = await admin.post('/api/admin/content/product', {
      locale: 'fr',
      data: { name: 'Autre', sku: 'C-1' },
    });
    expect(clash.json()).toMatchObject({
      error: { details: { issues: [{ path: '/sku', code: 'NOT_UNIQUE' }] } },
    });
  });

  it('serves the fallback locale and labels it', async () => {
    const created = expectStatus(
      await admin.post('/api/admin/content/product', { locale: 'en', data: { name: 'Table', price: 99 } }),
      201,
    ).json<EntryBody>();
    await publish(created.id, ['en']);
    const german = expectStatus(
      await deliver(`/api/content/products/${created.id}?locale=de`),
      200,
    ).json<Delivered>();
    expect(german).toMatchObject({ data: { locale: 'en', name: 'Table' }, meta: { locale: 'de' } });

    await save(created.id, 'fr', { name: 'Table (fr)' });
    await publish(created.id, ['fr']);
    // de falls back to fr before the default locale.
    const viaFrench = expectStatus(
      await deliver(`/api/content/products/${created.id}?locale=de`),
      200,
    ).json<Delivered>();
    expect(viaFrench.data).toMatchObject({ locale: 'fr', name: 'Table (fr)' });
    const list = expectStatus(
      await deliver('/api/content/products?locale=de&filters[name][$eq]=Table (fr)'),
      200,
    ).json<{
      data: Array<{ locale: string }>;
    }>();
    expect(list.data.map((entry) => entry.locale)).toEqual(['fr']);
  });

  it('publishing FR leaves live EN unchanged, and the admin reports EN has a newer shared value', async () => {
    const created = expectStatus(
      await admin.post('/api/admin/content/product', { locale: 'en', data: { name: 'Lamp', price: 30 } }),
      201,
    ).json<EntryBody>();
    await save(created.id, 'fr', { name: 'Lampe' });
    await publish(created.id, ['en', 'fr']);

    await save(created.id, 'fr', { price: 35 });
    const afterFr = await publish(created.id, ['fr']);
    expect(afterFr.locale).toBe('fr');
    expect(afterFr.sharedOutdatedLocales).toEqual(['en']);
    expect(afterFr.locales.find((state) => state.locale === 'en')).toMatchObject({
      sharedOutdated: true,
      status: 'modified',
    });

    const en = expectStatus(
      await deliver(`/api/content/products/${created.id}?locale=en`),
      200,
    ).json<Delivered>();
    const frLive = expectStatus(
      await deliver(`/api/content/products/${created.id}?locale=fr`),
      200,
    ).json<Delivered>();
    expect(en.data).toMatchObject({ locale: 'en', price: 30 });
    expect(frLive.data).toMatchObject({ locale: 'fr', price: 35 });

    // "Publish them too?" is one call.
    const both = await publish(created.id, ['en']);
    expect(both.sharedOutdatedLocales).toEqual([]);
    expect(
      expectStatus(await deliver(`/api/content/products/${created.id}?locale=en`), 200).json<Delivered>()
        .data,
    ).toMatchObject({
      price: 35,
    });
  });

  it('rejects unknown locales and reports a missing locale version', async () => {
    const created = expectStatus(
      await admin.post('/api/admin/content/product', { locale: 'en', data: { name: 'Desk' } }),
      201,
    ).json<EntryBody>();
    expect((await admin.get(`/api/admin/content/product/${created.id}?locale=de`)).json()).toMatchObject({
      error: { code: 'ENTRY_LOCALE_NOT_FOUND', details: { locales: ['en'] } },
    });
    expect(
      (await admin.post('/api/admin/content/product', { locale: 'xx', data: { name: 'x' } })).statusCode,
    ).toBe(400);
    expect((await deliver('/api/content/products?locale=xx')).statusCode).toBe(400);
  });

  it('deleting a locale purges its content; entries that only existed there go too', async () => {
    expectStatus(await admin.post('/api/admin/locales', { code: 'it', label: 'Italian' }), 201);
    const both = expectStatus(
      await admin.post('/api/admin/content/product', { locale: 'en', data: { name: 'Sofa' } }),
      201,
    ).json<EntryBody>();
    await save(both.id, 'it', { name: 'Divano' });
    await publish(both.id, ['it']);
    const onlyItalian = expectStatus(
      await admin.post('/api/admin/content/product', { locale: 'it', data: { name: 'Solo' } }),
      201,
    ).json<EntryBody>();

    expectStatus(await admin.delete('/api/admin/locales/it?acknowledgeDestructive=true'), 200);
    await runContentSchemaJobs(database.current.db);
    const { db } = database.current;
    expect(
      await db.selectFrom('entry_heads').select('entry_id').where('locale', '=', 'it').execute(),
    ).toEqual([]);
    expect(
      await db.selectFrom('content_revisions').select('id').where('locale', '=', 'it').execute(),
    ).toEqual([]);
    expect((await admin.get(`/api/admin/content/product/${both.id}?locale=en`)).statusCode).toBe(200);
    expect((await admin.get(`/api/admin/content/product/${onlyItalian.id}?locale=en`)).statusCode).toBe(404);
  });
});
