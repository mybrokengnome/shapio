import { EMPTY_SEO_DEFAULTS, isModelDefinition, SeoDefaultsSchema, type SeoDefaults } from '@shapio/schema';
import { Value } from 'typebox/value';
import { isPublicImage, toDeliveryAsset, type ReadEnvironment } from '../content/read.js';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import * as sitesRepository from '../repositories/sites.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { SiteActorContext, SiteRef } from './actorContext.js';
import { recordAudit } from './audit.js';
import { toAssetViews } from './mediaViews.js';

/**
 * A site's SEO defaults (plan seo-fields): default texts per locale, a default social image and the Twitter
 * handle, stored on `sites.seo_defaults`. Edited by `site.settings`; delivered on `GET /api/site` and merged
 * into SEO fields by `?seo=resolved` reads.
 */
export const SITE_UPDATED_EVENT = 'site.updated';

export type SiteSeoContext = SiteActorContext & {
  db: Database;
  snapshot: SchemaSnapshot;
  permissions: PermissionEvaluator;
};

export type SiteSeoView = { version: number; seo: SeoDefaults };

const siteNotFound = () => new AppError(404, 'SITE_NOT_FOUND', 'Site not found');

/** Stored defaults, or the empty ones when none were saved (or the stored value no longer fits the schema). */
const readDefaults = (stored: unknown): SeoDefaults =>
  stored !== null && Value.Check(SeoDefaultsSchema, stored) ? stored : EMPTY_SEO_DEFAULTS;

/** The defaults a resolved delivery read merges in. */
export const loadSeoDefaults = async (siteId: string, executor: Database): Promise<SeoDefaults> =>
  readDefaults((await sitesRepository.findSeoDefaults(siteId, executor))?.seo_defaults ?? null);

/** The caller reads something on this site (the same rule as its content: deny by default). */
const assertReadsSite = async (context: Pick<DeliverySiteContext, 'snapshot' | 'permissions' | 'actor'>) => {
  for (const { definition } of context.snapshot.definitions) {
    if (!isModelDefinition(definition)) {
      continue;
    }
    const policy = await context.permissions.evaluate(context.actor, {
      action: 'read',
      modelId: definition.id,
    });
    if (policy.allowed) {
      return;
    }
  }
  throw context.actor.kind === 'anonymous'
    ? new AppError(401, 'UNAUTHENTICATED', 'This site needs a delivery token')
    : new AppError(403, 'FORBIDDEN', 'You may not read content on this site');
};

/**
 * Reading the defaults needs read access to some content of the site (editors see the template in the entry's
 * search-result preview); changing them needs `site.settings` (the route checks it).
 */
export const getSiteSeo = async (context: SiteSeoContext): Promise<SiteSeoView> => {
  await assertReadsSite(context);
  const row = await sitesRepository.findSeoDefaults(context.site.id, context.db);
  if (!row) {
    throw siteNotFound();
  }
  return { version: row.version, seo: readDefaults(row.seo_defaults) };
};

const invalid = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);

const assertKnownLocales = (snapshot: SchemaSnapshot, seo: SeoDefaults) => {
  const known = new Set(snapshot.locales.map((locale) => locale.code));
  const unknown = Object.keys(seo.locales).filter((code) => !known.has(code));
  if (unknown.length > 0) {
    throw invalid('UNKNOWN_LOCALE', `Unknown locale "${unknown[0]}"`, { locales: unknown });
  }
};

/** The default image must be a live, public image of this site: delivery shows it to anyone. */
const assertUsableImage = async (context: SiteSeoContext, imageId: string | null) => {
  if (imageId === null) {
    return;
  }
  const [asset] = await mediaAssetsRepository.findLiveManyOnSite(context.site.id, [imageId], context.db);
  if (!asset) {
    throw invalid('SEO_IMAGE_INVALID', 'The default image is not an asset of this site', { imageId });
  }
  if (!isPublicImage({ visibility: asset.visibility as 'public' | 'private', mimeType: asset.mime_type })) {
    throw invalid('SEO_IMAGE_INVALID', 'The default image must be a public image', { imageId });
  }
};

/** Without empty locale entries, so a cleared locale leaves nothing behind. */
const compact = (seo: SeoDefaults): SeoDefaults => ({
  ...seo,
  locales: Object.fromEntries(
    Object.entries(seo.locales).filter(([, texts]) => Object.keys(texts).length > 0),
  ),
});

/** Optimistic: fails with VERSION_CONFLICT when the site changed since `expectedVersion` was read. */
export const updateSiteSeo = async (
  context: SiteSeoContext,
  input: { expectedVersion: number; seo: SeoDefaults },
): Promise<SiteSeoView> => {
  const seo = compact(input.seo);
  assertKnownLocales(context.snapshot, seo);
  await assertUsableImage(context, seo.imageId);
  return context.db.transaction().execute(async (trx) => {
    const current = await sitesRepository.findSeoDefaults(context.site.id, trx);
    if (!current) {
      throw siteNotFound();
    }
    const updated = await sitesRepository.updateSeoDefaultsIfVersion(
      context.site.id,
      input.expectedVersion,
      seo,
      trx,
    );
    if (!updated) {
      throw new AppError(409, 'VERSION_CONFLICT', 'The site changed since you loaded it', {
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }
    const metadata = {
      locales: Object.keys(seo.locales),
      imageId: seo.imageId,
      twitterHandle: seo.twitterHandle,
    };
    await recordAudit(trx, {
      ...context,
      action: 'site.seo_update',
      target: { type: 'site', id: context.site.id },
      metadata,
    });
    await writeOutboxEvent(trx, {
      type: SITE_UPDATED_EVENT,
      aggregateType: 'site',
      aggregateId: context.site.id,
      payload: { siteKey: context.site.key, changed: ['seo'] },
      siteId: context.site.id,
    });
    return { version: updated.version, seo: readDefaults(updated.seo_defaults) };
  });
};

export type DeliverySiteContext = {
  db: Database;
  snapshot: SchemaSnapshot;
  permissions: PermissionEvaluator;
  actor: Principal;
  site: SiteRef;
  media?: ReadEnvironment['media'];
};

export type DeliverySiteView = {
  key: string;
  name: string;
  seo: Omit<SeoDefaults, 'imageId'> & { image: ReturnType<typeof toDeliveryAsset> | null };
};

const deliveryImage = async (context: DeliverySiteContext, imageId: string | null) => {
  if (imageId === null || !context.media) {
    return null;
  }
  const assets = await mediaAssetsRepository.findLiveManyOnSite(context.site.id, [imageId], context.db);
  const [view] = await toAssetViews(context.media, assets, context.db);
  return view && isPublicImage(view) ? toDeliveryAsset(view) : null;
};

/** `GET /api/site`: the site's key, name and SEO defaults, its default image as a delivered asset. */
export const getDeliverySite = async (context: DeliverySiteContext): Promise<DeliverySiteView> => {
  await assertReadsSite(context);
  const row = await sitesRepository.findSeoDefaults(context.site.id, context.db);
  if (!row) {
    throw siteNotFound();
  }
  const { imageId, ...seo } = readDefaults(row.seo_defaults);
  return { key: row.key, name: row.name, seo: { ...seo, image: await deliveryImage(context, imageId) } };
};
