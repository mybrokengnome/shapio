import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, errorCodes, graphql } from './helpers/graphql.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Thing = { id: string; title: string; author: string | null; authors: string[] };
type ThingList = { data: Thing[]; meta: { snapshot: number } };

/**
 * Relation and media filters see the IDs the response shows: a link to an unpublished entry, or a
 * force-deleted asset, never matches, and a relation into a model the caller may not read cannot be filtered
 * (REST and GraphQL share the compiler).
 */
describe('relation and media filters on hidden targets', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let both: string;
  let thingsOnly: string;
  let ada: EntryBody;
  let zola: EntryBody;
  let asset: MediaAssetBody;

  const create = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, { data }), 201).json<EntryBody>();
  const publish = async (modelKey: string, id: string) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, {}), 200);
  const deliver = (query: string, token: string) =>
    testApp.app.inject({
      method: 'GET',
      url: `/api/content/things?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
  const titles = async (query: string, token = both) =>
    expectStatus(await deliver(query, token), 200)
      .json<ThingList>()
      .data.map((thing) => thing.title)
      .sort();
  const gqlTitles = async (filter: Record<string, unknown>, token = both) =>
    dataOf(
      await graphql<{ things: { nodes: Array<{ title: string }> } }>(
        testApp.app,
        'query ($filter: ThingFilter) { things(filter: $filter) { nodes { title } } }',
        { variables: { filter }, headers: { authorization: `Bearer ${token}` } },
      ),
    )
      .things.nodes.map((thing) => thing.title)
      .sort();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    const author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const thing = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'thing',
      label: 'Thing',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'authors',
          label: 'Authors',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'many' },
        },
        { apiKey: 'cover', label: 'Cover', type: 'media' },
      ],
    });
    both = await createDeliveryToken(database.current.db, [
      { modelId: thing.definition.id },
      { modelId: author.definition.id },
    ]);
    thingsOnly = await createDeliveryToken(database.current.db, [{ modelId: thing.definition.id }]);
    asset = await uploadAsset(
      testApp.app,
      { authorization: `Bearer ${adminToken}` },
      { file: await createPng(8, 8), filename: 'cover.png', mimeType: 'image/png' },
    );

    ada = await create('author', { name: 'Ada' });
    await publish('author', ada.id);
    zola = await create('author', { name: 'Zola' });
    const first = await create('thing', { title: 'First thing', author: ada.id, authors: [ada.id, zola.id] });
    await publish('thing', first.id);
    const only = await create('thing', {
      title: 'Only zola',
      author: zola.id,
      authors: [zola.id],
      cover: asset.id,
    });
    await publish('thing', only.id);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a link to an unpublished entry never matches, and $ne/$nin agree with what is shown', async () => {
    expect(await titles(`filters[authors][$eq]=${zola.id}`)).toEqual([]);
    expect(await titles(`filters[author][$eq]=${zola.id}`)).toEqual([]);
    expect(await titles(`filters[author][$in]=${zola.id},${ada.id}`)).toEqual(['First thing']);
    expect(await titles(`filters[author][$ne]=${zola.id}`)).toEqual(['First thing', 'Only zola']);
    expect(await titles(`filters[authors][$nin]=${zola.id}`)).toEqual(['First thing', 'Only zola']);
    expect(await titles(`filters[$not][authors][$eq]=${zola.id}`)).toEqual(['First thing', 'Only zola']);
    expect(await titles(`filters[authors][$eq]=${ada.id}`)).toEqual(['First thing']);
    expect(await gqlTitles({ authors: { eq: zola.id } })).toEqual([]);
    expect(await gqlTitles({ authors: { eq: ada.id } })).toEqual(['First thing']);

    // Once Zola is published, the same filter finds both links.
    await publish('author', zola.id);
    expect(await titles(`filters[authors][$eq]=${zola.id}`)).toEqual(['First thing', 'Only zola']);
  });

  it('a relation into a model the caller may not read cannot be filtered (403)', async () => {
    for (const query of [`filters[author][$eq]=${ada.id}`, 'filters[author][$notNull]=true']) {
      const response = await deliver(query, thingsOnly);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN_FIELD' } });
    }
    const result = await graphql(
      testApp.app,
      'query ($filter: ThingFilter) { things(filter: $filter) { nodes { title } } }',
      {
        variables: { filter: { author: { eq: ada.id } } },
        headers: { authorization: `Bearer ${thingsOnly}` },
      },
    );
    expect(errorCodes(result)).toContain('FORBIDDEN_FIELD');
    expect(await titles('filters[title][$eq]=First thing', thingsOnly)).toEqual(['First thing']);
  });

  it('a force-deleted asset no longer matches, in delivery and in the admin list', async () => {
    expect(await titles(`filters[cover][$eq]=${asset.id}`)).toEqual(['Only zola']);
    const owner = await login(testApp.app, await createAdmin(database.current.db));
    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/admin/media/assets/${asset.id}?force=true`,
      headers: owner.headers,
    });
    expect(removed.statusCode).toBe(204);
    expect(await titles(`filters[cover][$eq]=${asset.id}`)).toEqual([]);
    expect(await titles(`filters[cover][$ne]=${asset.id}`)).toEqual(['First thing', 'Only zola']);
    const list = expectStatus(
      await admin.get(`/api/admin/content/thing?filters[cover][$eq]=${asset.id}`),
      200,
    ).json<{ items: unknown[] }>();
    expect(list.items).toEqual([]);
  });
});
