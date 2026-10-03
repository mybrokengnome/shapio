import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import {
  createDefinition,
  createDeliveryToken,
  expectStatus,
  type EntryBody,
  type ModelBody,
} from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { dialectSkipReason } from './helpers/dialect.js';
import { withDatabaseName } from './helpers/env.js';
import { createPng, pathOf, runMediaJobs, uploadAsset, type MediaAssetBody } from './helpers/media.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { spawnServer, type SpawnedServer } from './helpers/spawnServer.js';
import { createTestDatabase, type TestDatabase } from './helpers/testDatabase.js';

/** CI sets this so missing PostgreSQL client tools fail the run instead of silently skipping. */
const required = process.env.BACKUP_TEST_REQUIRED === '1';
const TOOLS = ['pg_dump', 'pg_restore', 'tar'] as const;

const findSkipReason = (): string | undefined => {
  for (const tool of TOOLS) {
    const probe = spawnSync(tool, ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      return `${tool} is not on PATH`;
    }
  }
  return undefined;
};

const sqliteSkip = dialectSkipReason(import.meta.url);
const toolSkip = sqliteSkip === undefined ? findSkipReason() : undefined;
if (toolSkip && required) {
  throw new Error(`BACKUP_TEST_REQUIRED=1 but the backup/restore suite cannot run: ${toolSkip}`);
}
const skipReason = sqliteSkip ?? toolSkip;
const suiteName = skipReason
  ? `database and media backup restore [skipped: ${skipReason}]`
  : 'database and media backup restore';

/** Both instances answer as the same public origin, so asset URLs are comparable. */
const PUBLIC_URL = 'http://cms.example.test';

const sha256 = (data: Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex');

type Delivered = { data: Record<string, unknown> };
type DeliveredMedia = MediaAssetBody & { urlExpiresAt: string | null };

const runAdminStatement = async (statement: string) => {
  const client = new pg.Client({ connectionString: inject('testDatabaseAdminUrl') });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
};

/**
 * Brief §10 "Database/media backup restoration produces a working instance", following the documented steps
 * (documentation/backup-restore.md): `pg_dump --format=custom`, then a tar of MEDIA_PATH; restore with
 * `pg_restore --no-owner` into an empty database and untar the media; start Shapio on them.
 */
describe.skipIf(skipReason !== undefined)(suiteName, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'shapio-backup-'));
  const restoredName = `shapio_t_restored_${process.pid}_${randomBytes(4).toString('hex')}`;
  let source: TestDatabase | undefined;
  let sourceApp: TestApp | undefined;
  let restored: SpawnedServer | undefined;
  let restoredCreated = false;

  afterAll(async () => {
    await restored?.stop('SIGKILL');
    await sourceApp?.app.close();
    await source?.drop();
    if (restoredCreated) {
      await runAdminStatement(`drop database if exists ${pg.escapeIdentifier(restoredName)} with (force)`);
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  it('restores a dump and a media archive into a working instance', async () => {
    // --- A populated instance with media on local storage. ---
    source = await createTestDatabase();
    const sourceRoot = join(scratch, 'source');
    const sourceMedia = join(sourceRoot, 'media');
    mkdirSync(sourceMedia, { recursive: true });
    sourceApp = await createTestApp(source, {
      env: { MEDIA_PATH: sourceMedia, PUBLIC_URL },
      schemaListen: false,
    });
    const adminToken = await createRoleToken(source.db);
    const headers = { authorization: `Bearer ${adminToken}` };
    const admin: SchemaClient = schemaClient(sourceApp.app, adminToken);

    const publicPng = await createPng(1000, 500);
    const privatePng = await createPng(300, 200);
    const cover = await uploadAsset(sourceApp.app, headers, {
      file: publicPng,
      filename: 'cover.png',
      mimeType: 'image/png',
    });
    const contract = await uploadAsset(sourceApp.app, headers, {
      file: privatePng,
      filename: 'contract.png',
      mimeType: 'image/png',
      visibility: 'private',
    });
    await runMediaJobs(sourceApp.app, source.db);

    const post: ModelBody = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      fields: [
        { apiKey: 'title', label: 'Title', type: 'string', required: true },
        { apiKey: 'cover', label: 'Cover', type: 'media' },
        { apiKey: 'attachment', label: 'Attachment', type: 'media' },
      ],
    });
    const entry = expectStatus(
      await admin.post('/api/admin/content/post', {
        data: { title: 'Backed up', cover: cover.id, attachment: contract.id },
      }),
      201,
    ).json<EntryBody>();
    expectStatus(await admin.post(`/api/admin/content/post/${entry.id}/publish`, {}), 200);
    const deliveryToken = await createDeliveryToken(source.db, [{ modelId: post.definition.id }]);

    const sourceDelivered = expectStatus(
      await sourceApp.app.inject({
        method: 'GET',
        url: `/api/content/posts/${entry.id}`,
        headers: { authorization: `Bearer ${deliveryToken}` },
      }),
      200,
    ).json<Delivered>();
    const sourceCover = sourceDelivered.data.cover as DeliveredMedia;
    const sourceAttachment = sourceDelivered.data.attachment as DeliveredMedia;
    expect(sourceCover.variants.map((variant) => variant.name).sort()).toEqual(['thumbnail', 'w640']);
    expect(sourceAttachment.urlExpiresAt).toEqual(expect.any(String));
    const variantBytes = new Map<string, string>();
    for (const variant of sourceCover.variants) {
      const file = expectStatus(
        await sourceApp.app.inject({ method: 'GET', url: pathOf(variant.url ?? '') }),
        200,
      );
      variantBytes.set(variant.name, sha256(file.rawPayload));
    }

    // --- Back up: the database first, then the media directory. ---
    const dumpFile = join(scratch, 'shapio.dump');
    const mediaArchive = join(scratch, 'media.tar.gz');
    execFileSync('pg_dump', ['--format=custom', `--file=${dumpFile}`, source.url]);
    execFileSync('tar', ['-czf', mediaArchive, '-C', sourceRoot, 'media']);

    // Shapio is stopped and the original database and files are gone: nothing can come from them.
    await sourceApp.app.close();
    sourceApp = undefined;
    await source.drop();
    rmSync(sourceRoot, { recursive: true, force: true });

    // --- Restore into an empty database and a new media location. ---
    await runAdminStatement(`create database ${pg.escapeIdentifier(restoredName)} template template0`);
    restoredCreated = true;
    const restoredUrl = withDatabaseName(inject('testDatabaseAdminUrl'), restoredName);
    execFileSync('pg_restore', ['--no-owner', '--dbname', restoredUrl, dumpFile]);
    const restoredRoot = join(scratch, 'restored');
    mkdirSync(restoredRoot, { recursive: true });
    execFileSync('tar', ['-xzf', mediaArchive, '-C', restoredRoot]);

    restored = await spawnServer({
      DATABASE_URL: restoredUrl,
      MEDIA_PATH: join(restoredRoot, 'media'),
      RATE_LIMIT_MAX: '100000',
      PUBLIC_URL,
    });
    const server = restored;
    const call = async (token: string | null, method: string, path: string, body?: unknown) =>
      fetch(`${server.url}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const json = async <T>(response: Response, status = 200): Promise<T> => {
      const text = await response.text();
      if (response.status !== status) {
        throw new Error(`Expected ${status}, got ${response.status}: ${text}`);
      }
      return JSON.parse(text) as T;
    };
    const bytesOf = async (url: string) => {
      const response = await call(null, 'GET', pathOf(url));
      expect(response.status, url).toBe(200);
      return Buffer.from(await response.arrayBuffer());
    };

    // REST delivery with the delivery token issued before the backup.
    const delivered = await json<Delivered>(
      await call(deliveryToken, 'GET', `/api/content/posts/${entry.id}`),
    );
    expect(delivered.data.title).toBe('Backed up');
    const restoredCover = delivered.data.cover as DeliveredMedia;
    const restoredAttachment = delivered.data.attachment as DeliveredMedia;
    expect(restoredCover).toEqual(sourceCover);
    expect(restoredAttachment).toMatchObject({ id: contract.id, sizeBytes: privatePng.length });

    // GraphQL.
    const graphqlResult = await json<{ data: unknown; errors?: unknown }>(
      await call(deliveryToken, 'POST', '/api/graphql', {
        query: `{ post(id: "${entry.id}") { title cover { id sizeBytes variants { name } } } }`,
      }),
    );
    expect(graphqlResult).toEqual({
      data: {
        post: {
          title: 'Backed up',
          cover: {
            id: cover.id,
            sizeBytes: publicPng.length,
            variants: expect.arrayContaining([{ name: 'thumbnail' }, { name: 'w640' }]) as unknown,
          },
        },
      },
    });

    // Media files: the original and every variant, byte for byte.
    expect(sha256(await bytesOf(restoredCover.url))).toBe(sha256(publicPng));
    for (const variant of restoredCover.variants) {
      expect(sha256(await bytesOf(variant.url ?? '')), variant.name).toBe(variantBytes.get(variant.name));
    }

    // Private media: a URL signed before the backup and a freshly signed one both work (the signing secret
    // travels in the database); the unsigned path does not.
    expect(sha256(await bytesOf(sourceAttachment.url))).toBe(sha256(privatePng));
    expect(sha256(await bytesOf(restoredAttachment.url))).toBe(sha256(privatePng));
    const unsigned = new URL(restoredAttachment.url);
    expect((await call(null, 'GET', unsigned.pathname)).status).toBeGreaterThanOrEqual(400);

    // New writes succeed: an entry is created, published and delivered.
    const written = await json<EntryBody>(
      await call(adminToken, 'POST', '/api/admin/content/post', {
        data: { title: 'Written after restore', cover: cover.id },
      }),
      201,
    );
    await json(await call(adminToken, 'POST', `/api/admin/content/post/${written.id}/publish`, {}));
    const fresh = await json<Delivered>(await call(deliveryToken, 'GET', `/api/content/posts/${written.id}`));
    expect(fresh.data.title).toBe('Written after restore');

    expect(await restored.stop('SIGTERM')).toBe(0);
    restored = undefined;
  }, 120_000);
});
