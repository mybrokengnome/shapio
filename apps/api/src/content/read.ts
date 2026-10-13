import type { FieldDefinition, SeoDefaults } from '@shapio/schema';
import type { Kysely, RawBuilder, Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import type { PermissionEvaluator, Policy, Principal } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as mediaAssetsRepository from '../repositories/mediaAssets.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { toAssetViews, type MediaAssetView } from '../services/mediaViews.js';
import {
  compileHeadQuery,
  type HeadQueryMember,
  type HeadRow,
  type HeadSource,
  type LocaleScope,
} from './compiler/compile.js';
import { entryIdIn } from './compiler/conditions.js';
import { compileRowFilter, hidesPrivateComponentFields, maskAllows, rowReadMask } from './compiler/policy.js';
import { populateRelations, type PopulateEnvironment } from './compiler/populate.js';
import { projectData, selectFields } from './compiler/select.js';
import { DEFAULT_RICH_TEXT_MODE, type PopulateTree, type RichTextMode } from './compiler/types.js';
import { groupByMember, readableMembers, type ReadMember } from './family.js';
import { readScopeFor } from './locales.js';
import { mediaIdsOf } from './media.js';
import { resolveModelById, type ContentModel } from './model.js';
import { targetsByModel } from './relations.js';
import { resolveSeoFields, seoFieldsOf } from './seo.js';
import { KINDS_KEY, MODEL_KEY } from './validator/index.js';

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
 * The plan members and shared conditions of a read over these members. A lone member's row filter stays a
 * plan condition, so a read of a model without kinds compiles exactly as it always has; with several, each
 * member carries its own.
 */
export const planMembers = (
  members: readonly ReadMember[],
  actor: Principal,
): { members: HeadQueryMember[]; conditions: RawBuilder<unknown>[] } => {
  const compiled = members.map((member) => ({
    modelId: member.model.definition.id,
    rowFilter: compileRowFilter(member.policy.rowFilter, actor),
  }));
  const [single] = compiled;
  if (compiled.length === 1 && single) {
    return { members: [{ modelId: single.modelId }], conditions: single.rowFilter ? [single.rowFilter] : [] };
  }
  return {
    members: compiled.map(({ modelId, rowFilter }) => ({
      modelId,
      ...(rowFilter ? { conditions: [rowFilter] } : {}),
    })),
    conditions: [],
  };
};

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
    members: [{ modelId: model.definition.id }],
    source: env.source,
    locales: locales ?? readScopeFor(env.snapshot, model.definition, env.locale, { fallback: true }),
    conditions: [entryIdIn(ids), ...(rowFilter ? [rowFilter] : [])],
    orderBy: [],
  });
  return contentQueriesRepository.runHeadQuery(rows, env.executor);
};

/** What a family fetch read: the readable members (with their policies) and their heads. */
export type FamilyHeads = { members: ReadMember[]; rows: HeadRow[] };

/**
 * Heads of the given entries over the model's family (a relation to a model accepts any of its kinds, plan
 * polymorphic-types), each member under its own read policy, served per the locale chain (or `locales`).
 * Members the caller may not read are left out.
 */
export const fetchFamilyHeadsByIds = async (
  env: ReadEnvironment,
  model: ContentModel,
  ids: readonly string[],
  locales?: LocaleScope,
): Promise<FamilyHeads> => {
  const members = await readableMembers(env.snapshot, model, (modelId) => readPolicy(env, modelId));
  if (ids.length === 0 || members.length === 0) {
    return { members, rows: [] };
  }
  const plan = planMembers(members, env.actor);
  const { rows } = compileHeadQuery({
    siteId: env.siteId,
    members: plan.members,
    source: env.source,
    // Every member shares the root's localization (plan polymorphic-types, D3).
    locales: locales ?? readScopeFor(env.snapshot, model.definition, env.locale, { fallback: true }),
    conditions: [entryIdIn(ids), ...plan.conditions],
    orderBy: [],
  });
  return { members, rows: await contentQueriesRepository.runHeadQuery(rows, env.executor) };
};

/** Target heads read for relation visibility, by target model, for populate to reuse (same policy and locales). */
type FetchedTargets = Map<string, { ids: ReadonlySet<string>; heads: FamilyHeads }>;

/**
 * Relation targets the caller may see in these rows: for delivery, only targets that are published (at the
 * same snapshot) and readable under their model's policy, so a published entry never leaks the ID of a
 * draft (brief §10). A relation to a model with kinds shows targets of any kind the caller may read. Admin
 * reads see every ID (null). The heads read are returned for populate.
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
    const heads = await fetchFamilyHeadsByIds(env, target, [...ids]);
    heads.rows.forEach((row) => visible.add(row.entry_id));
    fetched.set(targetModelId, { ids, heads });
  }
  return { visible, fetched };
};

/**
 * `fetchFamilyHeadsByIds` for populate, answered from the heads relation visibility already read when it
 * asked for every one of these IDs under the same policies and locale scope (populate's default), else from
 * the database.
 */
const fetchReusing =
  (fetched: FetchedTargets): PopulateEnvironment['fetch'] =>
  async (env, model, ids) => {
    const known = fetched.get(model.definition.id);
    if (known && ids.every((id) => known.ids.has(id))) {
      const wanted = new Set(ids);
      return {
        members: known.heads.members,
        rows: known.heads.rows.filter((row) => wanted.has(row.entry_id)),
      };
    }
    return fetchFamilyHeadsByIds(env, model, ids);
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
    needsMediaReads(env, model, rows, fields)
  );
};

/** Whether projecting these rows reads asset views (media fields, rich-text images, a default SEO image). */
export const needsMediaReads = (
  env: ReadEnvironment,
  model: ContentModel,
  rows: readonly HeadRow[],
  fields: readonly FieldDefinition[],
): boolean =>
  env.media !== undefined &&
  (mediaIdsOf(
    model,
    rows.map((row) => row.data),
    fields,
  ).size > 0 ||
    seoImageIdOf(env, fields) !== undefined);

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

/** The singular API IDs of a model's lineage, root first, the model last. */
export const kindLineage = (snapshot: ReadEnvironment['snapshot'], modelId: string): string[] =>
  [...snapshot.ancestors(modelId), modelId].flatMap((id) => {
    const apiKey = snapshot.byId.get(id)?.definition.apiKey;
    return apiKey === undefined ? [] : [apiKey];
  });

/**
 * System attributes first, then the readable, selected fields by API key. `__model` is the API ID of the
 * entry's own model, on every entry (plan polymorphic-types): a family read mixes kinds, and a client can rely
 * on it everywhere, as it does on `__component` in dynamic zones. `__kinds` is the kind's lineage, root first,
 * so a client can tell a Physical row from its Apparel kind without knowing the schema.
 */
export const systemAttributes = (env: ReadEnvironment, row: HeadRow): Record<string, unknown> => ({
  id: row.entry_id,
  [MODEL_KEY]: env.snapshot.byId.get(row.model_id)?.definition.apiKey ?? null,
  [KINDS_KEY]: kindLineage(env.snapshot, row.model_id),
  locale: row.locale,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  ...(env.audience === 'delivery' ? { publishedAt: row.updated_at.toISOString() } : {}),
});

/**
 * The selected fields this row shows: all of them unless the policy's read masks differ by row, then those
 * the row's own mask allows (a field granted only on the caller's own entries stays off everyone else's).
 */
const fieldsOnRow = (
  env: ReadEnvironment,
  policy: Policy,
  fields: readonly FieldDefinition[],
  row: HeadRow,
): readonly FieldDefinition[] => {
  if (!policy.rowReadMasks) {
    return fields;
  }
  const mask = rowReadMask(policy, env.actor, row);
  return fields.filter((field) => maskAllows(mask, field));
};

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
    system: systemAttributes,
  };
  const populated = await populateRelations(populateEnv, rows, fields, query.populate);
  const media = await loadMediaViews(env, model, rows, fields);
  return rows.map((row) => {
    const rowFields = fieldsOnRow(env, policy, fields, row);
    const data = projectData(row.data, {
      model,
      fields: rowFields,
      visibleTargets,
      populated,
      ...(env.audience === 'delivery'
        ? { richText: env.richText ?? DEFAULT_RICH_TEXT_MODE }
        : { keepUnresolvedMedia: true }),
      mediaAssets: media.byId,
      publicComponentFieldsOnly: hidesPrivateComponentFields(policy.readMask),
    });
    return {
      row,
      data: env.seo
        ? resolveSeoFields(
            env,
            { defaults: env.seo, image: media.seoImage },
            model,
            policy,
            rowFields,
            row,
            data,
          )
        : data,
    };
  });
};

/**
 * Rows of a family read projected each through its own member (plan polymorphic-types): the member's
 * effective fields, read mask, components and SEO fields. Without `fields=` a row carries every field its kind
 * has and the caller may read; with it, the named (shared) fields. Rows keep their order; a row of a model
 * that is not a member is left out.
 */
export const projectMemberRows = async (
  env: ReadEnvironment,
  members: readonly ReadMember[],
  rows: readonly HeadRow[],
  query: { fields: readonly FieldDefinition[] | null; populate: PopulateTree },
): Promise<Array<{ row: HeadRow; data: ProjectedEntry }>> => {
  const projected = new Map<HeadRow, ProjectedEntry>();
  for (const group of groupByMember(members, rows)) {
    for (const { row, data } of await projectRows(
      env,
      group.member.model,
      group.member.policy,
      group.rows,
      query,
    )) {
      projected.set(row, data);
    }
  }
  return rows.flatMap((row) => {
    const data = projected.get(row);
    return data ? [{ row, data }] : [];
  });
};
