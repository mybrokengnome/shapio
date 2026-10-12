import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dataOf, graphql } from './helpers/graphql.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Thing = { title: string } & Record<'author' | 'authors' | 'cover', unknown>;
type ThingList = { data: Thing[]; meta: { snapshot: number } };

const REFERENCE_FIELDS = ['author', 'authors', 'cover'] as const;

/** What the response shows as null: no value, or an empty list once hidden targets are left out. */
const shownAsNull = (value: unknown) =>
  value === null || value === undefined || (Array.isArray(value) && value.length === 0);

/**
 * `$null`/`$notNull` on relation and media fields agree with what the response shows (issue #82): a value
 * whose targets are all hidden (unpublished, outside the locale chain, filtered out by the target's row
 * filter, a force-deleted asset) counts as null. Each check derives the expected sets from the unfiltered
 * response of the same read, so filter and projection are compared directly.
 */
describe('$null and $notNull on relation and media fields', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let adminToken: string;
  let both: string;
  let rowFiltered: string;
  let ada: EntryBody;
  let lost: MediaAssetBody;

  const create = async (modelKey: string, data: Record<string, unknown>, locale?: string) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}`, { data, ...(locale ? { locale } : {}) }),
      201,
    ).json<EntryBody>();
  const publish = async (modelKey: string, id: string, locales?: string[]) =>
    expectStatus(
      await admin.post(`/api/admin/content/${modelKey}/${id}/publish`, locales ? { locales } : {}),
      200,
    );
  const deliver = async (query: string, token: string) =>
    expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/things?pageSize=100&${query}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<ThingList>();
  const titles = async (query: string, token: string) =>
    (await deliver(query, token)).data.map((thing) => thing.title).sort();

  /** Every reference field: `$null=true`, `$notNull=true` and `$null=false` match what the read shows. */
  const expectParity = async (query: string, token: string) => {
    const all = (await deliver(query, token)).data;
    for (const field of REFERENCE_FIELDS) {
      const nulls = all
        .filter((thing) => shownAsNull(thing[field]))
        .map((thing) => thing.title)
        .sort();
      const values = all
        .filter((thing) => !shownAsNull(thing[field]))
        .map((thing) => thing.title)
        .sort();
      expect(
        await titles(`${query}&filters[${field}][$null]=true`, token),
        `${field} $null (${query})`,
      ).toEqual(nulls);
      expect(await titles(`${query}&filters[${field}][$notNull]=true`, token), `${field} $notNull`).toEqual(
        values,
      );
      expect(await titles(`${query}&filters[${field}][$null]=false`, token), `${field} $null=false`).toEqual(
        values,
      );
      expect(
        await titles(`${query}&filters[${field}][$notNull]=false`, token),
        `${field} $notNull=false`,
      ).toEqual(nulls);
    }
    return all;
  };
  const nullTitles = (things: readonly Thing[], field: (typeof REFERENCE_FIELDS)[number]) =>
    things
      .filter((thing) => shownAsNull(thing[field]))
      .map((thing) => thing.title)
      .sort();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    adminToken = await createRoleToken(database.current.db);
    admin = schemaClient(testApp.app, adminToken);
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      localized: true,
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
    // Authors are readable, but only one's own: a token owns none, so every author is hidden.
    rowFiltered = await createDeliveryToken(database.current.db, [
      { modelId: thing.definition.id },
      { modelId: author.definition.id, condition: 'ownedByPrincipal' },
    ]);
    const upload = async (filename: string) =>
      uploadAsset(
        testApp.app,
        { authorization: `Bearer ${adminToken}` },
        { file: await createPng(8, 8), filename, mimeType: 'image/png' },
      );
    const kept = await upload('kept.png');
    lost = await upload('lost.png');

    ada = await create('author', { name: 'Ada' });
    await publish('author', ada.id);
    const zola = await create('author', { name: 'Zola' });
    const fleur = await create('author', { name: 'Fleur' }, 'fr');
    await publish('author', fleur.id, ['fr']);

    const things: Array<Record<string, unknown>> = [
      { title: 'Ada', author: ada.id, authors: [ada.id], cover: kept.id },
      { title: 'Zola only', author: zola.id, authors: [zola.id], cover: lost.id },
      { title: 'Mixed', authors: [zola.id, ada.id] },
      { title: 'Fleur', author: fleur.id, authors: [fleur.id] },
      { title: 'Empty' },
    ];
    for (const data of things) {
      const created = await create('thing', data);
      await publish('thing', created.id);
    }
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('a link to an unpublished entry counts as null; a list counts as null only when every link is hidden', async () => {
    const all = await expectParity('', both);
    expect(nullTitles(all, 'author')).toEqual(['Empty', 'Fleur', 'Mixed', 'Zola only']);
    expect(nullTitles(all, 'authors')).toEqual(['Empty', 'Fleur', 'Zola only']);
  });

  it('the locale chain of the read decides: a target published only in French shows in French', async () => {
    const all = await expectParity('locale=fr', both);
    expect(nullTitles(all, 'author')).toEqual(['Empty', 'Mixed', 'Zola only']);
  });

  it("the target's row filter decides: targets the caller may not read count as null", async () => {
    const all = await expectParity('', rowFiltered);
    expect(nullTitles(all, 'author')).toEqual(['Ada', 'Empty', 'Fleur', 'Mixed', 'Zola only']);
  });

  it('a pinned snapshot sees the targets as they were then', async () => {
    const { meta } = await deliver('', both);
    expectStatus(await admin.post(`/api/admin/content/author/${ada.id}/unpublish`, {}), 200);
    try {
      const now = await expectParity('', both);
      expect(nullTitles(now, 'author')).toContain('Ada');
      const then = await expectParity(`snapshot=${meta.snapshot}`, both);
      expect(nullTitles(then, 'author')).not.toContain('Ada');
    } finally {
      await publish('author', ada.id);
    }
  });

  it('GraphQL filters agree with REST', async () => {
    const result = await graphql<{ things: { nodes: Array<{ title: string }> } }>(
      testApp.app,
      'query ($filter: ThingFilter) { things(filter: $filter) { nodes { title } } }',
      { variables: { filter: { author: { notNull: true } } }, headers: { authorization: `Bearer ${both}` } },
    );
    expect(
      dataOf(result)
        .things.nodes.map((thing) => thing.title)
        .sort(),
    ).toEqual(await titles('filters[author][$notNull]=true', both));
  });

  it('a force-deleted asset counts as null, in delivery and in the admin list; admin relations keep every ID', async () => {
    const owner = await login(testApp.app, await createAdmin(database.current.db));
    const removed = await testApp.app.inject({
      method: 'DELETE',
      url: `/api/admin/media/assets/${lost.id}?force=true`,
      headers: owner.headers,
    });
    expect(removed.statusCode).toBe(204);
    const all = await expectParity('', both);
    expect(nullTitles(all, 'cover')).toContain('Zola only');

    const adminTitles = async (query: string) =>
      expectStatus(await admin.get(`/api/admin/content/thing?pageSize=100&${query}`), 200)
        .json<{ items: Array<{ title?: string; data?: { title?: string } }> }>()
        .items.map((item) => item.title ?? item.data?.title)
        .sort();
    expect(await adminTitles('filters[cover][$notNull]=true')).toEqual(['Ada']);
    // The admin sees every relation ID, the unpublished author's included.
    expect(await adminTitles('filters[author][$notNull]=true')).toEqual(['Ada', 'Fleur', 'Zola only']);
  });
});
