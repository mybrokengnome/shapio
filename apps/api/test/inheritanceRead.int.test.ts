import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { DENIED_POLICY } from '../src/permissions/types.js';
import { writeUsageBatch } from '../src/services/usage.js';
import { usageDayOf } from '../src/usage/keys.js';
import { createAdmin, login } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createRole,
  createTokenForRole,
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

type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: { snapshot: number; pagination: { total: number } };
};

/**
 * Reading a family (plan polymorphic-types, D4, D5, D7): Products > Digital, Physical > Apparel. A route
 * lists its model and every kind below it, filtered, sorted and paged across kinds, each row in its own
 * shape with `__model`; nested routes resolve with and without IDs; a relation to Products accepts and
 * populates any kind.
 */
describe('model inheritance: reading a family', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let product: ModelBody;
  let digital: ModelBody;
  let physical: ModelBody;
  let token: string;
  const ids: Record<string, string> = {};

  const deliver = (url: string, bearer: string | null = token, options: Partial<InjectOptions> = {}) =>
    testApp.app.inject({
      method: 'GET',
      url,
      ...options,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    });
  const list = async (url: string, bearer: string | null = token) =>
    expectStatus(await deliver(url, bearer), 200).json<DeliveryList>();
  const publishNew = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, publish: true }),
      201,
    ).json<EntryBody>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    product = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      pluralApiKey: 'products',
      label: 'Product',
      fields: [
        { apiKey: 'name', label: 'Name', type: 'string', filterable: true, sortable: true },
        { apiKey: 'price', label: 'Price', type: 'integer', filterable: true, sortable: true },
      ],
      display: {},
    });
    // A relation to the parent: any kind may be its target.
    product = (
      await (async () => {
        expectStatus(
          await admin.put(`/api/admin/models/${product.definition.id}`, {
            definition: {
              ...product.definition,
              fields: [
                ...product.definition.fields,
                {
                  apiKey: 'related',
                  label: 'Related',
                  type: 'relation',
                  settings: { target: product.definition.id, cardinality: 'many' },
                },
              ],
            },
            expectedVersion: product.version,
          }),
          200,
        );
        return admin.get(`/api/admin/models/${product.definition.id}`);
      })()
    ).json<ModelBody>();
    digital = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'digitalProduct',
      pluralApiKey: 'digital',
      label: 'Digital',
      extends: product.definition.id,
      fields: [{ apiKey: 'url', label: 'URL', type: 'string' }],
    });
    physical = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'physicalProduct',
      pluralApiKey: 'physical',
      label: 'Physical',
      extends: product.definition.id,
      fields: [{ apiKey: 'weight', label: 'Weight', type: 'integer' }],
    });
    await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'apparelItem',
      pluralApiKey: 'apparel',
      label: 'Apparel',
      extends: physical.definition.id,
      fields: [{ apiKey: 'size', label: 'Size', type: 'string' }],
    });
    await runContentSchemaJobs(database.current.db);
    ids.a = (await publishNew('product', { name: 'A', price: 5 })).id;
    ids.b = (await publishNew('digitalProduct', { name: 'B', price: 10, url: 'b.pdf' })).id;
    ids.c = (await publishNew('physicalProduct', { name: 'C', price: 20, weight: 2 })).id;
    ids.d = (await publishNew('apparelItem', { name: 'D', price: 30, weight: 3, size: 'M' })).id;
    ids.e = (await publishNew('product', { name: 'E', price: 40 })).id;
    ids.f = (await publishNew('digitalProduct', { name: 'F', price: 50, url: 'f.pdf' })).id;
    // Read on Products covers every kind (D8).
    token = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('lists every kind, filtered, sorted and paged across kinds, each row in its own shape', async () => {
    const page = await list('/api/content/products?sort=price&filters[price][$gte]=10&pageSize=2&page=2');
    expect(page.meta.pagination.total).toBe(5);
    expect(page.data).toEqual([
      expect.objectContaining({
        id: ids.d,
        __model: 'apparelItem',
        name: 'D',
        price: 30,
        weight: 3,
        size: 'M',
      }),
      expect.objectContaining({ id: ids.e, __model: 'product', name: 'E', price: 40 }),
    ]);
    expect(page.data[1]).not.toHaveProperty('url');
    expect(page.data[1]).not.toHaveProperty('weight');
    const all = await list('/api/content/products?sort=price:desc&pageSize=100');
    expect(all.data.map((row) => row.name)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
    expect(all.data.map((row) => row.__model)).toEqual([
      'digitalProduct',
      'product',
      'apparelItem',
      'physicalProduct',
      'digitalProduct',
      'product',
    ]);
  });

  it("carries each row's kind lineage in __kinds and the family's kinds in meta.kinds", async () => {
    const page = await list('/api/content/products?sort=price&pageSize=100');
    const kindsOf = (id: string | undefined) => page.data.find((row) => row.id === id)?.__kinds;
    expect(kindsOf(ids.a)).toEqual(['product']);
    expect(kindsOf(ids.b)).toEqual(['product', 'digitalProduct']);
    expect(kindsOf(ids.c)).toEqual(['product', 'physicalProduct']);
    expect(kindsOf(ids.d)).toEqual(['product', 'physicalProduct', 'apparelItem']);
    const meta = (page.meta as { kinds?: unknown }).kinds;
    expect(meta).toEqual([
      { apiKey: 'product', label: 'Product', parent: null, routeKey: 'products' },
      { apiKey: 'digitalProduct', label: 'Digital', parent: 'product', routeKey: 'products/digital' },
      { apiKey: 'physicalProduct', label: 'Physical', parent: 'product', routeKey: 'products/physical' },
      {
        apiKey: 'apparelItem',
        label: 'Apparel',
        parent: 'physicalProduct',
        routeKey: 'products/physical/apparel',
      },
    ]);
    // A kind's own route lists its own subtree; a kind without kinds has no meta.kinds.
    expect((await list('/api/content/products/physical')).meta).toMatchObject({
      kinds: [
        { apiKey: 'physicalProduct', parent: 'product' },
        { apiKey: 'apparelItem', parent: 'physicalProduct' },
      ],
    });
    expect((await list('/api/content/products/digital')).meta).not.toHaveProperty('kinds');
    // The admin list reports the same kinds.
    const adminList = expectStatus(await admin.get('/api/admin/content/product?pageSize=1'), 200).json<{
      kinds?: unknown;
    }>();
    expect(adminList.kinds).toEqual(meta);
    // Never a field: not selectable, sortable or filterable, and a write naming it is refused.
    expect((await deliver('/api/content/products?fields=__kinds')).statusCode).toBe(400);
    expect((await deliver('/api/content/products?sort=__kinds')).statusCode).toBe(400);
    expect((await deliver('/api/content/products?filters[__kinds][$eq]=product')).statusCode).toBe(400);
    const write = await admin.post('/api/admin/content/product', {
      data: { name: 'K', __kinds: ['product'] },
    });
    expect(write.statusCode).toBe(422);
    expect(write.json()).toMatchObject({ error: { details: { issues: [{ code: 'UNKNOWN_FIELD' }] } } });
  });

  it('lists a kind and its own kinds under its nested route; a flat child route does not resolve', async () => {
    const digitals = await list('/api/content/products/digital?sort=price');
    expect(digitals.data.map((row) => row.name)).toEqual(['B', 'F']);
    expect(digitals.data[0]).toMatchObject({ __model: 'digitalProduct', url: 'b.pdf' });
    const physicals = await list('/api/content/products/physical?sort=price');
    expect(physicals.data.map((row) => row.__model)).toEqual(['physicalProduct', 'apparelItem']);
    expect((await list('/api/content/products/physical/apparel')).data.map((row) => row.name)).toEqual(['D']);
    expect((await deliver('/api/content/digital')).statusCode).toBe(404);
    expect((await deliver('/api/content/products/publish')).statusCode).toBe(404);
    // The encoded form resolves too.
    expect((await list('/api/content/products%2Fdigital')).data).toHaveLength(2);
  });

  it('narrows a family read to some kinds with filters[__model], the root alone included', async () => {
    const plain = await list('/api/content/products?filters[__model][$eq]=product&sort=price');
    expect(plain.data.map((row) => row.name)).toEqual(['A', 'E']);
    expect(plain.meta.pagination.total).toBe(2);
    const two = await list(
      '/api/content/products?filters[__model][$in][0]=digitalProduct&filters[__model][$in][1]=apparelItem&filters[price][$gte]=20&sort=price',
    );
    expect(two.data.map((row) => row.name)).toEqual(['D', 'F']);
    expect(two.meta.pagination.total).toBe(2);
    // A kind outside the route's family, or an unknown one, is a bad filter.
    expect((await deliver('/api/content/products/digital?filters[__model][$eq]=product')).statusCode).toBe(
      400,
    );
    expect((await deliver('/api/content/products?filters[__model][$eq]=nothing')).statusCode).toBe(400);
    expect((await deliver('/api/content/products?filters[__model][$ne]=product')).statusCode).toBe(400);
    // Never sortable, and the admin list narrows the same way.
    expect((await deliver('/api/content/products?sort=__model')).statusCode).toBe(400);
    const adminPlain = expectStatus(
      await admin.get('/api/admin/content/product?filters[__model][$eq]=product'),
      200,
    ).json<{ items: Array<{ model: string }>; pagination: { total: number } }>();
    expect(adminPlain.items.map((item) => item.model)).toEqual(['product', 'product']);
    expect(adminPlain.pagination.total).toBe(2);
  });

  it('selects only the named shared fields with fields=, and never lets __model be one', async () => {
    const page = await list('/api/content/products?fields=name&sort=price&pageSize=3');
    expect(page.data.map((row) => Object.keys(row).sort())).toEqual(
      Array.from({ length: 3 }, () => [
        '__kinds',
        '__model',
        'createdAt',
        'id',
        'locale',
        'name',
        'publishedAt',
        'updatedAt',
      ]),
    );
    expect((await deliver('/api/content/products?fields=__model')).statusCode).toBe(400);
    // A kind's own field is not a field of the parent's route.
    expect((await deliver('/api/content/products?fields=url')).statusCode).toBe(400);
  });

  it('gets an entry within the family, and 404s for a kind outside the route', async () => {
    const item = expectStatus(await deliver(`/api/content/products/${ids.b}`), 200).json<{
      data: Record<string, unknown>;
    }>();
    expect(item.data).toMatchObject({ id: ids.b, __model: 'digitalProduct', url: 'b.pdf' });
    expect((await deliver(`/api/content/products/digital/${ids.b}`)).statusCode).toBe(200);
    expect((await deliver(`/api/content/products/physical/${ids.b}`)).statusCode).toBe(404);
    expect((await deliver(`/api/content/products/physical/${ids.d}`)).statusCode).toBe(200);
    expect((await deliver(`/api/content/products/physical/apparel/${ids.d}`)).statusCode).toBe(200);
  });

  it('accepts and populates any kind through a relation to the parent', async () => {
    const holder = await publishNew('product', { name: 'Bundle', price: 99, related: [ids.b, ids.d] });
    const refused = await admin.post('/api/admin/content/product', {
      data: { name: 'Bad', related: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(refused.statusCode).toBe(422);
    const item = expectStatus(
      await deliver(`/api/content/products/${holder.id}?populate=related`),
      200,
    ).json<{ data: { related: Array<Record<string, unknown>> } }>();
    expect(item.data.related).toEqual([
      expect.objectContaining({
        id: ids.b,
        __model: 'digitalProduct',
        __kinds: ['product', 'digitalProduct'],
        url: 'b.pdf',
      }),
      expect.objectContaining({
        id: ids.d,
        __model: 'apparelItem',
        __kinds: ['product', 'physicalProduct', 'apparelItem'],
        size: 'M',
        weight: 3,
      }),
    ]);
    // Unpopulated, the IDs of every visible kind stay.
    const plain = expectStatus(await deliver(`/api/content/products/${holder.id}`), 200).json<{
      data: { related: string[] };
    }>();
    expect(plain.data.related).toEqual([ids.b, ids.d]);
    // A filter on the relation sees targets of every kind.
    const filtered = await list(`/api/content/products?filters[related][$eq]=${ids.d}`);
    expect(filtered.data.map((row) => row.id)).toEqual([holder.id]);
    expectStatus(await admin.delete(`/api/admin/content/product/${holder.id}`), 204);
  });

  it('reads the family as of a snapshot', async () => {
    const before = await list('/api/content/products?pageSize=1');
    const later = await publishNew('physicalProduct', { name: 'Later', price: 1, weight: 1 });
    const pinned = await list(`/api/content/products?snapshot=${before.meta.snapshot}&pageSize=100`);
    expect(pinned.meta.pagination.total).toBe(6);
    expect(pinned.data.map((row) => row.id)).not.toContain(later.id);
    expect((await list('/api/content/products?pageSize=100')).meta.pagination.total).toBe(7);
    expectStatus(await admin.delete(`/api/admin/content/physicalProduct/${later.id}`), 204);
  });

  it('refuses the parent route to a caller who may read one kind only, and serves that kind', async () => {
    const digitalOnly = await createDeliveryToken(database.current.db, [{ modelId: digital.definition.id }]);
    expect((await deliver('/api/content/products', digitalOnly)).statusCode).toBe(403);
    expect((await list('/api/content/products/digital', digitalOnly)).data).toHaveLength(2);
  });

  it('filters and sorts only on fields readable on every kind read (no oracle through a wider kind grant)', async () => {
    const role = await createRole(database.current.db, 'delivery', [
      { action: 'read', modelId: product.definition.id, fieldIds: [fieldIdOf(product, 'name')] },
      { action: 'read', modelId: digital.definition.id },
    ]);
    const narrow = await createTokenForRole(database.current.db, role);
    expect((await deliver('/api/content/products?filters[price][$gte]=1', narrow)).statusCode).toBe(403);
    expect((await deliver('/api/content/products?sort=price', narrow)).statusCode).toBe(403);
    expect((await deliver('/api/content/products?fields=price', narrow)).statusCode).toBe(403);
    expect((await deliver('/api/content/products/digital?filters[price][$gte]=1', narrow)).statusCode).toBe(
      200,
    );
    // Each row still shows what its own kind's grant allows.
    const rows = (await list('/api/content/products?sort=name&pageSize=100', narrow)).data;
    expect(rows.find((row) => row.id === ids.b)).toMatchObject({ price: 10, url: 'b.pdf' });
    expect(rows.find((row) => row.id === ids.a)).not.toHaveProperty('price');
  });

  it('leaves out a kind the caller may not read, without refusing the route', async () => {
    const reader = await createDeliveryToken(database.current.db, [{ modelId: product.definition.id }]);
    const permissions = testApp.app.permissions;
    const evaluate = permissions.evaluate.bind(permissions);
    const { atVersions } = permissions;
    // Requests evaluate through `atVersions` when the evaluator has it; without it they call `evaluate`.
    permissions.atVersions = undefined;
    // Grants flow down to every kind (D8), so a hidden kind needs a policy no role can express today.
    permissions.evaluate = async (actor, request, executor) =>
      request.modelId === physical.definition.id && actor.kind === 'token'
        ? DENIED_POLICY
        : evaluate(actor, request, executor);
    try {
      const rows = (await list('/api/content/products?pageSize=100', reader)).data;
      expect(rows.map((row) => row.__model).sort()).toEqual([
        'apparelItem',
        'digitalProduct',
        'digitalProduct',
        'product',
        'product',
      ]);
      expect((await deliver(`/api/content/products/${ids.c}`, reader)).statusCode).toBe(404);
    } finally {
      permissions.evaluate = evaluate;
      permissions.atVersions = atVersions;
    }
  });

  it('lists the family in the admin with each row naming its kind, and counts it on the parent', async () => {
    const page = expectStatus(
      await admin.get('/api/admin/content/product?sort=price&pageSize=100'),
      200,
    ).json<{
      items: Array<{ id: string; model: string }>;
    }>();
    expect(page.items.map((item) => item.model)).toEqual([
      'product',
      'digitalProduct',
      'physicalProduct',
      'apparelItem',
      'product',
      'digitalProduct',
    ]);
    // The admin reads and edits an entry through its parent's API ID as its own kind.
    const view = expectStatus(await admin.get(`/api/admin/content/product/${ids.b}`), 200).json<
      EntryBody & {
        model: string;
      }
    >();
    expect(view).toMatchObject({ model: 'digitalProduct', data: { url: 'b.pdf' } });
    const counts = expectStatus(await admin.get('/api/admin/content-counts'), 200).json<{
      counts: Array<{ modelKey: string; total: number }>;
    }>();
    const total = (key: string) => counts.counts.find((count) => count.modelKey === key)?.total;
    expect([
      total('product'),
      total('digitalProduct'),
      total('physicalProduct'),
      total('apparelItem'),
    ]).toEqual([6, 2, 2, 1]);
  });

  it('previews a kind through its parent route', async () => {
    const draft = expectStatus(
      await admin.post('/api/admin/content/digitalProduct', { data: { name: 'Draft', url: 'd.pdf' } }),
      201,
    ).json<EntryBody>();
    const editor = await createAdmin(database.current.db, { roleKeys: ['editor'] });
    const session = await login(testApp.app, editor);
    const { token: preview } = expectStatus(
      await testApp.app.inject({
        method: 'POST',
        url: '/api/admin/preview/tokens',
        headers: session.headers,
        payload: { modelKey: 'digitalProduct', entryId: draft.id },
      }),
      201,
    ).json<{ token: string }>();
    for (const route of ['products', 'products/digital']) {
      const item = expectStatus(
        await deliver(`/api/preview/content/${route}/${draft.id}`, preview),
        200,
      ).json<{
        data: Record<string, unknown>;
      }>();
      expect(item.data).toMatchObject({ id: draft.id, __model: 'digitalProduct', url: 'd.pdf' });
    }
    expect((await deliver(`/api/preview/content/products/physical/${draft.id}`, preview)).statusCode).toBe(
      403,
    );
    expectStatus(await admin.delete(`/api/admin/content/digitalProduct/${draft.id}`), 204);
  });

  it("counts a kind's reads of inherited fields in the parent's usage, and only those", async () => {
    const day = usageDayOf(new Date());
    const row = (modelId: string, fieldPath: string, reads: number) => ({
      day,
      siteId: PRIMARY_SITE_ID,
      modelId,
      fieldPath,
      principalKey: 'anonymous',
      selection: 'implicit' as const,
      reads,
      lastReadAt: new Date(),
    });
    await writeUsageBatch(database.current.db, {
      fieldReads: [
        row(product.definition.id, fieldIdOf(product, 'name'), 2),
        row(digital.definition.id, fieldIdOf(product, 'name'), 3),
        row(digital.definition.id, fieldIdOf(digital, 'url'), 5),
      ],
      tokenReads: [],
    });
    type Usage = { fields: Array<{ fieldPath: string; apiKeyPath: string | null; reads: number }> };
    const usageOf = async (modelId: string) =>
      expectStatus(await admin.get(`/api/admin/usage/fields?modelId=${modelId}&days=7`), 200).json<Usage>()
        .fields;
    expect(await usageOf(product.definition.id)).toEqual([
      expect.objectContaining({ apiKeyPath: 'name', reads: 5 }),
    ]);
    expect((await usageOf(digital.definition.id)).map((field) => [field.apiKeyPath, field.reads])).toEqual([
      ['url', 5],
      ['name', 3],
    ]);
  });
});
