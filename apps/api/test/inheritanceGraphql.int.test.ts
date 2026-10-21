import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import * as usageRepository from '../src/repositories/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  fieldIdOf,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql, GRAPHQL_ENV } from './helpers/graphql.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type TypeInfo = {
  kind: string;
  interfaces: Array<{ name: string }> | null;
  possibleTypes: Array<{ name: string }> | null;
  fields: Array<{ name: string; type: unknown }> | null;
};

const TYPE_QUERY = `query ($name: String!) {
  __type(name: $name) {
    kind
    interfaces { name }
    possibleTypes { name }
    fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;

/**
 * GraphQL over model inheritance (plan polymorphic-types D9, WP4): interfaces per model with children, rows
 * resolved to their kind, relations to a parent, usage through an interface, the schema of a delivery token
 * granted only a child, and an unchanged schema for a model without children.
 */
describe('model inheritance: GraphQL', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let product: ModelBody;
  let digital: ModelBody;
  let physical: ModelBody;
  let order: ModelBody;
  let plain: EntryBody;
  let ebook: EntryBody;
  let chair: EntryBody;
  let purchase: EntryBody;
  let noteTypeBefore: TypeInfo;
  let noteQueryBefore: unknown;

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const gql = <T = Record<string, unknown>>(
    query: string,
    token: string,
    variables?: Record<string, unknown>,
  ) => graphql<T>(testApp.app, query, { headers: bearer(token), ...(variables ? { variables } : {}) });
  const typeOf = async (name: string, token = adminToken) =>
    dataOf(await gql<{ __type: TypeInfo | null }>(TYPE_QUERY, token, { name })).__type;
  const queryFieldOf = async (name: string, token = adminToken) =>
    (await typeOf('Query', token))?.fields?.find((field) => field.name === name);
  const names = (list: Array<{ name: string }> | null | undefined) =>
    (list ?? []).map(({ name }) => name).sort();
  const create = async (modelKey: string, data: Record<string, unknown>) => {
    const entry = expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${entry.id}/publish`, {}), 200);
    return entry;
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false, env: GRAPHQL_ENV });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [
        { apiKey: 'body', label: 'Body', type: 'string', filterable: true },
        { apiKey: 'mood', label: 'Mood', type: 'enum', settings: { values: [{ value: 'ok', label: 'OK' }] } },
      ],
    });
    // The schema of a model without children, before any family exists.
    noteTypeBefore = (await typeOf('Note')) as TypeInfo;
    noteQueryBefore = await queryFieldOf('notes');

    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      label: 'Product',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', filterable: true, sortable: true },
        { apiKey: 'price', label: 'Price', type: 'number', filterable: true, sortable: true },
        { apiKey: 'cost', label: 'Cost', type: 'number', public: false },
      ],
    });
    digital = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'digitalProduct',
      pluralApiKey: 'digital',
      label: 'Digital product',
      extends: product.definition.id,
      fields: [{ apiKey: 'fileSize', label: 'File size', type: 'integer' }],
    });
    physical = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'physicalProduct',
      pluralApiKey: 'physical',
      label: 'Physical product',
      extends: product.definition.id,
      fields: [{ apiKey: 'weight', label: 'Weight', type: 'number' }],
    });
    order = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'order',
      label: 'Order',
      fields: [
        {
          apiKey: 'item',
          label: 'Item',
          type: 'relation',
          settings: { target: product.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'downloads',
          label: 'Downloads',
          type: 'relation',
          settings: { target: digital.definition.id, cardinality: 'many' },
        },
      ],
    });
    plain = await create('product', { name: 'Gift card', price: 5, cost: 1 });
    ebook = await create('digitalProduct', { name: 'Ebook', price: 10, cost: 2, fileSize: 300 });
    chair = await create('physicalProduct', { name: 'Chair', price: 20, cost: 9, weight: 7 });
    purchase = await create('order', { item: plain.id, downloads: [ebook.id] });
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('gives a model with children an interface that each kind implements', async () => {
    const productInterface = await typeOf('ProductInterface');
    expect(productInterface?.kind).toBe('INTERFACE');
    expect(names(productInterface?.possibleTypes)).toEqual(['DigitalProduct', 'PhysicalProduct', 'Product']);
    expect(names((await typeOf('DigitalProduct'))?.interfaces)).toEqual(['Entry', 'ProductInterface']);
    expect(names((await typeOf('Product'))?.interfaces)).toEqual(['Entry', 'ProductInterface']);
    expect(await typeOf('DigitalProductInterface')).toBeNull();
    expect(JSON.stringify((await queryFieldOf('product'))?.type)).toContain('"ProductInterface"');
    expect(JSON.stringify((await queryFieldOf('digitalProduct'))?.type)).toContain('"DigitalProduct"');
    const item = (await typeOf('Order'))?.fields?.find((field) => field.name === 'item');
    expect(JSON.stringify(item?.type)).toContain('"ProductInterface"');
    // Filters over effective fields: a kind filters on inherited and own fields.
    const filter = await gql<{ __type: { inputFields: Array<{ name: string }> } }>(
      '{ __type(name: "DigitalProductFilter") { inputFields { name } } }',
      adminToken,
    );
    expect(names(dataOf(filter).__type.inputFields)).toEqual(expect.arrayContaining(['name', 'price']));
  });

  it('leaves the schema of a model without children unchanged', async () => {
    expect(await typeOf('Note')).toEqual(noteTypeBefore);
    expect(await queryFieldOf('notes')).toEqual(noteQueryBefore);
    expect(noteTypeBefore.interfaces).toEqual([{ name: 'Entry' }]);
  });

  it('reads a leaf kind with its inherited fields', async () => {
    const data = dataOf(
      await gql<{ digital: { nodes: Array<Record<string, unknown>> } }>(
        '{ digital { nodes { __typename id name price fileSize } } }',
        adminToken,
      ),
    );
    expect(data.digital.nodes).toEqual([
      { __typename: 'DigitalProduct', id: ebook.id, name: 'Ebook', price: 10, fileSize: 300 },
    ]);
  });

  it('a delivery token granted only a child sees that kind and no parent name', async () => {
    const token = await createDeliveryToken(database.current.db, [{ modelId: digital.definition.id }]);
    const productInterface = await gql('{ __type(name: "ProductInterface") { name } }', token);
    expect(dataOf(productInterface)).toEqual({ __type: null });
    const digitalType = dataOf(
      await gql<{ __type: TypeInfo }>(TYPE_QUERY, token, { name: 'DigitalProduct' }),
    ).__type;
    expect(digitalType.interfaces).toEqual([{ name: 'Entry' }]);
    expect(digitalType.fields?.map((field) => field.name)).toEqual(
      expect.arrayContaining(['name', 'price', 'fileSize']),
    );
    expect(digitalType.fields?.map((field) => field.name)).not.toContain('cost');
    const refused = await gql('{ products { totalCount } }', token);
    expect(refused.statusCode).toBe(400);
    expect(refused.body.errors?.[0]?.message).toBe('Cannot query field "products" on type "Query".');
    const read = dataOf(
      await gql<{ digital: { nodes: Array<Record<string, unknown>> } }>(
        '{ digital { nodes { id name fileSize } } }',
        token,
      ),
    );
    expect(read.digital.nodes).toEqual([{ id: ebook.id, name: 'Ebook', fileSize: 300 }]);
  });

  it('a delivery token granted the parent sees every kind, each implementing the interface', async () => {
    const token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
    const productInterface = dataOf(
      await gql<{ __type: TypeInfo }>(TYPE_QUERY, token, { name: 'ProductInterface' }),
    ).__type;
    expect(names(productInterface.possibleTypes)).toEqual(['DigitalProduct', 'PhysicalProduct', 'Product']);
    expect(productInterface.fields?.map((field) => field.name)).not.toContain('cost');
    const kind = dataOf(
      await gql<{ __type: TypeInfo }>(TYPE_QUERY, token, { name: 'PhysicalProduct' }),
    ).__type;
    expect(kind.fields?.map((field) => field.name)).toEqual(
      expect.arrayContaining(['name', 'price', 'weight']),
    );
  });

  it('counts reads through an interface against the parent and fragments against their kind', async () => {
    const token = await createDeliveryToken(database.current.db, [
      { modelId: product.definition.id },
      { modelId: order.definition.id },
    ]);
    const result = await gql(
      `{ products { nodes { name ... on DigitalProduct { fileSize } ... on PhysicalProduct { weight } } }
         orders { nodes { item { price ... on DigitalProduct { fileSize } } } } }`,
      token,
    );
    expect(result.body.errors).toBeUndefined();
    await testApp.app.usage.flush();
    const day = usageDayOf(new Date());
    const pathsOf = async (model: ModelBody) =>
      (
        await usageRepository.fieldUsageForModel(
          PRIMARY_SITE_ID,
          model.definition.id,
          day,
          database.current.db,
        )
      )
        .filter((row) => row.selection === 'explicit')
        .map((row) => row.fieldPath);
    expect(await pathsOf(product)).toContain(fieldIdOf(product, 'name'));
    expect(await pathsOf(digital)).toContain(fieldIdOf(digital, 'fileSize'));
    expect(await pathsOf(physical)).toContain(fieldIdOf(physical, 'weight'));
    const item = fieldIdOf(order, 'item');
    expect(await pathsOf(order)).toEqual(
      expect.arrayContaining([
        item,
        `${item}.${fieldIdOf(product, 'price')}`,
        `${item}.${fieldIdOf(digital, 'fileSize')}`,
      ]),
    );
  });

  it('loads relations through the family loader: a parent target as its kind, a leaf target as its type', async () => {
    const one = dataOf(
      await gql<{ order: { item: Record<string, unknown> } }>(
        `{ order(id: "${purchase.id}") { item { __typename id name } } }`,
        adminToken,
      ),
    );
    expect(one.order.item).toEqual({ __typename: 'Product', id: plain.id, name: 'Gift card' });

    const data = dataOf(
      await gql<{ order: { downloads: Array<Record<string, unknown>> } }>(
        `{ order(id: "${purchase.id}") { downloads { __typename id name fileSize } } }`,
        adminToken,
      ),
    );
    expect(data.order.downloads).toEqual([
      { __typename: 'DigitalProduct', id: ebook.id, name: 'Ebook', fileSize: 300 },
    ]);
  });

  /**
   * The cases below need WP3's family reads: list and lookup of a parent read its whole family and every
   * delivery entry carries `__model`; relation visibility checks a target in the target's family.
   */
  describe('family reads (needs WP3)', () => {
    it('lists every kind of a parent in price order, each as its own type', async () => {
      const data = dataOf(
        await gql<{ products: { nodes: Array<Record<string, unknown>>; totalCount: number } }>(
          `{ products(sort: [{ price: ASC }]) {
              totalCount
              nodes { __typename id name price
                ... on DigitalProduct { fileSize }
                ... on PhysicalProduct { weight } } } }`,
          adminToken,
        ),
      );
      expect(data.products.totalCount).toBe(3);
      expect(data.products.nodes).toEqual([
        { __typename: 'Product', id: plain.id, name: 'Gift card', price: 5 },
        { __typename: 'DigitalProduct', id: ebook.id, name: 'Ebook', price: 10, fileSize: 300 },
        { __typename: 'PhysicalProduct', id: chair.id, name: 'Chair', price: 20, weight: 7 },
      ]);
      const filtered = dataOf(
        await gql<{ products: { nodes: Array<{ id: string }> } }>(
          '{ products(filter: { price: { gte: 10 } }, sort: [{ price: ASC }], pageSize: 1, page: 2) { nodes { id } } }',
          adminToken,
        ),
      );
      expect(filtered.products.nodes).toEqual([{ id: chair.id }]);
    });

    it('looks up a child entry through the parent query', async () => {
      const data = dataOf(
        await gql<{ product: Record<string, unknown> }>(
          `{ product(id: "${chair.id}") { __typename name ... on PhysicalProduct { weight } } }`,
          adminToken,
        ),
      );
      expect(data.product).toEqual({ __typename: 'PhysicalProduct', name: 'Chair', weight: 7 });
    });

    it('resolves a relation to a parent as the target kind', async () => {
      const current = expectStatus(
        await admin.get(`/api/admin/content/order/${purchase.id}`),
        200,
      ).json<EntryBody>();
      expectStatus(
        await admin.put(`/api/admin/content/order/${purchase.id}`, {
          expectedVersion: current.version,
          data: { item: ebook.id },
        }),
        200,
      );
      expectStatus(await admin.post(`/api/admin/content/order/${purchase.id}/publish`, {}), 200);
      const data = dataOf(
        await gql<{ orders: { nodes: Array<Record<string, unknown>> } }>(
          '{ orders { nodes { item { __typename id ... on DigitalProduct { fileSize } } } } }',
          adminToken,
        ),
      );
      expect(data.orders.nodes).toEqual([
        { item: { __typename: 'DigitalProduct', id: ebook.id, fileSize: 300 } },
      ]);
    });

    it('a delivery token granted the parent lists every kind without non-public fields', async () => {
      const token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
      const data = dataOf(
        await gql<{ products: { nodes: Array<{ __typename: string }> } }>(
          '{ products(sort: [{ price: ASC }]) { nodes { __typename } } }',
          token,
        ),
      );
      expect(data.products.nodes.map((node) => node.__typename)).toEqual([
        'Product',
        'DigitalProduct',
        'PhysicalProduct',
      ]);
    });
  });
});
