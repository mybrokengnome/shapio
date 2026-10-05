import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, createDeliveryToken, expectStatus, type EntryBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Story = { id: string; title: string; writer: string | null; sources: string[] };
type StoryList = { data: Story[]; meta: { snapshot: number } };

/**
 * A live published read whose only follow-up is relation visibility runs on the pool, without a transaction
 * (plan delivery-perf-2, step 4). It must still show published targets and hide unpublished ones, as the
 * transaction did; a pinned read keeps showing exactly its snapshot.
 */
describe('relation visibility on live delivery reads', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let token: string;

  const create = async (modelKey: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}`, { data }), 201).json<EntryBody>();
  const act = async (modelKey: string, id: string, action: 'publish' | 'unpublish') =>
    expectStatus(await admin.post(`/api/admin/content/${modelKey}/${id}/${action}`, {}), 200);
  const deliver = async (query: string) =>
    expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/stories?${query}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<StoryList>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const writer = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'writer',
      label: 'Writer',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const story = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'story',
      label: 'Story',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', filterable: true },
        {
          apiKey: 'writer',
          label: 'Writer',
          type: 'relation',
          settings: { target: writer.definition.id, cardinality: 'one' },
        },
        {
          apiKey: 'sources',
          label: 'Sources',
          type: 'relation',
          settings: { target: writer.definition.id, cardinality: 'many' },
        },
      ],
      display: {},
    });
    token = await createDeliveryToken(database.current.db, [
      { modelId: story.definition.id },
      { modelId: writer.definition.id },
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('shows published targets and hides unpublished ones, live and pinned', async () => {
    const published = await create('writer', { name: 'Published' });
    await act('writer', published.id, 'publish');
    const draftOnly = await create('writer', { name: 'Draft only' });
    const withdrawn = await create('writer', { name: 'Withdrawn' });
    await act('writer', withdrawn.id, 'publish');
    await act('writer', withdrawn.id, 'unpublish');
    const story = await create('story', {
      title: 'Story',
      writer: draftOnly.id,
      sources: [published.id, draftOnly.id, withdrawn.id],
    });
    await act('story', story.id, 'publish');

    const live = await deliver('filters[title][$eq]=Story');
    expect(live.data).toHaveLength(1);
    expect(live.data[0]?.writer).toBeNull();
    expect(live.data[0]?.sources).toEqual([published.id]);
    expect(JSON.stringify(live)).not.toContain(draftOnly.id);
    expect(JSON.stringify(live)).not.toContain(withdrawn.id);

    // Publishing the draft target shows it on the next live read; the read pinned before still hides it.
    await act('writer', draftOnly.id, 'publish');
    const after = await deliver('filters[title][$eq]=Story');
    expect(after.data[0]?.writer).toBe(draftOnly.id);
    expect(after.data[0]?.sources).toEqual([published.id, draftOnly.id]);
    const pinned = await deliver(`filters[title][$eq]=Story&snapshot=${live.meta.snapshot}`);
    expect(pinned.data[0]?.writer).toBeNull();
    expect(pinned.data[0]?.sources).toEqual([published.id]);

    // Unpublishing a target hides it again on the next live read.
    await act('writer', published.id, 'unpublish');
    const hidden = await deliver('');
    expect(hidden.data[0]?.sources).toEqual([draftOnly.id]);
    expect(JSON.stringify(hidden)).not.toContain(published.id);
  });
});
