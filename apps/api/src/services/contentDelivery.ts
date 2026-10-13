import type { HeadSource } from '../content/compiler/compile.js';
import { paginationMeta, type Pagination } from '../content/compiler/paginate.js';
import { queryInvalid, type ContentQuery } from '../content/compiler/types.js';
import { entryNotFound, snapshotInvalid } from '../content/errors.js';
import { kindsMetaOf, type KindMeta, type ReadMember } from '../content/family.js';
import { resolveModel, type ContentModel } from '../content/model.js';
import { MODEL_KEY } from '../content/validator/index.js';
import { AppError } from '../helpers/appError.js';
import type { UsageRecorder } from '../usage/aggregator.js';
import { usagePrincipalKey } from '../usage/keys.js';
import { restFieldReads } from '../usage/restFieldReads.js';
import type { ContentServiceContext } from './contentAccess.js';
import { readEntryPage, readOneEntry } from './contentDeliveryReads.js';
import { familyMembersFor, parseQueryFor } from './contentReads.js';
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
  /** Publication sequence number this response reflects; null on draft reads, which cannot be pinned. */
  snapshot: number | null;
  /** Draft reads only (`?publicationState=draft`); published responses carry no such member. */
  publicationState?: 'draft';
};

export type DeliveryList = {
  data: Array<Record<string, unknown>>;
  /** `kinds`: a model with kinds lists its family; the kinds the caller may read (plan polymorphic-types). */
  meta: DeliveryMeta & { pagination: Pagination; kinds?: KindMeta[] };
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

/**
 * The route's model and the caller's read policy (401/403 when it may not read it), and the kinds a read of
 * the route covers: every member of the model's family the caller may read (plan polymorphic-types).
 */
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
  return { model, policy, members: await familyMembersFor(context, model, policy) };
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
 * projection, by principal. Admin users and draft reads are never counted. A family read counts each kind's
 * fields under that kind, for the kinds the response carried (`shown`, by API ID); a read of one model
 * counts under it as always.
 */
const recordUsage = async (
  context: ContentServiceContext,
  options: DeliveryReadOptions,
  members: readonly ReadMember[],
  query: ContentQuery,
  shown: ReadonlySet<unknown>,
) => {
  const principalKey = usagePrincipalKey(context.actor);
  if (!options.usage || readsDrafts(query, options) || principalKey === null) {
    return;
  }
  options.usage.recordRequest(context.site.id, principalKey, query.snapshot ?? null);
  const counted =
    members.length === 1 ? members : members.filter((member) => shown.has(member.model.definition.apiKey));
  for (const { model, policy } of counted) {
    const reads = await restFieldReads({
      snapshot: context.snapshot,
      model,
      policy,
      query,
      policyFor: (modelId) => context.permissions.evaluate(context.actor, { action: 'read', modelId }),
    });
    options.usage.recordFieldReads(context.site.id, principalKey, model.definition.id, reads);
  }
};

/** The kinds (API IDs) among delivered entries. */
const kindsOf = (entries: ReadonlyArray<Record<string, unknown>>): Set<unknown> =>
  new Set(entries.map((entry) => entry[MODEL_KEY]));

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

/**
 * Meta every delivery response carries. Draft reads report `snapshot: null` (drafts cannot be pinned, as in
 * GraphQL) and add `publicationState`; published ones are unchanged.
 */
const metaOf = (locale: string, snapshot: number, drafts: boolean): DeliveryMeta =>
  drafts ? { locale, snapshot: null, publicationState: 'draft' } : { locale, snapshot };

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
  const { model, policy, members } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, { ...DELIVERY_PARSE, members });
  const drafts = readsDrafts(query, options);
  const source = sourceOf(query, drafts);
  await authorizeDrafts(context, model, modelKey, drafts);
  const locale = query.locale ?? context.snapshot.defaultLocale;
  const singleton = model.definition.kind === 'singleton';
  const { entries, limit, total, seq } = await readEntryPage(
    { context, source, model, policy, members, query, fallback: options.fallback ?? true },
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
    const kinds = kindsMetaOf(context.snapshot, model, members);
    result = {
      data: entries,
      meta: {
        ...metaOf(locale, snapshot, drafts),
        pagination: paginationMeta(query.page, limit, total),
        ...(kinds ? { kinds } : {}),
      },
    };
  }
  await afterRead(options, () => recordUsage(context, options, members, query, kindsOf(entries)));
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
  const { model, policy, members } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, { ...DELIVERY_PARSE, members });
  const drafts = readsDrafts(query, options);
  const source = sourceOf(query, drafts);
  await authorizeDrafts(context, model, modelKey, drafts);
  const { entry, seq } = await readOneEntry(
    { context, source, model, policy, members, query, fallback: options.fallback ?? true },
    id,
    { check: snapshotCheck(query) },
  );
  if (!entry) {
    throw entryNotFound(id);
  }
  await afterRead(options, () => recordUsage(context, options, members, query, kindsOf([entry])));
  return {
    data: entry,
    meta: metaOf(query.locale ?? context.snapshot.defaultLocale, query.snapshot ?? seq, drafts),
  };
};
