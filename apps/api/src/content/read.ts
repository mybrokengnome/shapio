import type { FieldDefinition } from '@shapio/schema';
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
import type { PopulateTree } from './compiler/types.js';
import { readScopeFor } from './locales.js';
import { mediaIdsOf } from './media.js';
import { resolveModelById, type ContentModel } from './model.js';
import { targetsByModel } from './relations.js';

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
};

export const readPolicy = (env: ReadEnvironment, modelId: string): Promise<Policy> =>
  env.permissions.evaluate(env.actor, { action: 'read', modelId });

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

/**
 * Relation targets the caller may see in these rows: for delivery, only targets that are published (at the
 * same snapshot) and readable under their model's policy, so a published entry never leaks the ID of a
 * draft (brief §10). Admin reads see every ID (null).
 */
export const visibleRelationTargets = async (
  env: ReadEnvironment,
  model: ContentModel,
  rows: readonly HeadRow[],
  fields: readonly FieldDefinition[],
): Promise<Set<string> | null> => {
  if (env.audience === 'admin') {
    return null;
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
    (await fetchHeadsByIds(env, target, policy, [...ids])).forEach((row) => visible.add(row.entry_id));
  }
  return visible;
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
): Promise<Map<string, { url: string }> | null> => {
  if (!env.media) {
    return null;
  }
  const ids = mediaIdsOf(
    model,
    rows.map((row) => row.data),
    fields,
  );
  if (ids.size === 0) {
    return new Map();
  }
  const assets = await mediaAssetsRepository.findLiveManyOnSite(env.siteId, [...ids], env.executor);
  const views = await toAssetViews(env.media, assets);
  return new Map(views.map((view) => [view.id, env.audience === 'delivery' ? toDeliveryAsset(view) : view]));
};

const toDeliveryAsset = (view: MediaAssetView) => ({
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
  const visibleTargets = await visibleRelationTargets(env, model, rows, fields);
  const populateEnv: PopulateEnvironment = {
    ...env,
    project: projectRows,
    fetch: fetchHeadsByIds,
    policyFor: readPolicy,
    system: systemAttributes,
  };
  const populated = await populateRelations(populateEnv, rows, fields, query.populate);
  const mediaAssets = await loadMediaViews(env, model, rows, fields);
  return rows.map((row) => ({
    row,
    data: projectData(row.data, {
      model,
      fields,
      visibleTargets,
      populated,
      richTextHtml: env.audience === 'delivery',
      mediaAssets,
    }),
  }));
};
