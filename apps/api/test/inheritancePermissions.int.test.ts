import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  createRole,
  createTokenForRole,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type GrantSpec,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Grants flow down a family of types (plan polymorphic-types D8): a grant on a parent applies to every
 * model that extends it, a child's own grant widens it, and nothing granted on a child reaches the parent.
 */
describe('model inheritance: permissions', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let product: ModelBody;
  let digital: ModelBody;
  let plainEntry: EntryBody;
  let digitalEntry: EntryBody;

  const clientWith = async (grants: readonly GrantSpec[]) =>
    schemaClient(
      testApp.app,
      await createTokenForRole(database.current.db, await createRole(database.current.db, 'admin', grants)),
    );

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      pluralApiKey: 'products',
      label: 'Product',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string' },
        { apiKey: 'cost', label: 'Cost', type: 'integer', public: false },
      ],
    });
    digital = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'digitalProduct',
      pluralApiKey: 'digital',
      label: 'Digital product',
      extends: product.definition.id,
      fields: [{ apiKey: 'url', label: 'URL', type: 'string' }],
    });
    plainEntry = expectStatus(
      await admin.post('/api/admin/content/product', { data: { name: 'Mug', cost: 3 }, publish: true }),
      201,
    ).json<EntryBody>();
    digitalEntry = expectStatus(
      await admin.post('/api/admin/content/digitalProduct', {
        data: { name: 'Ebook', cost: 1, url: 'a.pdf' },
        publish: true,
      }),
      201,
    ).json<EntryBody>();
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a read grant on the parent reads the child’s entries, with every field of the child', async () => {
    const reader = await clientWith([{ action: 'read', modelId: product.definition.id }]);
    const entry = expectStatus(
      await reader.get(`/api/admin/content/digitalProduct/${digitalEntry.id}`),
      200,
    ).json<EntryBody>();
    expect(entry.data).toMatchObject({ name: 'Ebook', cost: 1, url: 'a.pdf' });
    expectStatus(await reader.get(`/api/admin/content/product/${plainEntry.id}`), 200);
  });

  it('a grant on the child alone does not reach the parent', async () => {
    const reader = await clientWith([{ action: 'read', modelId: digital.definition.id }]);
    expectStatus(await reader.get(`/api/admin/content/digitalProduct/${digitalEntry.id}`), 200);
    expect((await reader.get(`/api/admin/content/product/${plainEntry.id}`)).statusCode).toBe(403);
  });

  it('a child grant widens what the parent grant shows on the child', async () => {
    const reader = await clientWith([
      { action: 'read', modelId: product.definition.id, fieldIds: [fieldIdOf(product, 'name')] },
      { action: 'read', modelId: digital.definition.id, fieldIds: [fieldIdOf(digital, 'url')] },
    ]);
    const child = expectStatus(
      await reader.get(`/api/admin/content/digitalProduct/${digitalEntry.id}`),
      200,
    ).json<EntryBody>();
    expect(Object.keys(child.data).sort()).toEqual(['name', 'url']);
    const parent = expectStatus(
      await reader.get(`/api/admin/content/product/${plainEntry.id}`),
      200,
    ).json<EntryBody>();
    expect(Object.keys(parent.data)).toEqual(['name']);
  });

  it('a grant naming a field of a child on the parent is refused', async () => {
    const response = await admin.post('/api/admin/roles', {
      key: 'parent-with-child-field',
      name: 'Parent with a child field',
      description: '',
      permissions: [
        {
          action: 'read',
          modelId: product.definition.id,
          condition: null,
          fieldIds: [fieldIdOf(digital, 'url')],
        },
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'UNKNOWN_FIELD' } });
    // A child grant may name inherited fields.
    const ok = await admin.post('/api/admin/roles', {
      key: 'child-with-inherited-field',
      name: 'Child with an inherited field',
      description: '',
      permissions: [
        {
          action: 'read',
          modelId: digital.definition.id,
          condition: null,
          fieldIds: [fieldIdOf(product, 'name')],
        },
      ],
    });
    expect(ok.statusCode).toBe(201);
  });

  it('schema management of the parent covers the child', async () => {
    const manager = await clientWith([{ action: 'schemaManage', modelId: product.definition.id }]);
    const current = expectStatus(
      await manager.get(`/api/admin/models/${digital.definition.id}`),
      200,
    ).json<ModelBody>();
    const changed = await manager.put(`/api/admin/models/${digital.definition.id}`, {
      definition: {
        ...current.definition,
        fields: [...current.definition.fields, { apiKey: 'size', label: 'Size', type: 'integer' }],
      },
      expectedVersion: current.version,
    });
    expect(changed.statusCode).toBe(200);
    const childOnly = await clientWith([{ action: 'schemaManage', modelId: digital.definition.id }]);
    const parent = await childOnly.put(`/api/admin/models/${product.definition.id}`, {
      definition: product.definition,
      expectedVersion: product.version,
    });
    expect(parent.statusCode).toBe(403);
  });

  it('a delivery token granted the parent reads the child under its nested route', async () => {
    const token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/content/products%2Fdigital/${digitalEntry.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    const { data } = response.json<{ data: Record<string, unknown> }>();
    // Public fields only: the inherited `cost` is not public.
    expect(data).toMatchObject({ name: 'Ebook', url: 'a.pdf' });
    expect(data).not.toHaveProperty('cost');
  });
});
