import type { HeadSource } from '../content/compiler/compile.js';
import { paginationMeta, type Pagination } from '../content/compiler/paginate.js';
import { queryInvalid, type ContentQuery } from '../content/compiler/types.js';
import { entryNotFound, snapshotInvalid } from '../content/errors.js';
import { resolveModel, type ContentModel } from '../content/model.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import type { UsageRecorder } from '../usage/aggregator.js';
import { usagePrincipalKey } from '../usage/keys.js';
import { restFieldReads } from '../usage/restFieldReads.js';
import type { ContentServiceContext } from './contentAccess.js';
import { readEntryPage, readOneEntry } from './contentDeliveryReads.js';
import { parseQueryFor } from './contentReads.js';
import { assertMayReadDrafts } from './draftAccess.js';

/**
 * The delivery API (build plan §4.E6): published heads (drafts only for callers allowed them, plan
 * drafts-mode), through the permission evaluator (delivery tokens, app users, anonymous callers). Each
 * response reads one consistent moment (one statement, or a REPEATABLE READ transaction when it needs more:
 * `contentDeliveryReads.ts`; a live read's relation visibility is the exception, checked against the live
 * state on the pool) and reports the publication sequence it saw, which a site build can pin with
 * `?snapshot=N`.
 */
export type DeliveryMeta = {
  /** The requested locale (or the default); each entry's own `locale` says which one served it. */
  locale: string;
  /** Publication sequence number this response reflects. */
  snapshot: number;
  /** Draft reads only (`?publicationState=draft`); published responses carry no such member. */
  publicationState?: 'draft';
};

export type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: DeliveryMeta & { pagination: Pagination };
};
export type DeliveryItem = { data: Record<string, unknown>; meta: DeliveryMeta };

/**
 * Read variants GraphQL exposes as arguments:
 * - `fallback: false` serves the requested locale only, never a fallback locale (ADR 0004).
 * - `drafts: true` reads draft heads in the delivery shape (GraphQL `publicationState: DRAFT`; REST and
 *   `@shapio/local` ask with `?publicationState=draft`). This service checks the caller may (draftAccess.ts).
 */
export type DeliveryReadOptions = {
  fallback?: boolean;
  drafts?: boolean;
  /**
   * Field usage counters (REST only). GraphQL counts its own selections once per operation
   * (plugins/graphql.ts), so its root reads through this service pass none.
   */
  usage?: UsageRecorder;
  /**
   * Runs usage recording after the response is sent (REST passes the request's after-response queue); without
   * it the read records before returning.
   */
  defer?: (task: () => Promise<void>) => void;
};

const readableModel = async (context: ContentServiceContext, modelKey: string) => {
  const model = resolveModel(context.snapshot, modelKey);
  const policy = await context.permissions.evaluate(context.actor, {
    action: 'read',
    modelId: model.definition.id,
  });
  if (!policy.allowed) {
    throw context.actor.kind === 'anonymous'
      ? new AppError(401, 'UNAUTHENTICATED', 'This content needs a delivery token')
      : new AppError(403, 'FORBIDDEN', `Your token may not read "${modelKey}"`);
  }
  return { model, policy };
};

/** Whether a read asks for drafts: GraphQL's option, or `?publicationState=draft`. */
const readsDrafts = (query: ContentQuery, options: DeliveryReadOptions): boolean =>
  options.drafts === true || query.publicationState === 'draft';

/**
 * A draft read must be allowed: `read` was checked already; `readDrafts` (or an admin principal) is checked
 * here.
 */
const authorizeDrafts = async (
  context: ContentServiceContext,
  model: ContentModel,
  modelKey: string,
  drafts: boolean,
): Promise<void> => {
  if (drafts) {
    await assertMayReadDrafts(context, model.definition.id, modelKey);
  }
};

/** The heads a read serves: drafts, a pinned snapshot, or the published heads. */
const sourceOf = (query: ContentQuery, drafts: boolean): HeadSource => {
  if (query.snapshot !== undefined && drafts) {
    throw queryInvalid('snapshot reads published content; it cannot be combined with drafts');
  }
  return drafts
    ? { kind: 'heads', state: 'draft' }
    : query.snapshot !== undefined
      ? { kind: 'snapshot', seq: query.snapshot }
      : { kind: 'heads', state: 'published' };
};

/** A pinned snapshot must already exist: checked against the sequence the read itself saw. */
const snapshotCheck =
  (query: ContentQuery) =>
  (current: number): void => {
    if (query.snapshot !== undefined && query.snapshot > current) {
      throw snapshotInvalid(query.snapshot, current);
    }
  };

/**
 * Counts a successful REST read for field usage (plan developer-face §5): once per request, after the
 * projection, by principal. Admin users and draft reads are never counted.
 */
const recordUsage = async (
  context: ContentServiceContext,
  options: DeliveryReadOptions,
  model: ContentModel,
  policy: Policy,
  query: ContentQuery,
) => {
  const principalKey = usagePrincipalKey(context.actor);
  if (!options.usage || readsDrafts(query, options) || principalKey === null) {
    return;
  }
  const reads = await restFieldReads({
    snapshot: context.snapshot,
    model,
    policy,
    query,
    policyFor: (modelId) => context.permissions.evaluate(context.actor, { action: 'read', modelId }),
  });
  options.usage.recordRequest(context.site.id, principalKey, query.snapshot ?? null);
  options.usage.recordFieldReads(context.site.id, principalKey, model.definition.id, reads);
};

/** Records usage after the response when the caller can defer it (REST), else before returning. */
const afterRead = async (options: DeliveryReadOptions, task: () => Promise<void>) => {
  if (options.defer) {
    options.defer(task);
    return;
  }
  await task();
};

const ITEM_PARAMETERS = new Set([
  'fields',
  'populate',
  'locale',
  'snapshot',
  'richText',
  'seo',
  'publicationState',
]);

const DELIVERY_PARSE = {
  allowSnapshot: true,
  allowRichText: true,
  allowSeo: true,
  allowPublicationState: true,
} as const;

/** Meta every delivery response carries; draft reads add `publicationState` (published ones are unchanged). */
const metaOf = (locale: string, snapshot: number, drafts: boolean): DeliveryMeta =>
  drafts ? { locale, snapshot, publicationState: 'draft' } : { locale, snapshot };

/** Reading one entry takes only these query parameters; anything else is refused, not ignored. */
export const assertItemParameters = (rawQuery: string, allowed: ReadonlySet<string>): void => {
  const unsupported = [...new URLSearchParams(rawQuery).keys()].find(
    (key) => !allowed.has(key.split('[')[0] ?? key),
  );
  if (unsupported !== undefined) {
    throw queryInvalid(`"${unsupported}" is not supported when reading one entry`);
  }
};

/** `GET /api/content/:modelKey`: a page of a collection, or a singleton's one entry. */
export const listDelivery = async (
  context: ContentServiceContext,
  modelKey: string,
  rawQuery: string,
  options: DeliveryReadOptions = {},
): Promise<DeliveryList | DeliveryItem> => {
  const { model, policy } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, DELIVERY_PARSE);
  const drafts = readsDrafts(query, options);
  const source = sourceOf(query, drafts);
  await authorizeDrafts(context, model, modelKey, drafts);
  const locale = query.locale ?? context.snapshot.defaultLocale;
  const singleton = model.definition.kind === 'singleton';
  const { entries, limit, total, seq } = await readEntryPage(
    { context, source, model, policy, query, fallback: options.fallback ?? true },
    { total: !singleton, check: snapshotCheck(query) },
  );
  const snapshot = query.snapshot ?? seq;
  let result: DeliveryList | DeliveryItem;
  if (singleton) {
    const [entry] = entries;
    if (!entry) {
      throw entryNotFound(modelKey);
    }
    result = { data: entry, meta: metaOf(locale, snapshot, drafts) };
  } else {
    result = {
      data: entries,
      meta: { ...metaOf(locale, snapshot, drafts), pagination: paginationMeta(query.page, limit, total) },
    };
  }
  await afterRead(options, () => recordUsage(context, options, model, policy, query));
  return result;
};

/**
 * `GET /api/content/:modelKey/:id`: one published entry (404 for unpublished, unknown or unreadable entries);
 * with drafts, the entry's draft.
 */
export const getDelivery = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  rawQuery: string,
  options: DeliveryReadOptions = {},
): Promise<DeliveryItem> => {
  assertItemParameters(rawQuery, ITEM_PARAMETERS);
  const { model, policy } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, DELIVERY_PARSE);
  const drafts = readsDrafts(query, options);
  const source = sourceOf(query, drafts);
  await authorizeDrafts(context, model, modelKey, drafts);
  const { entry, seq } = await readOneEntry(
    { context, source, model, policy, query, fallback: options.fallback ?? true },
    id,
    { check: snapshotCheck(query) },
  );
  if (!entry) {
    throw entryNotFound(id);
  }
  await afterRead(options, () => recordUsage(context, options, model, policy, query));
  return {
    data: entry,
    meta: metaOf(query.locale ?? context.snapshot.defaultLocale, query.snapshot ?? seq, drafts),
  };
};
