import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIMARY_SITE_ID, SITE_HEADER } from '../src/constants/sites.js';
import * as adminRolesRepository from '../src/repositories/adminRoles.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import {
  buildUploadForm,
  confirmGrant,
  createPng,
  injectForm,
  pathOf,
  requestGrant,
  uploadAsset,
  type Headers,
  type MediaAssetBody,
  type UploadGrantBody,
} from './helpers/media.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type FolderBody = { id: string; parentId: string | null; name: string; version: number };
type SiteBody = { id: string; key: string };

const codeOf = (response: LightMyRequestResponse) => response.json<{ error: { code: string } }>().error.code;

describe('media per site (sites plan §H, G4)', () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-sites-media-'));
  let testApp: TestApp;
  let owner: TestSession;
  /** An editor whose role is assigned on the primary site (A) only. */
  let editorOnA: TestSession;
  let siteB: SiteBody;
  let png: Buffer;
  let assetA: MediaAssetBody;
  let assetB: MediaAssetBody;
  let privateB: MediaAssetBody;

  const onSite = (session: TestSession, siteKey: string): Headers => ({
    ...session.headers,
    [SITE_HEADER]: siteKey,
  });
  const ownerOn = (siteKey: string) => onSite(owner, siteKey);
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    headers: Headers,
    payload?: object,
  ) => testApp.app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
  const upload = (
    headers: Headers,
    filename: string,
    extra: { visibility?: 'private'; folderId?: string } = {},
  ) => uploadAsset(testApp.app, headers, { file: png, filename, mimeType: 'image/png', ...extra });
  const listIds = async (headers: Headers) =>
    (await call('GET', '/api/admin/media/assets', headers))
      .json<{ items: MediaAssetBody[] }>()
      .items.map((item) => item.id);
  const createFolder = async (headers: Headers, name: string) => {
    const response = await call('POST', '/api/admin/media/folders', headers, { name });
    expect(response.statusCode).toBe(201);
    return response.json<FolderBody>();
  };

  beforeAll(async () => {
    testApp = await createTestApp(database.current, { env: { MEDIA_PATH: mediaPath } });
    owner = await login(testApp.app, await createAdmin(testApp.db));
    const created = await call('POST', '/api/admin/sites', owner.headers, { key: 'beta', name: 'Beta' });
    expect(created.statusCode).toBe(201);
    siteB = created.json<SiteBody>();

    const editor = await createAdmin(testApp.db, { roleKeys: [] });
    const [role] = await adminRolesRepository.findByKeys(['editor'], testApp.db);
    await testApp.db
      .insertInto('admin_user_roles')
      .values({ admin_user_id: editor.id, role_id: role?.id ?? '', site_id: PRIMARY_SITE_ID })
      .execute();
    editorOnA = await login(testApp.app, editor);

    png = await createPng(64, 32);
    assetA = await upload(ownerOn('default'), 'a.png');
    assetB = await upload(ownerOn('beta'), 'b.png');
    privateB = await upload(ownerOn('beta'), 'secret.png', { visibility: 'private' });
  });

  afterAll(async () => {
    await testApp.app.close();
    rmSync(mediaPath, { recursive: true, force: true });
  });

  it('records each upload on the site it was made on', async () => {
    const rows = await testApp.db
      .selectFrom('media_assets')
      .select(['id', 'site_id'])
      .where('id', 'in', [assetA.id, assetB.id, privateB.id])
      .execute();
    expect(Object.fromEntries(rows.map((row) => [row.id, row.site_id]))).toEqual({
      [assetA.id]: PRIMARY_SITE_ID,
      [assetB.id]: siteB.id,
      [privateB.id]: siteB.id,
    });
  });

  it('tags media events with the asset’s site', async () => {
    const events = await testApp.db
      .selectFrom('outbox_events')
      .select(['aggregate_id', 'site_id'])
      .where('type', '=', 'media.created')
      .where('aggregate_id', 'in', [assetA.id, assetB.id])
      .execute();
    expect(Object.fromEntries(events.map((event) => [event.aggregate_id, event.site_id]))).toEqual({
      [assetA.id]: PRIMARY_SITE_ID,
      [assetB.id]: siteB.id,
    });
  });

  it('lists only the request site’s assets', async () => {
    expect(await listIds(ownerOn('default'))).toEqual([assetA.id]);
    expect(new Set(await listIds(ownerOn('beta')))).toEqual(new Set([assetB.id, privateB.id]));
  });

  it('reads another site’s asset as not found, for every asset operation', async () => {
    const headers = ownerOn('default');
    const url = `/api/admin/media/assets/${assetB.id}`;
    const responses = await Promise.all([
      call('GET', url, headers),
      call('GET', `${url}/usage`, headers),
      call('PATCH', url, headers, { expectedVersion: assetB.version, alt: 'hijacked' }),
      call('DELETE', url, headers),
      call('POST', `${url}/replace`, headers, {
        filename: 'x.png',
        mimeType: 'image/png',
        sizeBytes: png.length,
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404, 404, 404]);

    const moved = await call('POST', '/api/admin/media/assets/move', headers, {
      assetIds: [assetB.id],
      folderId: null,
    });
    expect(moved.json()).toEqual({ moved: [], skipped: [assetB.id] });

    const row = await testApp.db
      .selectFrom('media_assets')
      .select(['alt', 'deleted_at', 'version'])
      .where('id', '=', assetB.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ alt: '', deleted_at: null, version: assetB.version });
  });

  describe('folders', () => {
    let folderA: FolderBody;
    let folderB: FolderBody;

    beforeAll(async () => {
      folderA = await createFolder(ownerOn('default'), 'Photos');
      folderB = await createFolder(ownerOn('beta'), 'Photos');
    });

    it('allows the same folder name on two sites and lists each site’s tree alone', async () => {
      expect(folderA.id).not.toBe(folderB.id);
      const names = async (siteKey: string) =>
        (await call('GET', '/api/admin/media/folders', ownerOn(siteKey)))
          .json<{ items: FolderBody[] }>()
          .items.map((folder) => folder.id);
      expect(await names('default')).toEqual([folderA.id]);
      expect(await names('beta')).toEqual([folderB.id]);
      const again = await call('POST', '/api/admin/media/folders', ownerOn('beta'), { name: 'photos' });
      expect(codeOf(again)).toBe('FOLDER_NAME_TAKEN');
    });

    it('reads another site’s folder as not found', async () => {
      const headers = ownerOn('default');
      const url = `/api/admin/media/folders/${folderB.id}`;
      const patched = await call('PATCH', url, headers, { expectedVersion: folderB.version, name: 'Mine' });
      const deleted = await call('DELETE', url, headers);
      expect([patched.statusCode, deleted.statusCode]).toEqual([404, 404]);
    });

    it('refuses another site’s folder as a parent, a move target, an asset folder or an upload folder', async () => {
      const headers = ownerOn('default');
      const responses = await Promise.all([
        call('POST', '/api/admin/media/folders', headers, { name: 'Child', parentId: folderB.id }),
        call('PATCH', `/api/admin/media/folders/${folderA.id}`, headers, {
          expectedVersion: folderA.version,
          parentId: folderB.id,
        }),
        call('POST', '/api/admin/media/assets/move', headers, {
          assetIds: [assetA.id],
          folderId: folderB.id,
        }),
        call('PATCH', `/api/admin/media/assets/${assetA.id}`, headers, {
          expectedVersion: assetA.version,
          folderId: folderB.id,
        }),
        requestGrant(testApp.app, headers, {
          filename: 'c.png',
          mimeType: 'image/png',
          sizeBytes: png.length,
          folderId: folderB.id,
        }),
      ]);
      expect(responses.map((response) => [response.statusCode, codeOf(response)])).toEqual(
        Array.from({ length: 5 }, () => [400, 'FOLDER_NOT_FOUND']),
      );
    });

    it('records the site on a folder deletion’s audit event', async () => {
      const empty = await createFolder(ownerOn('beta'), 'Empty');
      const deleted = await call('DELETE', `/api/admin/media/folders/${empty.id}`, ownerOn('beta'));
      expect(deleted.statusCode).toBe(204);
      const event = await testApp.db
        .selectFrom('audit_events')
        .select('site_id')
        .where('target_id', '=', empty.id)
        .executeTakeFirstOrThrow();
      expect(event.site_id).toBe(siteB.id);
    });
  });

  describe('private files', () => {
    it('denies a site-A-only editor every way to another site’s private file', async () => {
      const onB = await call('GET', `/api/admin/media/assets/${privateB.id}`, onSite(editorOnA, 'beta'));
      expect(onB.statusCode).toBe(403);
      const onA = await call('GET', `/api/admin/media/assets/${privateB.id}`, onSite(editorOnA, 'default'));
      expect(onA.statusCode).toBe(404);
      const listed = await call('GET', '/api/admin/media/assets', onSite(editorOnA, 'beta'));
      expect(listed.statusCode).toBe(403);

      const unsigned = new URL(privateB.url);
      unsigned.search = '';
      const file = await testApp.app.inject({ method: 'GET', url: pathOf(unsigned.toString()) });
      expect([file.statusCode, codeOf(file)]).toEqual([403, 'MEDIA_SIGNATURE_REQUIRED']);
    });

    it('serves the file to a signed URL issued by a read on its own site', async () => {
      expect(privateB.urlExpiresAt).not.toBeNull();
      const file = await testApp.app.inject({ method: 'GET', url: pathOf(privateB.url) });
      expect(file.statusCode).toBe(200);
    });
  });

  describe('upload grants', () => {
    it('cannot be completed on another site', async () => {
      const grantResponse = await requestGrant(testApp.app, ownerOn('default'), {
        filename: 'cross.png',
        mimeType: 'image/png',
        sizeBytes: png.length,
      });
      expect(grantResponse.statusCode).toBe(201);
      const grant = grantResponse.json<UploadGrantBody>();
      const sent = await injectForm(testApp.app, grant.upload.url, buildUploadForm(grant, png, 'cross.png'));
      expect(sent.statusCode).toBe(204);

      const onB = await confirmGrant(testApp.app, ownerOn('beta'), grant.grantId);
      expect([onB.statusCode, codeOf(onB)]).toEqual([404, 'NOT_FOUND']);
      const row = await testApp.db
        .selectFrom('media_upload_grants')
        .select(['status', 'site_id'])
        .where('id', '=', grant.grantId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: 'pending', site_id: PRIMARY_SITE_ID });

      const onA = await confirmGrant(testApp.app, ownerOn('default'), grant.grantId);
      expect(onA.statusCode).toBe(201);
      expect(await listIds(ownerOn('beta'))).not.toContain(grant.assetId);
      expect(await listIds(ownerOn('default'))).toContain(grant.assetId);
    });
  });
});
