import type { HeadSource } from '../content/compiler/compile.js';
import { entryIdIs } from '../content/compiler/conditions.js';
import { paginationMeta } from '../content/compiler/paginate.js';
import type { ContentQuery } from '../content/compiler/types.js';
import { entryNotFound } from '../content/errors.js';
import { resolveRouteModel, type ContentModel } from '../content/model.js';
import type { ReadEnvironment } from '../content/read.js';
import { AppError } from '../helpers/appError.js';
import type { FieldVisibilityLookup } from '../permissions/policy.js';
import {
  DENIED_POLICY,
  type PermissionEvaluator,
  type Policy,
  type Principal,
} from '../permissions/types.js';
import { loadAdminPrincipal } from '../publishing/principals.js';
import type { PublishingRuntime } from '../publishing/runtime.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import type { PreviewTokenSummary } from '../repositories/previewTokens.js';
import type { ContentServiceContext } from './contentAccess.js';
import { assertItemParameters, deliveryEnvironment, readEntryPage, readOneEntry } from './contentDelivery.js';
import { parseQueryFor } from './contentReads.js';
import { resolvePreviewToken } from './previewTokens.js';

/**
 * `/api/preview/content/:modelKey[/:id]` (brief §7): DRAFT content for a site's preview, in the delivery
 * shape, authorised by a preview token. Reads are evaluated with the token creator's CURRENT permissions
 * (so revoking their role ends the preview), limited to read, to the token's model, entry and locale, and to
 * fields a delivery reader would see (`public` fields within the creator's read mask), so a shared preview
 * link never shows more than the published site would.
 *
 * The read itself is the delivery read (services/contentDelivery.ts) over draft heads.
 */
const DRAFT: HeadSource = { kind: 'heads', state: 'draft' };
const ITEM_PARAMETERS = new Set(['fields', 'populate', 'locale']);

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
    evaluate: async (_principal, request): Promise<Policy> => {
      if (request.action !== 'read') {
        return DENIED_POLICY;
      }
      const policy = await base.evaluate(creator, request);
      const modelFields = await fields.getModelFields(request.modelId);
      if (!policy.allowed || !modelFields) {
        return DENIED_POLICY;
      }
      const sitePolicy = site ? await base.evaluate(site, request) : undefined;
      if (sitePolicy && !sitePolicy.allowed) {
        return DENIED_POLICY;
      }
      const visible = modelFields.filter(
        (field) =>
          allows(policy.readMask, field.id) &&
          (sitePolicy ? allows(sitePolicy.readMask, field.id) : field.public),
      );
      return {
        ...policy,
        readMask: { mode: 'only', fieldIds: visible.map((field) => field.id) },
        writeMask: DENIED_POLICY.writeMask,
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
};

type PreviewScope = {
  token: PreviewTokenSummary;
  context: ContentServiceContext;
  model: ContentModel;
  policy: Policy;
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
  const model = resolveRouteModel(base.snapshot, request.modelKey);
  if (model.definition.id !== token.model_id) {
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
    throw new AppError(403, 'SITE_MISMATCH', 'This preview token belongs to another site');
  }
  const context: ContentServiceContext = { ...base, actor: creator, permissions };
  const policy = await permissions.evaluate(creator, { action: 'read', modelId: model.definition.id });
  if (!policy.allowed) {
    throw new AppError(403, 'FORBIDDEN', `The preview token may not read "${request.modelKey}"`);
  }
  return { token, context, model, policy };
};

/** The token's locale wins; a different `locale` in the query is refused rather than silently ignored. */
const scopedQuery = (scope: PreviewScope, rawQuery: string): ContentQuery => {
  const query = parseQueryFor(scope.context, scope.model, scope.policy, rawQuery, { allowSnapshot: false });
  if (scope.token.locale && query.locale && query.locale !== scope.token.locale) {
    throw new AppError(403, 'PREVIEW_SCOPE', `This preview token is for locale "${scope.token.locale}"`);
  }
  return scope.token.locale ? { ...query, locale: scope.token.locale } : query;
};

/** A preview token reads its one entry only. */
const entryCondition = (token: PreviewTokenSummary) => [entryIdIs(token.entry_id)];

const readOf = (scope: PreviewScope, executor: ReadEnvironment['executor'], query: ContentQuery) => ({
  context: scope.context,
  env: deliveryEnvironment(scope.context, executor, DRAFT, query.locale),
  model: scope.model,
  policy: scope.policy,
  query,
  fallback: true,
  conditions: entryCondition(scope.token),
});

const metaOf = (scope: PreviewScope, query: ContentQuery) => ({
  locale: query.locale ?? scope.context.snapshot.defaultLocale,
  preview: true as const,
  expiresAt: scope.token.expires_at,
});

export const listPreview = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest,
) => {
  const scope = await authorize(runtime, base, fields, request);
  const query = scopedQuery(scope, request.rawQuery);
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const { entries, limit, count } = await readEntryPage(readOf(scope, trx, query));
    return {
      data: entries,
      meta: { ...metaOf(scope, query), pagination: paginationMeta(query.page, limit, await count()) },
    };
  }, scope.context.db);
};

export const getPreview = async (
  runtime: PublishingRuntime,
  base: ContentServiceContext,
  fields: FieldVisibilityLookup,
  request: PreviewRequest & { id: string },
) => {
  assertItemParameters(request.rawQuery, ITEM_PARAMETERS);
  const scope = await authorize(runtime, base, fields, request);
  if (scope.token.entry_id !== request.id) {
    throw new AppError(403, 'PREVIEW_SCOPE', 'This preview token is for another entry');
  }
  const query = scopedQuery(scope, request.rawQuery);
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const entry = await readOneEntry(readOf(scope, trx, query), request.id);
    if (!entry) {
      throw entryNotFound(request.id);
    }
    return { data: entry, meta: metaOf(scope, query) };
  }, scope.context.db);
};
