import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  runContentSchemaJobs,
  type EntryBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type DeliveredList = { data: Array<{ id: string }>; meta: { pagination: { total: number } } };

/**
 * The invariant the delivery COUNT relies on (plan delivery-perf-2): a head exists only for a live entry.
 * Deleting an entry removes its heads in the same transaction, and entries soft-deleted for having no head
 * (their only locale was deleted) have none, so counting heads without joining `entries` counts live entries.
 */
describe('a head implies a live entry', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let token: string;

  const create = async (locale: string, data: Record<string, unknown>) =>
    expectStatus(await admin.post('/api/admin/content/note', { locale, data }), 201).json<EntryBody>();
  const publish = async (id: string, locales: string[]) =>
    expectStatus(await admin.post(`/api/admin/content/note/${id}/publish`, { locales }), 200);
  const deliver = async (query: string) =>
    expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/notes?${query}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<DeliveredList>();
  const headsOfDeletedEntries = async () =>
    database.current.db
      .selectFrom('entry_heads as h')
      .innerJoin('entries as e', 'e.id', 'h.entry_id')
      .select('h.entry_id')
      .where('e.deleted_at', 'is not', null)
      .execute();

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    expectStatus(await admin.post('/api/admin/locales', { code: 'fr', label: 'French' }), 201);
    const note = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'note',
      label: 'Note',
      localized: true,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', localized: true },
        { apiKey: 'pinned', label: 'Pinned', type: 'boolean', filterable: true },
      ],
    });
    await runContentSchemaJobs(database.current.db);
    token = await createDeliveryToken(database.current.db, [{ modelId: note.definition.id }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  it('holds after deleting entries and a locale, and the count without the join matches the list', async () => {
    const kept = await create('en', { title: 'Kept', pinned: true });
    const deleted = await create('en', { title: 'Deleted', pinned: true });
    const other = await create('en', { title: 'Other', pinned: false });
    for (const entry of [kept, deleted, other]) {
      await publish(entry.id, ['en']);
    }
    expect((await deliver('filters[pinned][$eq]=true')).meta.pagination.total).toBe(2);

    expectStatus(await admin.delete(`/api/admin/content/note/${deleted.id}`), 204);
    expect(await headsOfDeletedEntries()).toEqual([]);

    // An entry that exists only in French is soft-deleted with the locale, its heads purged first.
    const frenchOnly = await create('fr', { title: 'Seulement', pinned: true });
    await publish(frenchOnly.id, ['fr']);
    expectStatus(await admin.delete('/api/admin/locales/fr?acknowledgeDestructive=true'), 200);
    await runContentSchemaJobs(database.current.db);
    const frenchEntry = await database.current.db
      .selectFrom('entries')
      .select('deleted_at')
      .where('id', '=', frenchOnly.id)
      .executeTakeFirstOrThrow();
    expect(frenchEntry.deleted_at).not.toBeNull();
    expect(await headsOfDeletedEntries()).toEqual([]);

    // The delivery count reads heads alone; it equals what the list returns.
    const pinned = await deliver('filters[pinned][$eq]=true');
    expect(pinned.data.map((entry) => entry.id)).toEqual([kept.id]);
    expect(pinned.meta.pagination.total).toBe(1);
    const all = await deliver('');
    expect(all.meta.pagination.total).toBe(all.data.length);
    expect(all.data.map((entry) => entry.id).sort()).toEqual([kept.id, other.id].sort());
  });
});
