import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { createContentHooks } from '../src/content/hooks.js';
import { createEntry } from '../src/services/contentEntries.js';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Model inheritance foundation (plan polymorphic-types, WP1): a child created through the admin API sees its
 * parent's fields, an entry of the child stores an inherited field, and a parent change makes a write pinned
 * to the old schema fail the write guard even though the child's own version did not move.
 */
describe('model inheritance: foundation', () => {
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

  const context = (snapshot: Awaited<ReturnType<typeof testApp.app.schemaRegistry.getSnapshot>>) => ({
    db: database.current.db,
    snapshot: snapshot.forSite(PRIMARY_SITE_ID),
    permissions: testApp.app.permissions,
    actor: testApp.principalFactory.system('test'),
    site: { id: PRIMARY_SITE_ID, key: 'default' },
    hooks: createContentHooks(),
  });

  it('creates a child, writes an inherited field and guards against a stale ancestor', async () => {
    const product: ModelBody = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'product',
      pluralApiKey: 'products',
      label: 'Product',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const digital = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'digitalProduct',
      pluralApiKey: 'digital',
      label: 'Digital product',
      extends: product.definition.id,
      fields: [{ apiKey: 'downloadUrl', label: 'Download URL', type: 'string' }],
    });
    // The stored definition keeps its own fields; the parent is a reference.
    expect(digital.definition).toMatchObject({ extends: product.definition.id });
    expect(digital.definition.fields.map((field) => field.apiKey)).toEqual(['downloadUrl']);

    const entry = expectStatus(
      await admin.post('/api/admin/content/digitalProduct', {
        data: { name: 'Ebook', downloadUrl: 'a.pdf' },
      }),
      201,
    ).json<EntryBody>();
    expect(entry.data).toMatchObject({ name: 'Ebook', downloadUrl: 'a.pdf' });
    const head = await database.current.db
      .selectFrom('entry_heads')
      .select(['model_id', 'data'])
      .where('entry_id', '=', entry.id)
      .executeTakeFirstOrThrow();
    expect(head.model_id).toBe(digital.definition.id);
    const nameId = product.definition.fields[0]?.id as string;
    expect(head.data).toMatchObject({ [nameId]: 'Ebook' });

    // A parent that has a child cannot be deleted.
    const refused = await admin.delete(
      `/api/admin/models/${product.definition.id}?expectedVersion=${product.version}&acknowledgeBreaking=true`,
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'HAS_CHILDREN' } });

    // A write validated against the schema before a parent change: the child's version is unchanged, the
    // parent's moved, so the guard refuses it.
    const stale = await testApp.app.schemaRegistry.getSnapshot();
    expectStatus(
      await admin.put(`/api/admin/models/${product.definition.id}`, {
        definition: {
          ...product.definition,
          fields: [...product.definition.fields, { apiKey: 'tagline', label: 'Tagline', type: 'string' }],
        },
        expectedVersion: product.version,
      }),
      200,
    );
    const current = await testApp.app.schemaRegistry.getSnapshot();
    expect(current.byId.get(digital.definition.id)?.version).toBe(
      stale.byId.get(digital.definition.id)?.version,
    );
    await expect(
      createEntry(context(stale), 'digitalProduct', { data: { name: 'Stale', downloadUrl: 'b.pdf' } }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SCHEMA_CHANGED' });

    // Against the current schema the child has the new inherited field.
    const fresh = await createEntry(context(current), 'digitalProduct', {
      data: { name: 'Fresh', tagline: 'New', downloadUrl: 'c.pdf' },
    });
    expect(fresh.data).toMatchObject({ name: 'Fresh', tagline: 'New', downloadUrl: 'c.pdf' });
  });
});
