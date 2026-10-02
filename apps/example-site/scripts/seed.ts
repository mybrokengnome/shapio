import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { REMOTE_COMMANDS } from '@shapio/cli';
import { buildUploadForm, ShapioApiError, type MediaAsset, type ShapioClient } from '@shapio/client';
import { connectAdmin, type AdminConnection } from './lib/admin.js';
import { AUTHOR, entries, IMAGES, type EntrySpec, type ImageSpec, type MediaIds } from './lib/content.js';
import { createPng } from './lib/png.js';

/**
 * `pnpm --filter example-site seed`: prepares a Shapio instance for this site, idempotently (run it again
 * to reset the content to the seed):
 * 1. the `fr` locale;
 * 2. the models and components in shapio/ through `shapio schema apply` (live, no restart);
 * 3. placeholder images, an author, pages and articles in English and French, published per locale;
 * 4. a delivery role and token for the build, written to .env with SHAPIO_URL.
 */
const SITE_DIR = resolve(import.meta.dirname, '..');
const SCHEMA_DIR = join(SITE_DIR, 'shapio');
const DELIVERY_ROLE_KEY = 'example-site-delivery';
const DELIVERY_TOKEN_NAME = 'example-site build';
const MEDIA_READY_TIMEOUT_MS = 120_000;

const log = (line: string) => process.stdout.write(`${line}\n`);

const ensureLocale = async (client: ShapioClient) => {
  const locales = await client.admin.locales.list();
  if (!locales.some((locale) => locale.code === 'fr')) {
    await client.admin.locales.create({ code: 'fr', label: 'Français', fallbacks: ['en'] });
    log('Created the fr locale');
  }
};

/** The checked-in schema files, applied like CI would: `shapio schema apply` (an empty lock: first apply). */
const applySchema = async (admin: AdminConnection) => {
  const lockDir = await mkdtemp(join(tmpdir(), 'example-site-lock-'));
  try {
    const schema = REMOTE_COMMANDS.schema;
    const code = await schema?.run(
      [
        'apply',
        '--url',
        admin.url,
        '--token',
        admin.token,
        '--dir',
        SCHEMA_DIR,
        '--lock',
        join(lockDir, 'lock.json'),
      ],
      { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text), env: {} },
    );
    if (code !== 0) {
      throw new Error('shapio schema apply failed (see above)');
    }
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
};

const findAsset = async (client: ShapioClient, filename: string) =>
  (await client.admin.media.assets.list({ search: filename, limit: 50 })).items.find(
    (asset) => asset.filename === filename,
  );

/** Uploads a generated PNG through the grant flow (the same for local disk and S3 storage), once. */
const ensureImage = async (client: ShapioClient, spec: ImageSpec): Promise<MediaAsset> => {
  const existing = await findAsset(client, spec.filename);
  if (existing) {
    return existing;
  }
  const png = createPng(spec.width, spec.height, spec.from, spec.to);
  const grant = await client.admin.media.uploads.create({
    filename: spec.filename,
    mimeType: 'image/png',
    sizeBytes: png.length,
  });
  const upload = await fetch(grant.upload.url, {
    method: 'POST',
    body: buildUploadForm(grant, new Blob([new Uint8Array(png)], { type: 'image/png' }), spec.filename),
  });
  if (!upload.ok) {
    throw new Error(`Uploading ${spec.filename} failed: HTTP ${upload.status} ${await upload.text()}`);
  }
  const asset = await client.admin.media.uploads.confirm(grant.grantId);
  const updated = await client.admin.media.assets.update(asset.id, {
    expectedVersion: asset.version,
    alt: spec.alt,
  });
  log(`Uploaded ${spec.filename}`);
  return updated;
};

/** Variants are rendered by a background job; the site's srcsets need them. */
const waitForMedia = async (client: ShapioClient, ids: readonly string[]) => {
  const deadline = Date.now() + MEDIA_READY_TIMEOUT_MS;
  for (;;) {
    const assets = await Promise.all(ids.map((id) => client.admin.media.assets.get(id)));
    if (assets.every((asset) => asset.status !== 'processing')) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error('Media processing did not finish in time; is the Shapio worker running?');
    }
    await delay(500);
  }
};

const ensureMedia = async (client: ShapioClient): Promise<MediaIds> => {
  const ids = {} as MediaIds;
  for (const [key, spec] of Object.entries(IMAGES) as Array<[keyof MediaIds, ImageSpec]>) {
    ids[key] = (await ensureImage(client, spec)).id;
  }
  await waitForMedia(client, Object.values(ids));
  return ids;
};

const ensureAuthor = async (client: ShapioClient, avatar: string) => {
  const page = await client.admin.content.list('author', { pageSize: 100 });
  const existing = page.items.find((item) => item.data.name === AUTHOR.name);
  const data = { ...AUTHOR, avatar };
  const entry = existing
    ? await client.admin.content.update('author', existing.id, { expectedVersion: existing.version, data })
    : await client.admin.content.create('author', { data });
  await client.admin.content.publish('author', entry.id);
  return entry.id;
};

/** The locale's draft version, or null when the entry has none in that locale yet. */
const versionIn = async (client: ShapioClient, model: string, id: string, locale: string) => {
  try {
    return (await client.admin.content.get(model, id, { locale })).version;
  } catch (error) {
    if (error instanceof ShapioApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
};

const upsertEntry = async (client: ShapioClient, spec: EntrySpec) => {
  const found = await client.admin.content.list(spec.model, {
    filters: { slug: { $eq: spec.slug } },
    locale: 'en',
  });
  let id = found.items[0]?.id;
  if (id) {
    const version = await versionIn(client, spec.model, id, 'en');
    await client.admin.content.update(spec.model, id, {
      locale: 'en',
      expectedVersion: version,
      data: spec.content.en,
    });
  } else {
    id = (await client.admin.content.create(spec.model, { locale: 'en', data: spec.content.en })).id;
  }
  const frVersion = await versionIn(client, spec.model, id, 'fr');
  await client.admin.content.update(spec.model, id, {
    locale: 'fr',
    expectedVersion: frVersion,
    data: spec.content.fr,
  });
  if (spec.publish) {
    await client.admin.content.publish(spec.model, id, { locales: ['en', 'fr'] });
  }
  log(`${spec.publish ? 'Published' : 'Saved draft'} ${spec.model} ${spec.slug} (en, fr)`);
};

/** A delivery role that reads the site's models, and a fresh token bound to it (older ones are revoked). */
const createDeliveryToken = async (client: ShapioClient) => {
  const summary = await client.admin.schema.summary();
  const modelIds = summary.definitions
    .filter((definition) => ['page', 'article', 'author'].includes(definition.apiKey))
    .map((definition) => definition.id);
  const permissions = modelIds.map((modelId) => ({
    action: 'read' as const,
    modelId,
    condition: null,
    fieldIds: null,
  }));
  const roles = await client.admin.roles.list();
  const existing = roles.find((role) => role.key === DELIVERY_ROLE_KEY);
  const role = existing
    ? await client.admin.roles.update(existing.id, { expectedVersion: existing.version, permissions })
    : await client.admin.roles.create({
        key: DELIVERY_ROLE_KEY,
        name: 'Example site (delivery)',
        description: 'Reads published pages, articles and authors for the example site build.',
        kind: 'delivery',
        permissions,
      });
  for (const token of await client.admin.tokens.list()) {
    if (token.name === DELIVERY_TOKEN_NAME && !token.revokedAt) {
      await client.admin.tokens.revoke(token.id);
    }
  }
  return (await client.admin.tokens.create({ name: DELIVERY_TOKEN_NAME, roleId: role.id })).token;
};

const writeEnv = async (url: string, deliveryToken: string) => {
  const path = join(SITE_DIR, '.env');
  await writeFile(
    path,
    `# Written by pnpm seed. The delivery token is read-only; keep this file out of git.\nSHAPIO_URL=${url}\nSHAPIO_DELIVERY_TOKEN=${deliveryToken}\n`,
    { mode: 0o600 },
  );
  log(`Wrote SHAPIO_URL and SHAPIO_DELIVERY_TOKEN to ${path}`);
};

const main = async () => {
  const admin = await connectAdmin(process.env);
  try {
    await ensureLocale(admin.client);
    await applySchema(admin);
    const media = await ensureMedia(admin.client);
    const authorId = await ensureAuthor(admin.client, media.avatar);
    for (const spec of entries(media, authorId)) {
      await upsertEntry(admin.client, spec);
    }
    await writeEnv(admin.url, await createDeliveryToken(admin.client));
    log('Seeded. Build the site with: pnpm --filter example-site build');
  } finally {
    await admin.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(
    `seed failed: ${error instanceof ShapioApiError ? `${error.code}: ${error.message} ${JSON.stringify(error.details ?? '')}` : error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
