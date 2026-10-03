import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID } from '../src/constants/sites.js';
import { signMediaGet } from '../src/media/signing.js';
import { addReferences } from '../src/services/mediaReferences.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import {
  buildUploadForm,
  confirmGrant,
  createPng,
  injectForm,
  pathOf,
  requestGrant,
  runMediaJobs,
  uploadAsset,
  uploadThroughGrant,
  type MediaAssetBody,
  type UploadGrantBody,
} from './helpers/media.js';
import { useTestDatabase } from './helpers/testDatabase.js';

const MAX_UPLOAD_BYTES = 2_000_000;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
/** The first bytes of a Linux executable, padded. */
const ELF_BINARY = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  Buffer.alloc(4096, 1),
]);

describe('media library (local storage)', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-media-'));
  let testApp: TestApp;
  let owner: TestSession;
  let admin: TestSession;
  let editor: TestSession;
  let reader: TestSession;

  beforeAll(async () => {
    testApp = await createTestApp(database.current, {
      env: { MEDIA_PATH: mediaPath, MEDIA_MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES) },
    });
    const sessionFor = async (roleKeys: string[]) =>
      login(testApp.app, await createAdmin(testApp.db, { roleKeys }));
    [owner, admin, editor, reader] = await Promise.all([
      sessionFor(['owner']),
      sessionFor(['admin']),
      sessionFor(['editor']),
      sessionFor(['read-only']),
    ]);
  });
  afterAll(async () => {
    await testApp.app.close();
    rmSync(mediaPath, { recursive: true, force: true });
  });

  const api = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    session: TestSession,
    payload?: object,
  ) => testApp.app.inject({ method, url, headers: session.headers, ...(payload ? { payload } : {}) });
  const get = (url: string, headers: Record<string, string> = {}) =>
    testApp.app.inject({ method: 'GET', url: pathOf(url), headers });
  const getAsset = async (id: string) =>
    (await api('GET', `/api/admin/media/assets/${id}`, owner)).json<MediaAssetBody>();
  const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.replace('/api/media/f/', ''));
  const fileOf = (url: string) => join(mediaPath, keyOf(url));
  const auditActions = async (targetId: string) =>
    (
      await testApp.db.selectFrom('audit_events').select('action').where('target_id', '=', targetId).execute()
    ).map((row) => row.action);

  describe('uploads, public URLs and variants', () => {
    let png: Buffer;
    let asset: MediaAssetBody;

    beforeAll(async () => {
      png = await createPng(2000, 1000);
      asset = await uploadAsset(testApp.app, editor.headers, {
        file: png,
        filename: 'Hero Image.PNG',
        mimeType: 'image/png',
      });
    });

    it('records the asset from the bytes that arrived', async () => {
      expect(asset).toMatchObject({
        filename: 'Hero Image.PNG',
        mimeType: 'image/png',
        sizeBytes: png.length,
        visibility: 'public',
        status: 'processing',
        storageDriver: 'local',
        urlExpiresAt: null,
        variants: [],
      });
      expect(await auditActions(asset.id)).toEqual(['media.upload']);
      const event = await testApp.db
        .selectFrom('outbox_events')
        .select('type')
        .where('aggregate_id', '=', asset.id)
        .executeTakeFirst();
      expect(event?.type).toBe('media.created');
    });

    it('serves a public asset at a stable, cacheable URL with no credentials', async () => {
      expect(new URL(asset.url).pathname).toMatch(/^\/api\/media\/f\/public\//);
      const response = await get(asset.url);
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.equals(png)).toBe(true);
      expect(response.headers).toMatchObject({
        'content-type': 'image/png',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        // Embeddable from other origins (the user's sites); Helmet's same-origin default would block it.
        'cross-origin-resource-policy': 'cross-origin',
      });
      expect(String(response.headers['content-security-policy'])).toContain('sandbox');
      const partial = await get(asset.url, { range: 'bytes=0-7' });
      expect(partial.statusCode).toBe(206);
      expect(partial.rawPayload.equals(png.subarray(0, 8))).toBe(true);
      expect(partial.headers['content-range']).toBe(`bytes 0-7/${png.length}`);
      expect(partial.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect((await get(asset.url, { range: `bytes=${png.length}-` })).statusCode).toBe(416);
    });

    it('generates checksum, dimensions and variants asynchronously, visible when ready', async () => {
      await runMediaJobs(testApp.app, testApp.db);
      const ready = await getAsset(asset.id);
      expect(ready).toMatchObject({
        status: 'ready',
        width: 2000,
        height: 1000,
        checksumSha256: sha256(png),
      });
      expect(ready.variants.map((v) => [v.name, v.status, v.width])).toEqual([
        ['thumbnail', 'ready', 400],
        ['w640', 'ready', 640],
        ['w1280', 'ready', 1280],
        ['w1920', 'ready', 1920],
      ]);
      const thumbnail = ready.variants.find((v) => v.name === 'thumbnail');
      const response = await get(thumbnail?.url ?? '');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/webp');
    });

    it('lists and filters assets', async () => {
      await uploadAsset(testApp.app, editor.headers, {
        file: Buffer.from('plain notes\n'),
        filename: 'notes.txt',
        mimeType: 'text/plain',
      });
      const images = await api('GET', '/api/admin/media/assets?mimeType=image/*', reader);
      expect(images.statusCode).toBe(200);
      expect(
        images.json<{ items: MediaAssetBody[] }>().items.every((item) => item.mimeType.startsWith('image/')),
      ).toBe(true);
      const search = (await api('GET', '/api/admin/media/assets?search=notes', reader)).json<{
        items: MediaAssetBody[];
      }>();
      expect(search.items.map((item) => item.filename)).toEqual(['notes.txt']);
      const page = (await api('GET', '/api/admin/media/assets?limit=1', reader)).json<{
        items: unknown[];
        nextCursor: string | null;
      }>();
      expect(page.items).toHaveLength(1);
      const next = await api(
        'GET',
        `/api/admin/media/assets?limit=1&cursor=${page.nextCursor ?? ''}`,
        reader,
      );
      expect(next.json<{ items: MediaAssetBody[] }>().items[0]?.id).not.toBe(
        (page.items[0] as MediaAssetBody).id,
      );
    });

    it('replaces the file but keeps the asset ID, and purges the old objects', async () => {
      const before = await getAsset(asset.id);
      const replacement = await createPng(800, 600);
      const grant = (
        await api('POST', `/api/admin/media/assets/${asset.id}/replace`, editor, {
          filename: 'hero-v2.png',
          mimeType: 'image/png',
          sizeBytes: replacement.length,
        })
      ).json<UploadGrantBody>();
      expect(grant.assetId).toBe(asset.id);
      expect(
        (await injectForm(testApp.app, grant.upload.url, buildUploadForm(grant, replacement, 'hero-v2.png')))
          .statusCode,
      ).toBe(204);
      const confirmed = await confirmGrant(testApp.app, editor.headers, grant.grantId);
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json<MediaAssetBody>()).toMatchObject({
        id: asset.id,
        filename: 'hero-v2.png',
        version: before.version + 1,
      });
      await runMediaJobs(testApp.app, testApp.db);
      const after = await getAsset(asset.id);
      expect(after).toMatchObject({ width: 800, checksumSha256: sha256(replacement), status: 'ready' });
      expect(after.variants.map((v) => v.name)).toEqual(['thumbnail', 'w640']);
      expect(existsSync(fileOf(before.url))).toBe(false);
      expect((await get(before.url)).statusCode).toBe(404);
      expect(await auditActions(asset.id)).toContain('media.replace');
    });
  });

  describe('private assets', () => {
    let asset: MediaAssetBody;
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

    beforeAll(async () => {
      asset = await uploadAsset(testApp.app, editor.headers, {
        file: pdf,
        filename: 'contract.pdf',
        mimeType: 'application/pdf',
        visibility: 'private',
      });
    });

    it('is served only through a valid, unexpired signed URL', async () => {
      expect(asset.urlExpiresAt).not.toBeNull();
      const signed = new URL(asset.url);
      expect(signed.searchParams.get('signature')).toBeTruthy();
      const ok = await get(asset.url);
      expect(ok.statusCode).toBe(200);
      expect(ok.rawPayload.equals(pdf)).toBe(true);
      expect(ok.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
      expect(ok.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(ok.headers['x-content-type-options']).toBe('nosniff');

      const unsigned = await get(`${signed.origin}${signed.pathname}`);
      expect(unsigned.statusCode).toBe(403);
      expect(unsigned.json<{ error: { code: string } }>().error.code).toBe('MEDIA_SIGNATURE_REQUIRED');

      signed.searchParams.set('signature', `${signed.searchParams.get('signature') ?? ''}x`);
      expect((await get(signed.toString())).json<{ error: { code: string } }>().error.code).toBe(
        'MEDIA_SIGNATURE_INVALID',
      );

      const later = new URL(asset.url);
      later.searchParams.set('expires', String(Number(later.searchParams.get('expires')) + 3600));
      expect((await get(later.toString())).statusCode).toBe(403);
    });

    it('rejects an expired signed URL', async () => {
      const key = keyOf(asset.url);
      const expires = Math.floor(Date.now() / 1000) - 1;
      const expired = await testApp.app.inject({
        method: 'GET',
        url: `/api/media/f/${key}?expires=${expires}&signature=${signMediaGet(testApp.app.signingSecret, key, expires)}`,
      });
      expect(expired.statusCode).toBe(403);
      expect(expired.json<{ error: { code: string } }>().error.code).toBe('MEDIA_URL_EXPIRED');
    });

    it('needs media.manage to change visibility, audits it, and moves the objects', async () => {
      const current = await getAsset(asset.id);
      const denied = await api('PATCH', `/api/admin/media/assets/${asset.id}`, editor, {
        expectedVersion: current.version,
        visibility: 'public',
      });
      expect(denied.statusCode).toBe(403);
      const madePublic = await api('PATCH', `/api/admin/media/assets/${asset.id}`, admin, {
        expectedVersion: current.version,
        visibility: 'public',
        alt: 'Signed contract',
      });
      expect(madePublic.statusCode).toBe(200);
      expect(await auditActions(asset.id)).toContain('media.visibility.change');
      await runMediaJobs(testApp.app, testApp.db);
      const moved = await getAsset(asset.id);
      expect(new URL(moved.url).pathname).toMatch(/^\/api\/media\/f\/public\//);
      expect((await get(moved.url)).statusCode).toBe(200);
      expect(existsSync(fileOf(asset.url))).toBe(false);

      const stale = await api('PATCH', `/api/admin/media/assets/${asset.id}`, admin, {
        expectedVersion: current.version,
        visibility: 'private',
      });
      expect(stale.statusCode).toBe(409);
      const madePrivate = await api('PATCH', `/api/admin/media/assets/${asset.id}`, admin, {
        expectedVersion: moved.version,
        visibility: 'private',
      });
      expect(madePrivate.statusCode).toBe(200);
      // Before the move job runs, the public URL already stops working: the database decides.
      expect((await get(moved.url)).statusCode).toBe(403);
      await runMediaJobs(testApp.app, testApp.db);
      expect((await get(moved.url)).statusCode).toBe(404);
    });
  });

  describe('upload checks', () => {
    it('rejects a renamed executable by its bytes and deletes it', async () => {
      const { grant, upload, confirm } = await uploadThroughGrant(testApp.app, editor.headers, {
        file: ELF_BINARY,
        filename: 'photo.png',
        mimeType: 'image/png',
      });
      expect(upload.status).toBe(204);
      expect(confirm.statusCode).toBe(415);
      expect(confirm.json<{ error: { code: string; details: unknown } }>().error).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        details: { reason: 'TYPE_NOT_ALLOWED', detected: 'application/x-elf', declared: 'image/png' },
      });
      const row = await testApp.db
        .selectFrom('media_upload_grants')
        .select(['status', 'storage_key'])
        .where('id', '=', grant.grantId)
        .executeTakeFirstOrThrow();
      expect(row.status).toBe('rejected');
      expect(existsSync(join(mediaPath, row.storage_key))).toBe(false);
      expect(
        await testApp.db
          .selectFrom('media_assets')
          .select('id')
          .where('id', '=', grant.assetId)
          .executeTakeFirst(),
      ).toBeUndefined();
    });

    it('refuses types and sizes outside the limits', async () => {
      const exe = await requestGrant(testApp.app, editor.headers, {
        filename: 'setup.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10,
      });
      expect(exe.statusCode).toBe(415);
      const big = await requestGrant(testApp.app, editor.headers, {
        filename: 'big.png',
        mimeType: 'image/png',
        sizeBytes: MAX_UPLOAD_BYTES + 1,
      });
      expect(big.statusCode).toBe(413);
    });

    it('cuts off an upload larger than the limit, whatever size was declared', async () => {
      const grant = (
        await requestGrant(testApp.app, editor.headers, {
          filename: 'a.png',
          mimeType: 'image/png',
          sizeBytes: 10,
        })
      ).json<UploadGrantBody>();
      const response = await injectForm(
        testApp.app,
        grant.upload.url,
        buildUploadForm(grant, Buffer.alloc(MAX_UPLOAD_BYTES + 10), 'a.png'),
      );
      expect(response.statusCode).toBe(413);
      expect((await confirmGrant(testApp.app, editor.headers, grant.grantId)).statusCode).toBe(400);
    });

    it('accepts form uploads only with the grant signature and its declared type', async () => {
      const png = await createPng(10, 10);
      const grant = (
        await requestGrant(testApp.app, editor.headers, {
          filename: 'a.png',
          mimeType: 'image/png',
          sizeBytes: png.length,
        })
      ).json<UploadGrantBody>();
      const forged = {
        ...grant,
        upload: { ...grant.upload, fields: { ...grant.upload.fields, signature: 'forged' } },
      };
      expect(
        (await injectForm(testApp.app, grant.upload.url, buildUploadForm(forged, png, 'a.png'))).statusCode,
      ).toBe(403);
      const retyped = {
        ...grant,
        upload: { ...grant.upload, fields: { ...grant.upload.fields, 'Content-Type': 'text/html' } },
      };
      expect(
        (await injectForm(testApp.app, grant.upload.url, buildUploadForm(retyped, png, 'a.png'))).statusCode,
      ).toBe(403);
      // Only the principal that asked for the grant can confirm it.
      expect((await confirmGrant(testApp.app, owner.headers, grant.grantId)).statusCode).toBe(404);
      expect(
        (await injectForm(testApp.app, grant.upload.url, buildUploadForm(grant, png, 'a.png'))).statusCode,
      ).toBe(204);
      expect((await confirmGrant(testApp.app, editor.headers, grant.grantId)).statusCode).toBe(201);
      expect((await confirmGrant(testApp.app, editor.headers, grant.grantId)).statusCode).toBe(409);
      expect(
        (await injectForm(testApp.app, grant.upload.url, buildUploadForm(grant, png, 'a.png'))).statusCode,
      ).toBe(404);
    });

    it('lets read-only admins browse but not upload', async () => {
      expect((await api('GET', '/api/admin/media/assets', reader)).statusCode).toBe(200);
      expect(
        (
          await requestGrant(testApp.app, reader.headers, {
            filename: 'a.png',
            mimeType: 'image/png',
            sizeBytes: 5,
          })
        ).statusCode,
      ).toBe(403);
      expect((await testApp.app.inject({ method: 'GET', url: '/api/admin/media/assets' })).statusCode).toBe(
        401,
      );
    });
  });

  describe('references and deletion', () => {
    let asset: MediaAssetBody;
    let entryId: string;
    let modelId: string;

    beforeAll(async () => {
      asset = await uploadAsset(testApp.app, editor.headers, {
        file: await createPng(50, 50),
        filename: 'logo.png',
        mimeType: 'image/png',
      });
      await runMediaJobs(testApp.app, testApp.db);
      modelId = randomUUID();
      await testApp.db
        .insertInto('models')
        .values({ id: modelId, api_key: `page${Date.now()}`, kind: 'collection' })
        .execute();
      entryId = (
        await testApp.db
          .insertInto('entries')
          .values({ site_id: PRIMARY_SITE_ID, model_id: modelId })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      await testApp.db.transaction().execute((trx) =>
        addReferences(trx, [
          { assetId: asset.id, entryId, modelId, fieldId: 'f-hero', locale: 'en', state: 'draft' },
          { assetId: asset.id, entryId, modelId, fieldId: 'f-hero', locale: 'en', state: 'published' },
        ]),
      );
    });

    it('shows where an asset is used', async () => {
      const usage = await api('GET', `/api/admin/media/assets/${asset.id}/usage`, reader);
      expect(usage.statusCode).toBe(200);
      expect(usage.json()).toMatchObject({
        total: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ entryId, fieldId: 'f-hero', state: 'published' }),
        ]) as unknown,
      });
    });

    it('blocks deleting a referenced asset; only owners can force it', async () => {
      const blocked = await api('DELETE', `/api/admin/media/assets/${asset.id}`, admin);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ error: { code: 'MEDIA_IN_USE', details: { usageCount: 2 } } });
      expect((await api('DELETE', `/api/admin/media/assets/${asset.id}?force=true`, admin)).statusCode).toBe(
        403,
      );
      expect((await api('DELETE', `/api/admin/media/assets/${asset.id}`, editor)).statusCode).toBe(403);
      expect((await get(asset.url)).statusCode).toBe(200);

      expect((await api('DELETE', `/api/admin/media/assets/${asset.id}?force=true`, owner)).statusCode).toBe(
        204,
      );
      expect((await get(asset.url)).statusCode).toBe(404);
      expect((await api('GET', `/api/admin/media/assets/${asset.id}`, owner)).statusCode).toBe(404);
      const audit = await testApp.db
        .selectFrom('audit_events')
        .select(['action', 'metadata'])
        .where('target_id', '=', asset.id)
        .where('action', '=', 'media.delete')
        .executeTakeFirstOrThrow();
      expect(audit.metadata).toMatchObject({ force: true, usageCount: 2 });
      await runMediaJobs(testApp.app, testApp.db);
      expect(existsSync(fileOf(asset.url))).toBe(false);
    });

    it('deletes an unreferenced asset', async () => {
      const other = await uploadAsset(testApp.app, editor.headers, {
        file: Buffer.from('{"a":1}'),
        filename: 'data.json',
        mimeType: 'application/json',
      });
      expect(readFileSync(fileOf(other.url)).toString()).toBe('{"a":1}');
      expect((await api('DELETE', `/api/admin/media/assets/${other.id}`, admin)).statusCode).toBe(204);
      await runMediaJobs(testApp.app, testApp.db);
      expect(existsSync(fileOf(other.url))).toBe(false);
    });
  });

  describe('folders', () => {
    type FolderBody = {
      id: string;
      name: string;
      parentId: string | null;
      version: number;
      assetCount: number;
    };

    it('creates, nests, renames, moves assets and deletes only empty folders', async () => {
      const create = (name: string, parentId?: string) =>
        api('POST', '/api/admin/media/folders', editor, { name, ...(parentId ? { parentId } : {}) });
      const brand = (await create('Brand')).json<FolderBody>();
      const logos = (await create('Logos', brand.id)).json<FolderBody>();
      expect((await create('brand')).statusCode).toBe(409);
      expect((await create('Logos')).statusCode).toBe(201);

      const cycle = await api('PATCH', `/api/admin/media/folders/${brand.id}`, editor, {
        expectedVersion: brand.version,
        parentId: logos.id,
      });
      expect(cycle.json()).toMatchObject({ error: { code: 'FOLDER_CYCLE' } });
      const renamed = await api('PATCH', `/api/admin/media/folders/${logos.id}`, editor, {
        expectedVersion: logos.version,
        name: 'Marks',
      });
      expect(renamed.json()).toMatchObject({ name: 'Marks', version: logos.version + 1 });

      const one = await uploadAsset(testApp.app, editor.headers, {
        file: await createPng(5, 5),
        filename: 'one.png',
        mimeType: 'image/png',
      });
      const two = await uploadAsset(testApp.app, editor.headers, {
        file: await createPng(6, 6),
        filename: 'two.png',
        mimeType: 'image/png',
        folderId: brand.id,
      });
      const moved = await api('POST', '/api/admin/media/assets/move', editor, {
        assetIds: [one.id, two.id, randomUUID()],
        folderId: logos.id,
      });
      expect(moved.json<{ moved: string[]; skipped: string[] }>().moved.sort()).toEqual(
        [one.id, two.id].sort(),
      );
      const inFolder = (await api('GET', `/api/admin/media/assets?folder=${logos.id}`, reader)).json<{
        items: MediaAssetBody[];
      }>();
      expect(inFolder.items.map((item) => item.id).sort()).toEqual([one.id, two.id].sort());
      const folders = (await api('GET', '/api/admin/media/folders', reader)).json<{ items: FolderBody[] }>();
      expect(folders.items.find((folder) => folder.id === logos.id)?.assetCount).toBe(2);

      expect((await api('DELETE', `/api/admin/media/folders/${brand.id}`, editor)).statusCode).toBe(403);
      const notEmpty = await api('DELETE', `/api/admin/media/folders/${logos.id}`, admin);
      expect(notEmpty.json()).toMatchObject({
        error: { code: 'FOLDER_NOT_EMPTY', details: { assetCount: 2 } },
      });
      await api('POST', '/api/admin/media/assets/move', editor, {
        assetIds: [one.id, two.id],
        folderId: null,
      });
      expect((await api('DELETE', `/api/admin/media/folders/${brand.id}`, admin)).statusCode).toBe(409);
      expect((await api('DELETE', `/api/admin/media/folders/${logos.id}`, admin)).statusCode).toBe(204);
      expect((await api('DELETE', `/api/admin/media/folders/${brand.id}`, admin)).statusCode).toBe(204);
      expect(await auditActions(brand.id)).toEqual(['media.folder.delete']);
    });
  });
});
