import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, createDeliveryToken, expectStatus, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: { snapshot: number; pagination: { total: number } };
};

/**
 * A delivery response names the moment it read (`meta.snapshot`), whether it ran as one statement (no
 * relation, populate or asset follow-up) or in a transaction (plan delivery-perf). Publishes running while it
 * reads must never make the rows, the total and the snapshot disagree.
 */
describe('delivery reads one consistent moment', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let author: ModelBody;
  let token: string;
  let authorId: string;

  const deliver = async (url: string) =>
    expectStatus(
      await testApp.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }),
      200,
    ).json<DeliveryList>();
  const currentSnapshot = async () =>
    expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: '/api/snapshots/current',
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<{ snapshot: number }>().snapshot;
  const publishNote = async (title: string) =>
    expectStatus(
      await admin.post('/api/admin/content/note', { publish: true, data: { title, author: authorId } }),
      201,
    );

  beforeAll(async () => {
    // The readers poll as fast as they can; the per-IP limit would answer them 429.
    testApp = await createTestApp(database.current, {
      schemaListen: false,
      env: { RATE_LIMIT_MAX: '1000000' },
    });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    author = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'author',
      label: 'Author',
      fields: [{ apiKey: 'name', label: 'Name', type: 'string' }],
    });
    const note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        {
          apiKey: 'author',
          label: 'Author',
          type: 'relation',
          settings: { target: author.definition.id, cardinality: 'one' },
        },
      ],
    });
    token = await createDeliveryToken(database.current.db, [
      { modelId: note.definition.id },
      { modelId: author.definition.id },
    ]);
    authorId = expectStatus(
      await admin.post('/api/admin/content/author', { publish: true, data: { name: 'Ada' } }),
      201,
    ).json<{ id: string }>().id;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('never splits rows, total and meta.snapshot while entries are published', async () => {
    // Each single-entry publish takes exactly one number, so snapshot S shows S - base notes.
    const base = await currentSnapshot();
    const reads = [
      '/api/content/notes?fields=title&pageSize=100', // one statement
      '/api/content/notes?pageSize=100', // the relation ID needs a visibility check: a transaction
      '/api/content/notes?populate=author&pageSize=100', // populate: a transaction
    ];
    const check = (response: DeliveryList) => {
      const expected = response.meta.snapshot - base;
      expect(response.meta.pagination.total).toBe(expected);
      expect(response.data).toHaveLength(expected);
    };
    // Every publish races two reads of each shape (bounded, so no database starves the writer).
    for (let index = 0; index < 30; index += 1) {
      const [, ...responses] = await Promise.all([
        publishNote(`Note ${index}`),
        ...[...reads, ...reads].map((url) => deliver(url)),
      ]);
      responses.forEach(check);
    }
    // After the last publish every read shape sees all 30, at the newest snapshot.
    const newest = await currentSnapshot();
    for (const url of reads) {
      const response = await deliver(url);
      expect(response.meta.snapshot).toBe(newest);
      expect(response.data).toHaveLength(30);
    }
  });

  it('reports the total and the snapshot of an empty page', async () => {
    const newest = await currentSnapshot();
    const { total } = (await deliver('/api/content/notes?fields=title')).meta.pagination;
    const empty = await deliver('/api/content/notes?fields=title&page=99&pageSize=100');
    expect(empty.data).toEqual([]);
    expect(empty.meta).toMatchObject({ snapshot: newest, pagination: { total } });
  });

  it('refuses a snapshot that does not exist yet, on the one-statement path too', async () => {
    const newest = await currentSnapshot();
    const response = await testApp.app.inject({
      method: 'GET',
      url: `/api/content/notes?fields=title&snapshot=${newest + 5}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('reads a pinned snapshot as it was, whatever was published since', async () => {
    const pinned = await currentSnapshot();
    const before = await deliver(`/api/content/notes?fields=title&snapshot=${pinned}&pageSize=100`);
    await publishNote('After the pin');
    const after = await deliver(`/api/content/notes?fields=title&snapshot=${pinned}&pageSize=100`);
    expect(after).toEqual(before);
    expect(after.meta.snapshot).toBe(pinned);
  });
});
