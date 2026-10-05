import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  buildUploadForm,
  SEO_COMPONENT_ID,
  ShapioApiError,
  type MediaAsset,
  type SchemaApplyInput,
  type SchemaSyncResult,
  type ShapioClient,
} from '@shapio/client';
import { connectAdmin } from './lib/admin.js';
import {
  AUTHOR,
  entries,
  IMAGES,
  seoDefaults,
  SITE_SETTINGS,
  type EntrySpec,
  type ImageSpec,
  type MediaIds,
} from './lib/content.js';
import { createPng } from './lib/png.js';

/**
 * `npm run seed`: prepares a Shapio instance for this starter, idempotently (run it again to reset the
 * content to the seed):
 * 1. the `fr` locale;
 * 2. the models and components in shapio/ through the schema apply API (live, no restart; the same planner
 *    as `shapio schema apply` and the admin), as the site's own (SHAPIO_SITE, else the token's site, else the
 *    primary): a starter's schema belongs to the first site it is seeded on;
 *    The built-in SEO component (components/seo.json) is the exception: it is always shared with every site;
 * 3. placeholder images, an author, the site settings, pages and articles in English and French, published
 *    per locale, and the site's SEO defaults (Settings → SEO);
 * 4. a deployment connection named "Preview" whose preview URL opens this starter's /preview/ page (the
 *    entry document's Preview pane and visual editing; it triggers no builds). The site's URL is SITE_URL, else
 *    the starter's `--site-url` (its local dev server);
 * 5. with `--revalidate-path` (the Next.js starter's /api/revalidate), a webhook named "Site revalidation" that
 *    sends publish, unpublish, delete, change set and schema events to SITE_URL + that path; its signing secret
 *    (rotated on every run, as Shapio shows it only once) is written to .env as SHAPIO_WEBHOOK_SECRET;
 * 6. a delivery role and token for the build, written with SHAPIO_URL to .env in the current directory.
 */
const SCHEMA_DIR = resolve(import.meta.dirname, '..', 'shapio');
const SCHEMA_KINDS = ['models', 'components'] as const;
const SITE_MODELS = ['page', 'article', 'author', 'siteSettings'];
const DELIVERY_ROLE_KEY = 'starter-delivery';
const DELIVERY_TOKEN_NAME = 'starter build';
const PREVIEW_CONNECTION_NAME = 'Preview';
/** Where Shapio opens a draft: the starter's /preview/ page, the token in the fragment (never sent to a server). */
const PREVIEW_PATH = '/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}';
/** A placeholder build hook: the connection has no triggers, so nothing is ever sent to it. */
const PREVIEW_BUILD_HOOK = 'https://build.invalid/shapio-starter';
const REVALIDATE_WEBHOOK_NAME = 'Site revalidation';
/** The request's site's SEO defaults (`site.settings`). */
const SEO_DEFAULTS_PATH = '/api/admin/site/seo';
/** The events that change what a published site shows (the starter's route ignores any others). */
const REVALIDATE_EVENTS = [
  'entry.published',
  'entry.unpublished',
  'entry.deleted',
  'change_set.shipped',
  'schema.activated',
  'schema.deleted',
  // The site's SEO defaults changed: every page's head shows them.
  'site.updated',
];
/** A local site needs Shapio's OUTBOUND_PRIVATE_NETWORK_ALLOWLIST too; the webhook opts in for loopback only. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MEDIA_READY_TIMEOUT_MS = 120_000;
const SCHEMA_CHANGE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
/** No lock file: a first apply. Definitions that already match are skipped by the server. */
const FIRST_APPLY_BASE: SchemaApplyInput['base'] = {
  formatVersion: 2,
  schemaVersion: 0,
  sites: [],
  definitions: {},
};

const log = (line: string) => process.stdout.write(`${line}\n`);

const ensureLocale = async (client: ShapioClient) => {
  const locales = await client.admin.locales.list();
  if (!locales.some((locale) => locale.code === 'fr')) {
    await client.admin.locales.create({ code: 'fr', label: 'Français', fallbacks: ['en'] });
    log('Created the fr locale');
  }
};

/** The checked-in definition files (`shapio schema pull` format), models first. */
const readDefinitions = async (): Promise<unknown[]> => {
  const definitions: unknown[] = [];
  for (const kind of SCHEMA_KINDS) {
    const names = (await readdir(join(SCHEMA_DIR, kind))).filter((name) => name.endsWith('.json')).sort();
    for (const name of names) {
      definitions.push(JSON.parse(await readFile(join(SCHEMA_DIR, kind, name), 'utf8')));
    }
  }
  return definitions;
};

/** A planned change waits for its prerequisite jobs (e.g. an index); this waits until it is live. */
const waitForChange = async (client: ShapioClient, item: SchemaSyncResult) => {
  const deadline = Date.now() + SCHEMA_CHANGE_TIMEOUT_MS;
  for (;;) {
    const change = await client.admin.schema.change(item.changeId ?? '');
    if (change.status === 'activated') {
      return;
    }
    if (change.status === 'failed' || change.status === 'cancelled') {
      throw new Error(`The ${item.apiKey} change ${change.status}: ${JSON.stringify(change.error)}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`The ${item.apiKey} change is still ${change.status}; is the Shapio worker running?`);
    }
    await delay(POLL_INTERVAL_MS);
  }
};

/** A refusal the seed explains itself: printed without a stack. */
class SeedRefusedError extends Error {}

/** The schema files' IDs already belong to another site's definitions (the starter was seeded there first). */
const isSeededElsewhere = (error: unknown) =>
  error instanceof ShapioApiError &&
  error.code === 'SCHEMA_INVALID' &&
  ((error.details as { issues?: Array<{ code?: string }> } | undefined)?.issues ?? []).some(
    (issue) => issue.code === 'DUPLICATE_ID',
  );

const applySchema = async (client: ShapioClient) => {
  const definitions = await readDefinitions();
  let response;
  try {
    response = await client.admin.schema.apply({
      definitions,
      // Every definition is the site's own (sites/<key>/ in a pulled tree), never shared by default, except
      // the built-in SEO component: Shapio knows it by its fixed ID, so one shared copy serves every site.
      scopes: definitions.map((definition) =>
        (definition as { id?: unknown }).id === SEO_COMPONENT_ID ? ('network' as const) : ('site' as const),
      ),
      base: FIRST_APPLY_BASE,
      prune: false,
      dryRun: false,
      acknowledgeBreaking: false,
      acknowledgeDestructive: false,
    });
  } catch (error) {
    if (isSeededElsewhere(error)) {
      throw new SeedRefusedError(
        "This starter's schema already belongs to another site of this instance: a starter's schema belongs " +
          'to the first site it is seeded on. To reuse it on this site, share it with all sites ' +
          'with a network admin token (`shapio schema scope <apiKey> --shared --site <that site>` for each ' +
          'component, then author, page, article and siteSettings) and seed again, or seed a separate instance. ' +
          'The SEO component is always shared; a site that keeps its own copy of it blocks the others.',
        { cause: error },
      );
    }
    throw error;
  }
  for (const item of response.results) {
    if (item.outcome === 'pending') {
      await waitForChange(client, item);
    }
    log(`Schema: ${item.apiKey} ${item.decision.action}`);
  }
  log(`Schema version ${response.schemaVersion}`);
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

/** The singleton's one entry, created on the first run, then updated in both locales and published. */
const ensureSiteSettings = async (client: ShapioClient) => {
  const existing = (await client.admin.content.list('siteSettings', { locale: 'en' })).items[0];
  const id = existing
    ? (
        await client.admin.content.update('siteSettings', existing.id, {
          locale: 'en',
          expectedVersion: await versionIn(client, 'siteSettings', existing.id, 'en'),
          data: SITE_SETTINGS.en,
        })
      ).id
    : (await client.admin.content.create('siteSettings', { locale: 'en', data: SITE_SETTINGS.en })).id;
  await client.admin.content.update('siteSettings', id, {
    locale: 'fr',
    expectedVersion: await versionIn(client, 'siteSettings', id, 'fr'),
    data: SITE_SETTINGS.fr,
  });
  await client.admin.content.publish('siteSettings', id, { locales: ['en', 'fr'] });
  log('Published siteSettings (en, fr)');
};

/** The site's SEO defaults: the texts per locale, the default social image and the Twitter handle. */
const ensureSeoDefaults = async (client: ShapioClient, media: MediaIds) => {
  const current = await client.request<{ version: number }>(SEO_DEFAULTS_PATH);
  await client.request(SEO_DEFAULTS_PATH, {
    method: 'PUT',
    body: { expectedVersion: current.version, seo: seoDefaults(media) },
  });
  log('Set the SEO defaults (en, fr)');
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
    .filter((definition) => SITE_MODELS.includes(definition.apiKey))
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
        name: 'Starter site (delivery)',
        description: 'Reads published pages, articles, authors and the site settings for the starter build.',
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

/** The "Preview" connection, created once and pointed at this starter's /preview/ page on every run. */
const ensurePreviewConnection = async (client: ShapioClient, siteUrl: string) => {
  const previewUrlTemplate = `${siteUrl.replace(/\/+$/, '')}${PREVIEW_PATH}`;
  const existing = (await client.admin.deployments.connections.list()).find(
    (connection) => connection.name === PREVIEW_CONNECTION_NAME,
  );
  if (existing) {
    await client.admin.deployments.connections.update(existing.id, {
      expectedVersion: existing.version,
      previewUrlTemplate,
    });
  } else {
    await client.admin.deployments.connections.create({
      name: PREVIEW_CONNECTION_NAME,
      provider: 'generic_webhook',
      settings: { url: PREVIEW_BUILD_HOOK },
      secrets: {},
      triggerPolicy: [],
      previewUrlTemplate,
    });
  }
  log(`Preview opens ${previewUrlTemplate}`);
};

/** The "Site revalidation" webhook, created once and pointed at the site on every run; returns a fresh secret. */
const ensureRevalidateWebhook = async (client: ShapioClient, siteUrl: string, path: string) => {
  const url = `${siteUrl.replace(/\/+$/, '')}${path}`;
  const allowPrivateNetwork = LOOPBACK_HOSTS.has(new URL(url).hostname);
  const existing = (await client.admin.webhooks.list()).find(
    (webhook) => webhook.name === REVALIDATE_WEBHOOK_NAME,
  );
  const settings = { url, events: REVALIDATE_EVENTS, enabled: true, allowPrivateNetwork };
  let created;
  if (existing) {
    await client.admin.webhooks.update(existing.id, { expectedVersion: existing.version, ...settings });
    created = await client.admin.webhooks.rotateSecret(existing.id);
  } else {
    created = await client.admin.webhooks.create({ name: REVALIDATE_WEBHOOK_NAME, ...settings });
  }
  log(`Webhook "${REVALIDATE_WEBHOOK_NAME}" calls ${url}`);
  return created.secret;
};

/**
 * Shapio refuses a webhook to a loopback or private address unless its OUTBOUND_PRIVATE_NETWORK_ALLOWLIST
 * covers it. The site still builds and serves without the webhook, so the seed says how to turn it on and
 * carries on; the revalidation route answers 503 until SHAPIO_WEBHOOK_SECRET is set.
 */
const tryRevalidateWebhook = async (client: ShapioClient, siteUrl: string, path: string) => {
  try {
    return await ensureRevalidateWebhook(client, siteUrl, path);
  } catch (error) {
    if (error instanceof ShapioApiError && error.code === 'DESTINATION_NOT_ALLOWED') {
      log(
        `Skipped the "${REVALIDATE_WEBHOOK_NAME}" webhook: ${error.message} For a local site, start Shapio with ` +
          'OUTBOUND_PRIVATE_NETWORK_ALLOWLIST=127.0.0.1/32,::1/128 and run the seed again.',
      );
      return undefined;
    }
    throw error;
  }
};

const writeEnv = async (
  url: string,
  site: string | undefined,
  deliveryToken: string,
  webhookSecret: string | undefined,
) => {
  const path = resolve('.env');
  const lines = [
    '# Written by the seed. The delivery token is read-only; keep this file out of git.',
    `SHAPIO_URL=${url}`,
    `SHAPIO_DELIVERY_TOKEN=${deliveryToken}`,
    // The site the content was seeded on: the starter reads the same one.
    ...(site ? [`SHAPIO_SITE=${site}`] : []),
    ...(webhookSecret ? [`SHAPIO_WEBHOOK_SECRET=${webhookSecret}`] : []),
  ];
  await writeFile(path, `${lines.join('\n')}\n`, { mode: 0o600 });
  log(
    `Wrote SHAPIO_URL, ${site ? 'SHAPIO_SITE, ' : ''}SHAPIO_DELIVERY_TOKEN${webhookSecret ? ' and SHAPIO_WEBHOOK_SECRET' : ''} to ${path}`,
  );
};

const main = async () => {
  const { values } = parseArgs({
    options: { 'site-url': { type: 'string' }, 'revalidate-path': { type: 'string' } },
  });
  const siteUrl = process.env.SITE_URL || values['site-url'] || 'http://localhost:4321';
  const admin = await connectAdmin(process.env);
  try {
    await ensureLocale(admin.client);
    await applySchema(admin.client);
    const media = await ensureMedia(admin.client);
    await ensureSiteSettings(admin.client);
    await ensureSeoDefaults(admin.client, media);
    const authorId = await ensureAuthor(admin.client, media.avatar);
    for (const spec of entries(media, authorId)) {
      await upsertEntry(admin.client, spec);
    }
    await ensurePreviewConnection(admin.client, siteUrl);
    const revalidatePath = values['revalidate-path'];
    const webhookSecret = revalidatePath
      ? await tryRevalidateWebhook(admin.client, siteUrl, revalidatePath)
      : undefined;
    await writeEnv(admin.url, admin.site, await createDeliveryToken(admin.client), webhookSecret);
    log('Seeded. Build the site with: npm run build');
  } finally {
    await admin.close();
  }
};

const describeFailure = (error: unknown) => {
  if (error instanceof SeedRefusedError) {
    return error.message;
  }
  if (error instanceof ShapioApiError) {
    return `${error.code}: ${error.message} ${JSON.stringify(error.details ?? '')}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
};

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${describeFailure(error)}\n`);
  process.exitCode = 1;
});
