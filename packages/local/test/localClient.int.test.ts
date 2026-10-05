import { ShapioApiError } from '@shapio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHAPIO_VERSION } from '../../../apps/api/src/constants/version.js';
import { publishServerRelease } from '../../../apps/api/src/services/deliveryDescriptor.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
} from '../../../apps/api/test/helpers/content.js';
import { createTestApp, type TestApp } from '../../../apps/api/test/helpers/createTestApp.js';
import { dialectSkipReason, withSkipReason } from '../../../apps/api/test/helpers/dialect.js';
import { createRoleToken, schemaClient } from '../../../apps/api/test/helpers/schemaAdmin.js';
import { useTestDatabase } from '../../../apps/api/test/helpers/testDatabase.js';
import { createLocalClient, type LocalClient } from '../src/index.js';

const skipReason = dialectSkipReason(import.meta.url);

/** `@shapio/local` as a site uses it: the client's reads, answered in process, equal to the HTTP API's. */
describe.skipIf(skipReason !== undefined)(withSkipReason('@shapio/local', skipReason), () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let token: string;
  let shapio: LocalClient;

  const http = async (path: string) =>
    (
      await testApp.app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } })
    ).json<unknown>();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    const article = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'article',
      label: 'Article',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', sortable: true }],
    });
    for (const title of ['One', 'Two']) {
      expectStatus(
        await admin.post('/api/admin/content/article', { data: { title }, publish: true }),
        201,
      ).json<EntryBody>();
    }
    token = await createDeliveryToken(database.current.db, [{ modelId: article.definition.id }]);
    await publishServerRelease(database.current.db, SHAPIO_VERSION, testApp.config);
    shapio = createLocalClient({ databaseUrl: database.current.url, token, poolMax: 2 });
  });

  afterAll(async () => {
    await shapio?.close();
    await testApp.app.close();
  });

  it('reads like the HTTP client, with the same bodies', async () => {
    const list = await shapio.delivery.list<{ title: string }>('articles', {
      sort: [{ field: 'title', direction: 'desc' }],
    });
    expect(list.data.map((entry) => entry.title)).toEqual(['Two', 'One']);
    expect(list).toStrictEqual(await http('/api/content/articles?sort=title:desc'));
    const [first] = list.data;
    expect(await shapio.delivery.get('articles', (first as unknown as { id: string }).id)).toStrictEqual(
      await http(`/api/content/articles/${(first as unknown as { id: string }).id}`),
    );
    expect(await shapio.site.get()).toStrictEqual(await http('/api/site'));
    expect(await shapio.snapshots.current()).toStrictEqual(await http('/api/snapshots/current'));
  });

  it("throws the client's own ShapioApiError", async () => {
    const missing = shapio.delivery.get('articles', '00000000-0000-4000-8000-000000000000');
    await expect(missing).rejects.toBeInstanceOf(ShapioApiError);
    await expect(missing).rejects.toMatchObject({ status: 404 });
  });
});
