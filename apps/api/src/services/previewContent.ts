import type { HeadSource } from '../content/compiler/compile.js';
import { entryIdIs } from '../content/compiler/conditions.js';
import { paginationMeta } from '../content/compiler/paginate.js';
import { everyRowReadMask } from '../content/compiler/policy.js';
import type { ContentQuery } from '../content/compiler/types.js';
import { entryNotFound } from '../content/errors.js';
import { familyIdsOf, kindsMetaOf, type ReadMember } from '../content/family.js';
import { modelNotFound, resolveModelById, resolveRouteModel, type ContentModel } from '../content/model.js';
import { lensQueryVisibility } from '../content/read.js';
import { AppError } from '../helpers/appError.js';
import { intersectMasks, type FieldVisibilityLookup } from '../permissions/policy.js';
import {
  DENIED_POLICY,
  type FieldMask,
  type PermissionEvaluator,
  type Policy,
  type Principal,
} from '../permissions/types.js';
import { loadAdminPrincipal } from '../publishing/principals.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import type { PreviewTokenSummary } from '../repositories/previewTokens.js';
import { previewLensBudgetKey } from '../schema/lens/budget.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import {
  activeLens,
  loadSchemaLens,
  namesSchemaVersion,
  type ContentServiceContext,
} from './contentAccess.js';
import { assertItemParameters } from './contentDelivery.js';
import {
  clientRouteAfterAuthorization,
  lensQueryOf,
  schemaVersionMetaOf,
  withClientQueryNames,
} from './contentDeliveryLens.js';
import { readEntryPage, readOneEntry, type DeliveryRead } from './contentDeliveryReads.js';
import { familyMembersFor, parseQueryFor } from './contentReads.js';
import { resolvePreviewToken } from './previewTokens.js';

/**
 * `/api/preview/content/:modelKey[/:id]` (brief §7): DRAFT content for a site's preview, in the delivery
 * shape, authorized by a preview token. Reads are evaluated with the token creator's CURRENT permissions
 * (so revoking their role ends the preview), limited to read, to the token's model, entry and locale, and to
 * fields a delivery reader would see (`public` fields within the creator's read mask), so a shared preview
 * link never shows more than the published site would.
 *
 * The read itself is the delivery read (services/contentDelivery.ts) over draft heads.
 */
const DRAFT: HeadSource = { kind: 'heads', state: 'draft' };
const ITEM_PARAMETERS = new Set(['fields', 'populate', 'locale', 'richText', 'seo']);

export type PreviewMeta = { locale: string; preview: true; expiresAt: Date };

const unauthenticated = () =>
  new AppError(401, 'INVALID_PREVIEW_TOKEN', 'The preview token is invalid, expired or revoked');

const allows = (mask: Policy['readMask'], fieldId: string) =>
  mask.mode === 'all' || mask.fieldIds.includes(fieldId);

/**
 * Wraps the evaluator: read only, as the creator, never beyond what the creator may read. Field visibility
 * is what the site would see: with a delivery role bound, exactly that role's grants (non-public fields it
 * names included), evaluated as a delivery token of that role; without one, the public fields.
 */
export const createPreviewPermissions = (
  base: PermissionEvaluator,
  creator: Principal,
  fields: FieldVisibilityLookup,
  binding: { tokenId: string; deliveryRoleId: string | null; siteId: string },
): PermissionEvaluator => {
  const site: Principal | undefined = binding.deliveryRoleId
    ? {
        kind: 'token',
        tokenId: `preview:${binding.tokenId}`,
        scope: 'delivery',
        roleId: binding.deliveryRoleId,
        siteId: binding.siteId,
      }
    : undefined;
  return {
    evaluate: async (_principal, request, executor): Promise<Policy> => {
      if (request.action !== 'read') {
        return DENIED_POLICY;
      }
      const policy = await base.evaluate(creator, request, executor);
      const modelFields = await fields.getModelFields(request.modelId, executor);
      if (!policy.allowed || !modelFields) {
        return DENIED_POLICY;
      }
      const sitePolicy = site ? await base.evaluate(site, request, executor) : undefined;
      if (sitePolicy && !sitePolicy.allowed) {
        return DENIED_POLICY;
      }
      // The site's view: its delivery token owns no entry, so only the fields its role shows on every row.
      const siteMask = sitePolicy ? everyRowReadMask(sitePolicy) : undefined;
      const visible = modelFields.filter(
        (field) =>
          allows(policy.readMask, field.id) && (siteMask ? allows(siteMask, field.id) : field.public),
      );
      const siteVisible: FieldMask = {
        mode: 'only',
        fieldIds: modelFields
          .filter((field) => (siteMask ? allows(siteMask, field.id) : field.public))
          .map((field) => field.id),
        componentFields: 'public',
      };
      const rowReadMasks = policy.rowReadMasks && {
        everyRow: intersectMasks(policy.rowReadMasks.everyRow, siteVisible),
        when: policy.rowReadMasks.when.map((extra) => ({
          ...extra,
          mask: intersectMasks(extra.mask, siteVisible),
        })),
      };
      return {
        ...policy,
        // What the site sees: a component's non-public fields stay hidden, as for any delivery audience.
        readMask: { mode: 'only', fieldIds: visible.map((field) => field.id), componentFields: 'public' },
        rowReadMasks,
        writeMask: DENIED_POLICY.writeMask,
        rowWriteMasks: DENIED_POLICY.rowWriteMasks,
      };
    },
    canPerform: () => Promise.resolve(false),
    canPerformOnSite: () => Promise.resolve(false),
  };
};

export type PreviewRequest = {
  token: string | undefined;
  /** The route key (`routeKeyOf`): plural API ID of a collection, API ID of a singleton. */
  modelKey: string;
  rawQuery: string;
  /**
   * A schema version the request could not even name (malformed, repeated, header and parameter disagreeing):
   * answered once the preview token is checked. A version it names is in the context (`lensRequest`), and
   * `modelKey` and `rawQuery` are then the client's, translated only after the token is checked.
   */
  versionError?: AppError | null;
};

type PreviewScope = {
  token: PreviewTokenSummary;
  context: ContentServiceContext;
  model: ContentModel;
  policy: Policy;
  /** Every kind of the route's model the preview may read (plan polymorphic-types). */
  members: ReadMember[];
};

/**
 * The model a preview route reads: the route's model, or on an interface's route (plan interfaces) the
 * token's own model when it is a member, read like a list of that model (the token reads its one entry).
 */
const previewModelOf = (snapshot: SchemaSnapshot, routeKey: string, tokenModelId: string): ContentModel => {
  const contract = snapshot.interfacesByRouteKey.get(routeKey);
  if (!contract || snapshot.modelsByRouteKey.has(routeKey)) {
    return resolveRouteModel(snapshot, routeKey);
  }
  const member = snapshot.implementedBy(contract.definition.id).includes(tokenModelId)
    ? resolveModelById(snapshot, tokenModelId)
    : undefined;
  if (!member) {
    throw new AppError(403, 'PREVIEW_SCOPE', 'This preview token is for another model');
  }
  return member;
};

/** Resolves the token and builds a content context that reads as the preview principal. */
const authorize = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest,
): Promise<PreviewScope> => {
  const token = request.token ? await resolvePreviewToken(runtime, request.token) : undefined;
  if (!token) {
    throw unauthenticated();
  }
  const model = previewModelOf(base.snapshot, request.modelKey, token.model_id);
  // The token is for its entry's own kind; any ancestor's route reads it too (plan polymorphic-types).
  if (!familyIdsOf(base.snapshot, model.definition.id).includes(token.model_id)) {
    throw new AppError(403, 'PREVIEW_SCOPE', 'This preview token is for another model');
  }
  const creator = await loadAdminPrincipal(
    runtime.db,
    token.created_by,
    `preview:${token.id}`,
    token.site_id,
  ).catch(() => {
    throw unauthenticated();
  });
  const permissions = createPreviewPermissions(base.permissions, creator, fields, {
    tokenId: token.id,
    deliveryRoleId: token.delivery_role_id,
    siteId: token.site_id,
  });
  // The preview token's site is the request's site (the routes resolve it from the token); a token of another
  // site never reads here.
  if (base.site.id !== token.site_id) {
    throw new AppError(403, 'SITE_MISMATCH', 'This preview token belongs to another workspace');
  }
  const context: ContentServiceContext = { ...base, actor: creator, permissions };
  const policy = await permissions.evaluate(creator, { action: 'read', modelId: model.definition.id });
  if (!policy.allowed) {
    throw new AppError(403, 'FORBIDDEN', `The preview token may not read "${request.modelKey}"`);
  }
  return { token, context, model, policy, members: await familyMembersFor(context, model, policy) };
};

/** The token's locale wins; a different `locale` in the query is refused rather than silently ignored. */
const scopedQuery = (scope: PreviewScope, rawQuery: string): ContentQuery => {
  const query = withClientQueryNames(scope.context, scope.model.definition.id, () =>
    parseQueryFor(scope.context, scope.model, scope.policy, rawQuery, {
      allowSnapshot: false,
      allowRichText: true,
      allowSeo: true,
      members: scope.members,
    }),
  );
  if (scope.token.locale && query.locale && query.locale !== scope.token.locale) {
    throw new AppError(403, 'PREVIEW_SCOPE', `This preview token is for locale "${scope.token.locale}"`);
  }
  return scope.token.locale ? { ...query, locale: scope.token.locale } : query;
};

/** A preview token reads its one entry only. */
const entryCondition = (token: PreviewTokenSummary) => [entryIdIs(token.entry_id)];

const readOf = (scope: PreviewScope, query: ContentQuery): DeliveryRead => ({
  context: scope.context,
  source: DRAFT,
  model: scope.model,
  policy: scope.policy,
  members: scope.members,
  query,
  fallback: true,
  conditions: entryCondition(scope.token),
});

const metaOf = (scope: PreviewScope, query: ContentQuery) => ({
  locale: query.locale ?? scope.context.snapshot.defaultLocale,
  preview: true as const,
  expiresAt: scope.token.expires_at,
  // Through a schema lens: both versions, as delivery reports them.
  ...schemaVersionMetaOf(scope.context),
});

/**
 * `meta.kinds` of a family list, as delivery reports it: through a schema lens in the client's version's names
 * (plan schema-lenses).
 */
const kindsOf = (scope: PreviewScope) => {
  const view = activeLens(scope.context)?.view;
  const named = (model: ContentModel) => (view ? resolveModelById(view, model.definition.id) : model);
  const route = named(scope.model);
  const members = scope.members.flatMap((member) => {
    const model = named(member.model);
    return model ? [{ ...member, model }] : [];
  });
  const kinds = route ? kindsMetaOf(view ?? scope.context.snapshot, route, members) : undefined;
  return kinds ? { kinds } : {};
};

/** Checks the preview token and the route as a read would, with nothing else. */
export const authorizePreview = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest,
): Promise<void> => {
  await authorize(runtime, base, fields, request);
};

const isRefusal = (error: unknown) =>
  error instanceof AppError && (error.statusCode === 401 || error.statusCode === 403);

/**
 * `authorize` for a request that may name a schema version: the token is checked exactly as without one (a
 * refused request gets the answer the client's route key gives today), and only then is the request read
 * through the lens, its query translated (plan schema-lenses).
 */
const authorizeRequest = async (
  runtime: PublishingRuntime,
  unloaded: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest,
): Promise<{ scope: PreviewScope; rawQuery: string }> => {
  if (!request.versionError && !namesSchemaVersion(unloaded)) {
    return { scope: await authorize(runtime, unloaded, fields, request), rawQuery: request.rawQuery };
  }
  // The preview token first, exactly as without a version; for a route key today's schema knows, the whole
  // preview check. Nothing about the version is read or charged before.
  const token = request.token ? await resolvePreviewToken(runtime, request.token) : undefined;
  if (!token) {
    throw unauthenticated();
  }
  const { snapshot } = unloaded;
  if (
    snapshot.modelsByRouteKey.has(request.modelKey) ||
    snapshot.interfacesByRouteKey.has(request.modelKey)
  ) {
    await authorize(runtime, unloaded, fields, request);
  }
  if (request.versionError) {
    throw request.versionError;
  }
  // Preview requests build lenses on the preview token's own budget.
  const base = await loadSchemaLens(unloaded, previewLensBudgetKey(token.id));
  // A preview token reads its own entry's type only: no other definition is named to it.
  const clientRoute = await clientRouteAfterAuthorization(base, request.modelKey, (definitionId) =>
    Promise.resolve(definitionId === token.model_id),
  );
  if (!clientRoute) {
    return { scope: await authorize(runtime, base, fields, request), rawQuery: request.rawQuery };
  }
  const asWithoutVersion = () =>
    authorize(runtime, base, fields, { ...request, modelKey: clientRoute.clientRouteKey });
  if (clientRoute.routeKey === null) {
    await asWithoutVersion();
    throw modelNotFound(clientRoute.clientRouteKey);
  }
  let scope: PreviewScope;
  try {
    scope = await authorize(runtime, base, fields, { ...request, modelKey: clientRoute.routeKey });
  } catch (error) {
    if (isRefusal(error)) {
      await asWithoutVersion();
    }
    throw error;
  }
  const client = activeLens(scope.context)?.view;
  const lensed = lensQueryOf(
    scope.context,
    scope.model.definition.id,
    clientRoute.clientRouteKey,
    request.rawQuery,
    lensQueryVisibility(
      client ? resolveModelById(client, scope.model.definition.id) : undefined,
      scope.model,
      scope.policy,
    ),
  );
  return { scope: { ...scope, context: lensed.context }, rawQuery: lensed.rawQuery };
};

export const listPreview = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest,
) => {
  const { scope, rawQuery } = await authorizeRequest(runtime, base, fields, request);
  const query = scopedQuery(scope, rawQuery);
  const { entries, limit, total } = await readEntryPage(readOf(scope, query));
  return {
    data: entries,
    meta: {
      ...metaOf(scope, query),
      pagination: paginationMeta(query.page, limit, total),
      ...kindsOf(scope),
    },
  };
};

export const getPreview = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest & { id: string },
) => {
  assertItemParameters(request.rawQuery, ITEM_PARAMETERS);
  const { scope, rawQuery } = await authorizeRequest(runtime, base, fields, request);
  if (scope.token.entry_id !== request.id) {
    throw new AppError(403, 'PREVIEW_SCOPE', 'This preview token is for another entry');
  }
  const query = scopedQuery(scope, rawQuery);
  const { entry } = await readOneEntry(readOf(scope, query), request.id);
  if (!entry) {
    throw entryNotFound(request.id);
  }
  return { data: entry, meta: metaOf(scope, query) };
};
