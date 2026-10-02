import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreateBucketCommand, HeadObjectCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeStatus } from '../src/helpers/healthProbe.js';
import { mediaCommand } from '../src/media/cli.js';
import { migrateMedia } from '../src/media/migrate.js';
import { createS3Client } from '../src/media/s3Adapter.js';
import { createAdmin, login, type TestSession } from './helpers/adminIdentity.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import {
  buildUploadForm,
  createPng,
  pathOf,
  requestGrant,
  runMediaJobs,
  uploadAsset,
  type MediaAssetBody,
  type UploadGrantBody,
} from './helpers/media.js';
import { useTestDatabase } from './helpers/testDatabase.js';

/**
 * Media on an S3-compatible service. Runs when a service answers at S3_TEST_ENDPOINT (CI and local
 * development use versitygw, an Apache-2.0 S3 gateway; any S3-compatible service works); otherwise the
 * suite is skipped and its name says why, so developers without one are not blocked. CI sets
 * S3_TEST_REQUIRED=1 to turn a skip into a failure.
 */
const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://127.0.0.1:7070';
const accessKeyId = process.env.S3_TEST_ACCESS_KEY ?? 'shapio-test';
const secretAccessKey = process.env.S3_TEST_SECRET_KEY ?? 'shapio-test-secret';
const bucket = process.env.S3_TEST_BUCKET ?? 'shapio-test';
const required = process.env.S3_TEST_REQUIRED === '1';

/** Any HTTP answer means the service is up (S3 rejects anonymous requests to `/` with 403). */
const findSkipReason = async (): Promise<string | undefined> =>
  (await probeStatus(endpoint)) === 0 ? `no S3-compatible service answers at ${endpoint}` : undefined;

const skipReason = await findSkipReason();
if (skipReason && required) {
  throw new Error(`S3_TEST_REQUIRED=1 but the S3 media suite cannot run: ${skipReason}`);
}
const suiteName = skipReason ? `media on S3 [skipped: ${skipReason}]` : 'media on S3';

const MAX_UPLOAD_BYTES = 1_000_000;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const s3Env = {
  STORAGE_S3_BUCKET: bucket,
  STORAGE_S3_ENDPOINT: endpoint,
  STORAGE_S3_REGION: 'us-east-1',
  STORAGE_S3_ACCESS_KEY_ID: accessKeyId,
  STORAGE_S3_SECRET_ACCESS_KEY: secretAccessKey,
  STORAGE_S3_FORCE_PATH_STYLE: 'true',
  MEDIA_MAX_UPLOAD_BYTES: String(MAX_UPLOAD_BYTES),
};

describe.skipIf(skipReason !== undefined)(suiteName, () => {
  const database = useTestDatabase();
  const mediaPath = mkdtempSync(join(tmpdir(), 'shapio-media-s3-'));
  const s3 = createS3Client({
    bucket,
    endpoint,
    region: 'us-east-1',
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  });
  const objectExists = async (key: string) => {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  };

  beforeAll(async () => {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!(error instanceof S3ServiceException) || !/BucketAlready/.test(error.name)) {
        throw error;
      }
    }
  });
  afterAll(() => rmSync(mediaPath, { recursive: true, force: true }));

  describe('direct-to-storage uploads (STORAGE_DRIVER=s3)', () => {
    let testApp: TestApp;
    let editor: TestSession;

    beforeAll(async () => {
      testApp = await createTestApp(database.current, {
        env: { ...s3Env, STORAGE_DRIVER: 's3', MEDIA_PATH: mediaPath },
      });
      editor = await login(testApp.app, await createAdmin(testApp.db, { roleKeys: ['editor'] }));
    });
    afterAll(() => testApp.app.close());

    it('uploads straight to the bucket with a presigned POST, then confirms', async () => {
      const png = await createPng(1500, 900);
      const asset = await uploadAsset(testApp.app, editor.headers, {
        file: png,
        filename: 'cover.png',
        mimeType: 'image/png',
      });
      expect(asset).toMatchObject({ storageDriver: 's3', sizeBytes: png.length, mimeType: 'image/png' });
      const key = decodeURIComponent(new URL(asset.url).pathname.replace('/api/media/f/', ''));
      expect(await objectExists(key)).toBe(true);
      // No MEDIA_PUBLIC_BASE_URL: Shapio serves the public object at its stable URL, reading from S3.
      const served = await testApp.app.inject({ method: 'GET', url: pathOf(asset.url) });
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload.equals(png)).toBe(true);

      await runMediaJobs(testApp.app, testApp.db);
      const ready = (
        await testApp.app.inject({
          method: 'GET',
          url: `/api/admin/media/assets/${asset.id}`,
          headers: editor.headers,
        })
      ).json<MediaAssetBody>();
      expect(ready).toMatchObject({ status: 'ready', width: 1500, checksumSha256: sha256(png) });
      expect(ready.variants.map((v) => [v.name, v.status])).toEqual([
        ['thumbnail', 'ready'],
        ['w640', 'ready'],
        ['w1280', 'ready'],
      ]);
    });

    it('stores SVG as an attachment, so opening it from the bucket or a CDN cannot run its script', async () => {
      const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
      );
      const asset = await uploadAsset(testApp.app, editor.headers, {
        file: svg,
        filename: 'logo.svg',
        mimeType: 'image/svg+xml',
      });
      const svgKey = decodeURIComponent(new URL(asset.url).pathname.replace('/api/media/f/', ''));
      const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: svgKey }));
      expect(stored).toMatchObject({ ContentType: 'image/svg+xml', ContentDisposition: 'attachment' });

      // Raster images stay inline.
      const png = await createPng(20, 20);
      const image = await uploadAsset(testApp.app, editor.headers, {
        file: png,
        filename: 'dot.png',
        mimeType: 'image/png',
      });
      const pngKey = decodeURIComponent(new URL(image.url).pathname.replace('/api/media/f/', ''));
      const raster = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: pngKey }));
      expect(raster.ContentDisposition).toBeUndefined();
    });

    it('lets the admin load images from and upload to the bucket (CSP)', async () => {
      const csp = String(
        (await testApp.app.inject({ method: 'GET', url: '/api/health' })).headers['content-security-policy'],
      );
      const origin = new URL(endpoint).origin;
      for (const directive of ['img-src', 'media-src', 'connect-src']) {
        expect(csp).toMatch(new RegExp(`${directive} [^;]*${origin.replace(/[.:/]/g, '\\$&')}`));
      }
    });

    it('serves private objects only through presigned URLs', async () => {
      const pdf = Buffer.from('%PDF-1.7\n%%EOF\n');
      const asset = await uploadAsset(testApp.app, editor.headers, {
        file: pdf,
        filename: 'private.pdf',
        mimeType: 'application/pdf',
        visibility: 'private',
      });
      const signed = await fetch(asset.url);
      expect(signed.status).toBe(200);
      expect(Buffer.from(await signed.arrayBuffer()).equals(pdf)).toBe(true);
      const url = new URL(asset.url);
      const unsigned = await fetch(`${url.origin}${url.pathname}`);
      expect(unsigned.status).toBe(403);
    });

    it('lets the bucket enforce the size and type limits of the presigned POST', async () => {
      const grant = (
        await requestGrant(testApp.app, editor.headers, {
          filename: 'big.png',
          mimeType: 'image/png',
          sizeBytes: 100,
        })
      ).json<UploadGrantBody>();
      const tooBig = await fetch(grant.upload.url, {
        method: 'POST',
        body: buildUploadForm(grant, Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'big.png'),
      });
      expect(tooBig.status).toBe(400);
      expect(await tooBig.text()).toContain('EntityTooLarge');

      const retyped = {
        ...grant,
        upload: { ...grant.upload, fields: { ...grant.upload.fields, 'Content-Type': 'text/html' } },
      };
      const wrongType = await fetch(grant.upload.url, {
        method: 'POST',
        body: buildUploadForm(retyped, Buffer.from('<html></html>'), 'x.html'),
      });
      expect(wrongType.status).toBe(403);
    });
  });

  describe('shapio media migrate', () => {
    let testApp: TestApp;
    let editor: TestSession;

    beforeAll(async () => {
      testApp = await createTestApp(database.current, {
        env: { ...s3Env, STORAGE_DRIVER: 'local', MEDIA_PATH: mediaPath },
      });
      editor = await login(testApp.app, await createAdmin(testApp.db, { roleKeys: ['editor'] }));
    });
    afterAll(() => testApp.app.close());

    const localChecksums = async () => {
      const assets = await testApp.db
        .selectFrom('media_assets')
        .select(['id', 'storage_key', 'checksum_sha256', 'storage_driver'])
        .where('deleted_at', 'is', null)
        .where('storage_driver', '=', 'local')
        .execute();
      const variants = await testApp.db
        .selectFrom('media_variants')
        .innerJoin('media_assets', 'media_assets.id', 'media_variants.asset_id')
        .select(['media_variants.storage_key', 'media_variants.checksum_sha256'])
        .where('media_assets.storage_driver', '=', 'local')
        .where('media_assets.deleted_at', 'is', null)
        .execute();
      return [...assets, ...variants].map((row) => ({
        key: row.storage_key ?? '',
        recorded: row.checksum_sha256,
        actual: existsSync(join(mediaPath, row.storage_key ?? ''))
          ? sha256(readFileSync(join(mediaPath, row.storage_key ?? '')))
          : null,
      }));
    };

    it('round-trips local → S3 → local with identical checksums', async () => {
      const image = await uploadAsset(testApp.app, editor.headers, {
        file: await createPng(1000, 700),
        filename: 'gallery.png',
        mimeType: 'image/png',
      });
      const document = await uploadAsset(testApp.app, editor.headers, {
        file: Buffer.from('%PDF-1.7\nprivate\n%%EOF\n'),
        filename: 'terms.pdf',
        mimeType: 'application/pdf',
        visibility: 'private',
      });
      await runMediaJobs(testApp.app, testApp.db);
      const before = await localChecksums();
      expect(before.length).toBe(4); // two originals, thumbnail + w640 of the image
      expect(before.every((object) => object.recorded !== null && object.recorded === object.actual)).toBe(
        true,
      );

      const toS3 = await migrateMedia({
        db: testApp.db,
        storage: testApp.app.mediaStorage,
        from: 'local',
        to: 's3',
        deleteSource: true,
      });
      expect(toS3).toEqual({ migrated: 2, skipped: 0, failed: [] });
      for (const object of before) {
        expect(await objectExists(object.key)).toBe(true);
        expect(existsSync(join(mediaPath, object.key))).toBe(false);
      }
      // The running server reads each asset from the driver its row records.
      const fromS3 = (
        await testApp.app.inject({
          method: 'GET',
          url: `/api/admin/media/assets/${image.id}`,
          headers: editor.headers,
        })
      ).json<MediaAssetBody>();
      expect(fromS3.storageDriver).toBe('s3');
      expect((await testApp.app.inject({ method: 'GET', url: pathOf(fromS3.url) })).statusCode).toBe(200);
      const privateDoc = (
        await testApp.app.inject({
          method: 'GET',
          url: `/api/admin/media/assets/${document.id}`,
          headers: editor.headers,
        })
      ).json<MediaAssetBody>();
      expect((await fetch(privateDoc.url)).status).toBe(200);

      // Idempotent: nothing left on the source.
      expect(
        await migrateMedia({ db: testApp.db, storage: testApp.app.mediaStorage, from: 'local', to: 's3' }),
      ).toEqual({
        migrated: 0,
        skipped: 0,
        failed: [],
      });

      // Back again through the `shapio media migrate` command, as an operator would run it. (The direct
      // upload suite's assets share this database and come along.)
      const onS3 = await testApp.db
        .selectFrom('media_assets')
        .select('id')
        .where('storage_driver', '=', 's3')
        .where('deleted_at', 'is', null)
        .execute();
      const output: string[] = [];
      const saved = { ...process.env };
      Object.assign(process.env, s3Env, {
        STORAGE_DRIVER: 'local',
        DATABASE_URL: database.current.url,
        MEDIA_PATH: mediaPath,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
      });
      try {
        const io = {
          stdout: (text: string) => output.push(text),
          stderr: (text: string) => output.push(text),
          env: process.env,
        };
        expect(
          await mediaCommand.run(['migrate', '--from', 's3', '--to', 'local', '--delete-source'], io),
        ).toBe(0);
      } finally {
        process.env = saved;
      }
      expect(output.join('')).toContain(`Migrated ${onS3.length}, skipped 0`);
      const after = await localChecksums();
      const beforeKeys = new Set(before.map((object) => object.key));
      expect(
        after
          .filter((object) => beforeKeys.has(object.key))
          .map((object) => [object.key, object.actual])
          .sort(),
      ).toEqual(before.map((object) => [object.key, object.actual]).sort());
      expect(after.every((object) => object.actual === object.recorded)).toBe(true);
      for (const object of after) {
        expect(await objectExists(object.key)).toBe(false);
      }
    });

    it('rejects unusable arguments', async () => {
      const output: string[] = [];
      const io = {
        stdout: (text: string) => output.push(text),
        stderr: (text: string) => output.push(text),
        env: process.env,
      };
      expect(await mediaCommand.run(['migrate', '--from', 'local', '--to', 'local'], io)).toBe(1);
      expect(await mediaCommand.run(['migrate', '--from', 'gcs', '--to', 's3'], io)).toBe(1);
      expect(output.join('')).toContain('Usage: shapio media migrate');
    });
  });
});
