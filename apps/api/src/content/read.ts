import type { FieldDefinition, SeoDefaults } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type { PermissionEvaluator, Policy, Principal } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { toAssetViews, type MediaAssetView } from '../services/mediaViews.js';
import { compileHeadQuery, type HeadRow, type HeadSource, type LocaleScope } from './compiler/compile.js';
import { entryIdIn } from './compiler/conditions.js';
import { compileRowFilter } from './compiler/policy.js';
import { populateRelations, type PopulateEnvironment } from './compiler/populate.js';
import { projectData, selectFields } from './compiler/select.js';
import { DEFAULT_RICH_TEXT_MODE, type PopulateTree, type RichTextMode } from './compiler/types.js';
import { readScopeFor } from './locales.js';
import { mediaIdsOf } from './media.js';
import { resolveModelById, type ContentModel } from './model.js';
import { targetsByModel } from './relations.js';
import { resolveSeoFields, seoFieldsOf } from './seo.js';

/**
 * The read side shared by the admin and delivery APIs: fetching heads under a policy, deciding which
 * relation targets a caller may see, populating, and projecting through the read mask.
 */
type MediaViewDependencies = Parameters<typeof toAssetViews>[0];

export type ReadEnvironment = {
  executor: Kysely<DB> | Transaction<DB>;
  snapshot: SchemaSnapshot;
  permissions: PermissionEvaluator;
  actor: Principal;
  /** The site read from (sites plan §H): heads, relation targets and media never cross it. */
  siteId: string;
  /** Admin reads see draft heads and every relation ID; delivery reads see published content only. */
  audience: 'admin' | 'delivery';
  source: HeadSource;
  /** Requested locale (the default when absent). */
  locale: string | undefined;
  /** Media storage for asset URLs; without it media fields stay asset IDs. */
  media?: MediaViewDependencies;
  /** Delivery reads: the shape of rich-text values, populated targets included (`?richText=`; the default when absent). */
  richText?: RichTextMode;
  /** Delivery reads with `?seo=resolved`: the site's SEO defaults, merged into SEO fields. */
  seo?: SeoDefaults;
};

/** Evaluated through the read's executor: a read inside a transaction never asks the pool for a second connection. */
export const readPolicy = (env: ReadEnvironment, modelId: string): Promise<Policy> =>
  env.permissions.evaluate(env.actor, { action: 'read', modelId }, env.executor);

/**
 * Heads of the given entries that the policy lets the caller read, served per the locale chain (or per
 * `locales` when given: GraphQL's `fallback: false` and `localizations`).
 */
export const fetchHeadsByIds = async (
  env: ReadEnvironment,
  model: ContentModel,
  policy: Policy,
  ids: readonly string[],
  locales?: LocaleScope,
): Promise<HeadRow[]> => {
  if (ids.length === 0 || !policy.allowed) {
    return [];
  }
  const rowFilter = compileRowFilter(policy.rowFilter, env.actor);
  const { rows } = compileHeadQuery({
    siteId: env.siteId,
    modelId: model.definition.id,
    source: env.source,
    locales: locales ?? readScopeFor(env.snapshot, model.definition, env.locale, { fallback: true }),
    conditions: [entryIdIn(ids), ...(rowFilter ? [rowFilter] : [])],
    orderBy: [],
  });
  return contentQueriesRepository.runHeadQuery(rows, env.executor);
};

/** Target heads read for relation visibility, by target model, for populate to reuse (same policy and locales). */
type FetchedTargets = Map<string, { ids: ReadonlySet<string>; rows: readonly HeadRow[] }>;

/**
 * Relation targets the caller may see in these rows: for delivery, only targets that are published (at the
 * same snapshot) and readable under their model's policy, so a published entry never leaks the ID of a
 * draft (brief §10). Admin reads see every ID (null). The heads read are returned for populate.
 */
const relationTargets = async (
  env: ReadEnvironment,
  model: ContentModel,
  rows: readonly HeadRow[],
  fields: readonly FieldDefinition[],
): Promise<{ visible: Set<string> | null; fetched: FetchedTargets }> => {
  const fetched: FetchedTargets = new Map();
  if (env.audience === 'admin') {
    return { visible: null, fetched };
  }
  const visible = new Set<string>();
  const targets = targetsByModel(
    model,
    rows.map((row) => row.data),
    fields,
  );
  for (const [targetModelId, ids] of targets) {
    const target = resolveModelById(env.snapshot, targetModelId);
    if (!target) {
      continue;
    }
    const policy = await readPolicy(env, targetModelId);
    const found = await fetchHeadsByIds(env, target, policy, [...ids]);
    found.forEach((row) => visible.add(row.entry_id));
    fetched.set(targetModelId, { ids, rows: found });
  }
  return { visible, fetched };
};

/**
 * `fetchHeadsByIds` for populate, answered from the heads relation visibility already read when it asked for
 * every one of these IDs under the same policy and locale scope (populate's default), else from the database.
 */
const fetchReusing =
  (fetched: FetchedTargets): PopulateEnvironment['fetch'] =>
  async (env, model, policy, ids) => {
    const known = fetched.get(model.definition.id);
    if (known && ids.every((id) => known.ids.has(id))) {
      const wanted = new Set(ids);
      return known.rows.filter((row) => wanted.has(row.entry_id));
    }
    return fetchHeadsByIds(env, model, policy, ids);
  };

/**
 * Whether projecting these rows reads anything more (relation targets, populated entries, asset views). When
 * not, a delivery read is complete in the one statement that fetched the rows (plan delivery-perf).
 */
export const needsFollowUpReads = (
  env: ReadEnvironment,
  model: ContentModel,
  rows: readonly HeadRow[],
  query: { fields: readonly FieldDefinition[] | null; populate: PopulateTree },
  policy: Policy,
): boolean => {
  if (query.populate.size > 0) {
    return true;
  }
  const fields = selectFields(model, policy.readMask, query.fields);
  const documents = rows.map((row) => row.data);
  return (
    (env.audience === 'delivery' && targetsByModel(model, documents, fields).size > 0) ||
    (env.media !== undefined &&
      (mediaIdsOf(model, documents, fields).size > 0 || seoImageIdOf(env, fields) !== undefined))
  );
};

/** The site's default social image a `?seo=resolved` read needs (when the response carries an SEO field). */
const seoImageIdOf = (env: ReadEnvironment, fields: readonly FieldDefinition[]): string | undefined =>
  env.seo?.imageId && seoFieldsOf(fields).length > 0 ? env.seo.imageId : undefined;

/** A default SEO image is shown only while it is a public image (never through a signed URL). */
export const isPublicImage = (view: Pick<MediaAssetView, 'visibility' | 'mimeType'>): boolean =>
  view.visibility === 'public' && view.mimeType.startsWith('image/');

type MediaViews = {
  /** Views by asset ID, in the audience's shape; null leaves IDs as stored. */
  byId: Map<string, { url: string }> | null;
  /** The default social image in the delivered shape, only when it is a live public image. */
  seoImage: unknown;
};

/**
 * Asset views for the media a response shows (media fields and rich-text images). Private assets get signed,
 * expiring URLs (package G); the read mask already decided whether the caller may see the field at all.
 * Delivery views carry only what a site needs, never storage keys or internal attribution.
 */
const loadMediaViews = async (
  env: ReadEnvironment,
  model: ContentModel,
  rows: readonly HeadRow[],
  fields: readonly FieldDefinition[],
): Promise<MediaViews> => {
  if (!env.media) {
    return { byId: null, seoImage: null };
  }
  const ids = mediaIdsOf(
    model,
    rows.map((row) => row.data),
    fields,
  );
  const seoImageId = seoImageIdOf(env, fields);
  if (seoImageId !== undefined) {
    ids.add(seoImageId);
  }
  if (ids.size === 0) {
    return { byId: new Map(), seoImage: null };
  }
  const assets = await mediaAssetsRepository.findLiveManyOnSite(env.siteId, [...ids], env.executor);
  const views = await toAssetViews(env.media, assets, env.executor);
  const shaped = (view: MediaAssetView) => (env.audience === 'delivery' ? toDeliveryAsset(view) : view);
  // Re-checked on every read: an image made private (or replaced by a non-image) after it was chosen never
  // appears, signed or not (rule 7).
  const seoImage = views.find((view) => view.id === seoImageId && isPublicImage(view));
  return {
    byId: new Map(views.map((view) => [view.id, shaped(view)])),
    seoImage: seoImage ? shaped(seoImage) : null,
  };
};

/** An asset as delivery shows it: what a site needs, never storage keys or internal attribution. */
export const toDeliveryAsset = (view: MediaAssetView) => ({
  id: view.id,
  filename: view.filename,
  mimeType: view.mimeType,
  sizeBytes: view.sizeBytes,
  width: view.width,
  height: view.height,
  alt: view.alt,
  caption: view.caption,
  focalPoint: view.focalPoint,
  url: view.url,
  urlExpiresAt: view.urlExpiresAt?.toISOString() ?? null,
  variants: view.variants
    .filter((variant) => variant.url !== null)
    .map(({ name, width, height, format, mimeType, url }) => ({
      name,
      width,
      height,
      format,
      mimeType,
      url,
    })),
});

export type ProjectedEntry = Record<string, unknown>;

/** System attributes first, then the readable, selected fields by API key. */
export const systemAttributes = (env: ReadEnvironment, row: HeadRow): Record<string, unknown> => ({
  id: row.entry_id,
  locale: row.locale,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(env.audience === 'delivery' ? { publishedAt: row.updated_at.toISOString() } : {}),
});

export const projectRows = async (
  env: ReadEnvironment,
  model: ContentModel,
  policy: Policy,
  rows: readonly HeadRow[],
  query: { fields: readonly FieldDefinition[] | null; populate: PopulateTree },
): Promise<Array<{ row: HeadRow; data: ProjectedEntry }>> => {
  const fields = selectFields(model, policy.readMask, query.fields);
  const { visible: visibleTargets, fetched } = await relationTargets(env, model, rows, fields);
  const populateEnv: PopulateEnvironment = {
    ...env,
    project: projectRows,
    fetch: fetchReusing(fetched),
    policyFor: readPolicy,
    system: systemAttributes,
  };
  const populated = await populateRelations(populateEnv, rows, fields, query.populate);
  const media = await loadMediaViews(env, model, rows, fields);
  return rows.map((row) => {
    const data = projectData(row.data, {
      model,
      fields,
      visibleTargets,
      populated,
      ...(env.audience === 'delivery' ? { richText: env.richText ?? DEFAULT_RICH_TEXT_MODE } : {}),
      mediaAssets: media.byId,
    });
    return {
      row,
      data: env.seo
        ? resolveSeoFields(
            env,
            { defaults: env.seo, image: media.seoImage },
            model,
            policy,
            fields,
            row,
            data,
          )
        : data,
    };
  });
};
