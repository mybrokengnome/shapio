import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, login } from './helpers/adminIdentity.js';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createPng, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/** Media fields and rich-text images against the media library (package G). */
describe('content with media', () => {
  const database = useTestDatabase();
  let testApp: TestApp;
  let admin: SchemaClient;
  let headers: Record<string, string>;
  let gallery: ModelBody;
  let image: MediaAssetBody;
  let secret: MediaAssetBody;
  let token: string;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { schemaListen: false });
    const adminToken = await createRoleToken(database.current.db);
    headers = { authorization: `Bearer ${adminToken}` };
    admin = schemaClient(testApp.app, adminToken);
    image = await uploadAsset(testApp.app, headers, {
      file: await createPng(20, 20),
      filename: 'a.png',
      mimeType: 'image/png',
    });
    secret = await uploadAsset(testApp.app, headers, {
      file: await createPng(10, 10),
      filename: 'private.png',
      mimeType: 'image/png',
      visibility: 'private',
    });
    gallery = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'gallery',
      label: 'Gallery',
      fields: [
        { apiKey: 'cover', label: 'Cover', type: 'media', settings: { allowedKinds: ['image'] } },
        { apiKey: 'clip', label: 'Clip', type: 'media', settings: { allowedKinds: ['video'] } },
        { apiKey: 'photos', label: 'Photos', type: 'media', settings: { multiple: true } },
        { apiKey: 'body', label: 'Body', type: 'richtext' },
      ],
    });
    token = await createDeliveryToken(database.current.db, [{ modelId: gallery.definition.id }]);
  });
  afterAll(async () => {
    await testApp.app.close();
  });

  const references = (entryId: string) =>
    database.current.db
      .selectFrom('media_references')
      .select(['asset_id', 'field_id', 'state'])
      .where('entry_id', '=', entryId)
      .orderBy('state')
      .orderBy('asset_id')
      .execute();

  it('records references per head, renders asset views, and blocks deleting a used asset', async () => {
    const body = {
      format: 'shapio-richtext',
      version: 1,
      doc: { type: 'doc', content: [{ type: 'image', attrs: { mediaId: image.id, alt: 'Inline' } }] },
    };
    const entry = expectStatus(
      await admin.post('/api/admin/content/gallery', {
        data: { cover: image.id, photos: [secret.id, image.id], body },
      }),
      201,
    ).json<EntryBody>();
    expect(entry.data.cover).toMatchObject({ id: image.id, url: image.url });
    expect((entry.data.photos as MediaAssetBody[]).map((photo) => photo.id)).toEqual([secret.id, image.id]);
    // One row per (asset, top-level field): cover, two photos, and the rich-text image.
    expect((await references(entry.id)).map((row) => row.state)).toEqual([
      'draft',
      'draft',
      'draft',
      'draft',
    ]);

    expectStatus(await admin.post(`/api/admin/content/gallery/${entry.id}/publish`, {}), 200);
    expect((await references(entry.id)).filter((row) => row.state === 'published')).toHaveLength(4);

    const delivered = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/galleries/${entry.id}?richText=html`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<{ data: Record<string, unknown> }>();
    const [privatePhoto] = delivered.data.photos as Array<Record<string, unknown>>;
    expect(privatePhoto).toMatchObject({ id: secret.id, urlExpiresAt: expect.any(String) as unknown });
    expect(privatePhoto).not.toHaveProperty('storageDriver');
    expect((delivered.data.body as { html: string }).html).toContain(`<img src="${image.url}" alt="Inline">`);

    expect(
      (await testApp.app.inject({ method: 'DELETE', url: `/api/admin/media/assets/${image.id}`, headers }))
        .statusCode,
    ).toBe(409);
    expectStatus(await admin.post(`/api/admin/content/gallery/${entry.id}/unpublish`, {}), 200);
    expect((await references(entry.id)).every((row) => row.state === 'draft')).toBe(true);
    expect((await admin.delete(`/api/admin/content/gallery/${entry.id}`)).statusCode).toBe(204);
    expect(await references(entry.id)).toEqual([]);
  });

  it('rejects missing assets and assets of a kind the field does not allow', async () => {
    const missing = await admin.post('/api/admin/content/gallery', {
      data: { cover: '00000000-0000-4000-8000-000000000000' },
    });
    expect(missing.json()).toMatchObject({
      error: { details: { issues: [{ path: '/cover', code: 'MEDIA_MISSING' }] } },
    });
    const wrongKind = await admin.post('/api/admin/content/gallery', { data: { clip: image.id } });
    expect(wrongKind.json()).toMatchObject({
      error: { details: { issues: [{ path: '/clip', code: 'NOT_ALLOWED' }] } },
    });
  });

  it('keeps content that points at a force-deleted asset editable, publishable, and in the Inbox', async () => {
    const owner = await login(testApp.app, await createAdmin(database.current.db, { roleKeys: ['owner'] }));
    const upload = (filename: string) =>
      createPng(12, 12).then((file) =>
        uploadAsset(testApp.app, headers, { file, filename, mimeType: 'image/png' }),
      );
    const [gone, kept] = [await upload('gone.png'), await upload('kept.png')];
    const notes = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'quickNote',
      label: 'Quick note',
      draftAndPublish: false,
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string' },
        { apiKey: 'cover', label: 'Cover', type: 'media' },
      ],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/gallery', {
        data: { cover: gone.id, photos: [gone.id, kept.id] },
      }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/gallery/${entry.id}/publish`, {}), 200);
    const note = expectStatus(
      await admin.post('/api/admin/content/quickNote', { data: { cover: gone.id } }),
      201,
    ).json<EntryBody>();

    expectStatus(
      await testApp.app.inject({
        method: 'DELETE',
        url: `/api/admin/media/assets/${gone.id}?force=true`,
        headers: owner.headers,
      }),
      204,
    );
    // Both entries are queued for a health check in the delete's transaction.
    const queued = await database.current.db
      .selectFrom('jobs')
      .select('payload')
      .where('type', '=', 'content.health.entry')
      .where('idempotency_key', 'like', `health:media-delete:${gone.id}:%`)
      .execute();
    expect(queued.map((job) => (job.payload as { entryId: string }).entryId).sort()).toEqual(
      [entry.id, note.id].sort(),
    );

    // The admin read keeps the dangling ID (a bare string) so the editor can see and remove it.
    const read = expectStatus(
      await admin.get(`/api/admin/content/gallery/${entry.id}`),
      200,
    ).json<EntryBody>();
    expect(read.data.cover).toBe(gone.id);
    expect((read.data.photos as unknown[])[0]).toBe(gone.id);
    expect((read.data.photos as MediaAssetBody[])[1]).toMatchObject({ id: kept.id });

    // A patch of untouched keys saves and publishes; delivery leaves the missing file out.
    const saved = expectStatus(
      await admin.put(`/api/admin/content/gallery/${entry.id}`, {
        expectedVersion: read.version,
        data: { body: null },
      }),
      200,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/gallery/${entry.id}/publish`, {}), 200);
    const delivered = expectStatus(
      await testApp.app.inject({
        method: 'GET',
        url: `/api/content/galleries/${entry.id}`,
        headers: { authorization: `Bearer ${token}` },
      }),
      200,
    ).json<{ data: Record<string, unknown> }>();
    expect(delivered.data.cover).toBeNull();
    expect((delivered.data.photos as MediaAssetBody[]).map((photo) => photo.id)).toEqual([kept.id]);

    // The pre-flight warns instead of refusing, and records the finding for the Inbox.
    const preflight = expectStatus(
      await admin.post(`/api/admin/content/gallery/${entry.id}/preflight`, {}),
      200,
    ).json<{ locales: { ready: boolean; checks: { rule: string; severity: string; path?: string }[] }[] }>();
    expect(preflight.locales[0]?.ready).toBe(true);
    expect(preflight.locales[0]?.checks.filter((check) => check.rule === 'mediaMissing')).toEqual([
      expect.objectContaining({ severity: 'warning', path: '/cover' }),
      expect.objectContaining({ severity: 'warning', path: '/photos' }),
    ]);
    const recorded = await database.current.db
      .selectFrom('content_health_findings')
      .select(['rule', 'path'])
      .where('entry_id', '=', entry.id)
      .where('rule', '=', 'mediaMissing')
      .where('resolved_at', 'is', null)
      .orderBy('path')
      .execute();
    expect(recorded).toEqual([
      { rule: 'mediaMissing', path: '/cover' },
      { rule: 'mediaMissing', path: '/photos' },
    ]);

    // Removing the kept photo leaves the dangling one, which is accepted; adding the deleted asset anew is not.
    expectStatus(
      await admin.put(`/api/admin/content/gallery/${entry.id}`, {
        expectedVersion: saved.version,
        data: { photos: [gone.id] },
      }),
      200,
    );
    const added = await admin.post('/api/admin/content/gallery', { data: { cover: gone.id } });
    expect(added.json()).toMatchObject({
      error: { details: { issues: [{ path: '/cover', code: 'MEDIA_MISSING' }] } },
    });

    // A model without drafts publishes on every save; it saves too.
    expectStatus(
      await admin.put(`/api/admin/content/quickNote/${note.id}`, {
        expectedVersion: note.version,
        data: { title: 'Still here' },
      }),
      200,
    );
    expect(notes.definition.draftAndPublish).toBe(false);
  });
});
