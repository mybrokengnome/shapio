import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, uploadAsset } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type UsageBody = {
  total: number;
  items: Array<{ entryId: string; modelId: string; locale: string; state: string; title: string | null }>;
};

/** Media "Used in" names each entry by its title, within what the caller may read. */
describe('media usage titles', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-media-'));
  let testApp: TestApp;
  let owner: SchemaClient;
  let author: ModelBody;
  let page: ModelBody;
  let assetId: string;
  let ada: EntryBody;
  let home: EntryBody;

  const usage = async (client: SchemaClient) =>
    expectStatus(await client.get(`/api/admin/media/assets/${assetId}/usage`), 200).json<UsageBody>();
  const titlesOf = (body: UsageBody) =>
    Object.fromEntries(body.items.map((item) => [`${item.entryId}:${item.state}`, item.title]));
  const roleClient = async (key: string, permissions: Array<Record<string, unknown>>) => {
    expectStatus(await owner.post('/api/admin/roles', { key, name: key, kind: 'admin', permissions }), 201);
    return schemaClient(testApp.app, await createRoleToken(database.current.db, key));
  };
  const grant = (action: string, modelId: string | null, fieldIds: string[] | null = null) => ({
    action,
    modelId,
    condition: null,
    fieldIds,
  });

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { env: { MEDIA_PATH: mediaPath } });
    const ownerToken = await createRoleToken(database.current.db, 'owner');
    owner = schemaClient(testApp.app, ownerToken);
    const imageField = { apiKey: 'image', label: 'Image', type: 'media' };
    author = await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }, imageField],
    });
    page = await createDefinition(owner, {
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string' }, imageField],
    });
    assetId = (
      await uploadAsset(
        testApp.app,
        { authorization: `Bearer ${ownerToken}` },
        { file: await createPng(20, 20), filename: 'avatar.png', mimeType: 'image/png' },
      )
    ).id;
    const create = async (modelKey: string, data: Record<string, unknown>) =>
      expectStatus(
        await owner.post(`/api/admin/content/${modelKey}`, { locale: 'en', data }),
        201,
      ).json<EntryBody>();
    ada = await create('author', { name: 'Ada Lovelace', image: assetId });
    expectStatus(await owner.post(`/api/admin/content/author/${ada.id}/publish`, { locales: ['en'] }), 200);
    home = await create('page', { title: 'Home', image: assetId });
  });
  afterAll(async () => {
    await testApp.app.close();
    rmSync(mediaPath, { recursive: true, force: true });
  });

  it('names each usage by its entry title for an admin who may read everything', async () => {
    const body = await usage(owner);
    expect(body.total).toBe(3);
    expect(titlesOf(body)).toEqual({
      [`${ada.id}:draft`]: 'Ada Lovelace',
      [`${ada.id}:published`]: 'Ada Lovelace',
      [`${home.id}:draft`]: 'Home',
    });
    expect(body.items.find((item) => item.entryId === home.id)?.modelId).toBe(page.definition.id);
  });

  it('leaves the title out where the caller may not read the model or the title field', async () => {
    const imageId = author.definition.fields.find((field) => field.apiKey === 'image')?.id ?? '';
    const pagesOnly = await roleClient('pages-only', [
      grant('media.read', null),
      grant('read', page.definition.id),
    ]);
    expect(titlesOf(await usage(pagesOnly))).toEqual({
      [`${ada.id}:draft`]: null,
      [`${ada.id}:published`]: null,
      [`${home.id}:draft`]: 'Home',
    });
    const noNames = await roleClient('no-names', [
      grant('media.read', null),
      grant('read', author.definition.id, [imageId]),
    ]);
    expect(titlesOf(await usage(noNames))).toMatchObject({ [`${ada.id}:draft`]: null });
  });
});
