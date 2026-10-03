import { sql, type RawBuilder } from 'kysely';
import { compileHeadQuery, type HeadSource } from '../content/compiler/compile.js';
import { paginationMeta, toLimitOffset, type Pagination } from '../content/compiler/paginate.js';
import { maskAllows } from '../content/compiler/policy.js';
import { compileOrderBy, defaultSortTerms } from '../content/compiler/sort.js';
import { queryInvalid, type ContentQuery } from '../content/compiler/types.js';
import { entryNotFound, snapshotInvalid } from '../content/errors.js';
import { readScopeFor } from '../content/locales.js';
import { resolveModel, type ContentModel } from '../content/model.js';
import { projectRows, systemAttributes, type ReadEnvironment } from '../content/read.js';
import { AppError } from '../helpers/appError.js';
import type { Policy } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as publicationsRepository from '../repositories/publications.js';
import type { UsageRecorder } from '../usage/aggregator.js';
import { usagePrincipalKey } from '../usage/keys.js';
import { restFieldReads } from '../usage/restFieldReads.js';
import type { ContentServiceContext } from './contentAccess.js';
import { parseQueryFor, queryConditions } from './contentReads.js';

/**
 * The delivery API (build plan §4.E6): published heads only, through the permission evaluator (delivery
 * tokens, app users, anonymous callers). Each response reads one consistent moment (a REPEATABLE READ
 * transaction) and reports the publication sequence it saw, which a site build can pin with `?snapshot=N`.
 */
export type DeliveryMeta = {
  /** The requested locale (or the default); each entry's own `locale` says which one served it. */
  locale: string;
  /** Publication sequence number this response reflects. */
  snapshot: number;
};

export type DeliveryList = {
  data: Array<Record<string, unknown>>;
  meta: DeliveryMeta & { pagination: Pagination };
};
export type DeliveryItem = { data: Record<string, unknown>; meta: DeliveryMeta };

/**
 * Read variants GraphQL exposes as arguments (REST always uses the defaults):
 * - `fallback: false` serves the requested locale only, never a fallback locale (ADR 0004).
 * - `drafts: true` reads draft heads in the delivery shape (GraphQL `publicationState: DRAFT`). Only admin
 *   principals may ask for it; the caller (plugins/graphql) checks that before passing it.
 */
export type DeliveryReadOptions = {
  fallback?: boolean;
  drafts?: boolean;
  /**
   * Field usage counters (REST only). GraphQL counts its own selections once per operation
   * (plugins/graphql.ts), so its root reads through this service pass none.
   */
  usage?: UsageRecorder;
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

export const deliveryEnvironment = (
  context: ContentServiceContext,
  executor: ReadEnvironment['executor'],
  source: HeadSource,
  locale: string | undefined,
): ReadEnvironment => ({
  executor,
  snapshot: context.snapshot,
  permissions: context.permissions,
  actor: context.actor,
  audience: 'delivery',
  source,
  locale,
  ...(context.media ? { media: context.media } : {}),
});

/** Runs a delivery read in one consistent transaction at the requested (or current) publication sequence. */
const atSnapshot = async <T>(
  context: ContentServiceContext,
  query: ContentQuery,
  options: DeliveryReadOptions,
  read: (env: ReadEnvironment, seq: number) => Promise<T>,
): Promise<T> =>
  contentQueriesRepository.withConsistentRead(async (trx) => {
    const current = await publicationsRepository.currentSeq(context.site.id, trx);
    if (query.snapshot !== undefined && options.drafts) {
      throw queryInvalid('snapshot reads published content; it cannot be combined with drafts');
    }
    if (query.snapshot !== undefined && query.snapshot > current) {
      throw snapshotInvalid(query.snapshot, current);
    }
    const source: HeadSource = options.drafts
      ? { kind: 'heads', state: 'draft' }
      : query.snapshot !== undefined
        ? { kind: 'snapshot', seq: query.snapshot }
        : { kind: 'heads', state: 'published' };
    return read(deliveryEnvironment(context, trx, source, query.locale), query.snapshot ?? current);
  }, context.db);

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
  if (!options.usage || options.drafts || principalKey === null) {
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

const toEntries = (env: ReadEnvironment, projected: Awaited<ReturnType<typeof projectRows>>) =>
  projected.map(({ row, data }) => ({ ...systemAttributes(env, row), ...data }));

const ITEM_PARAMETERS = new Set(['fields', 'populate', 'locale', 'snapshot']);

/** Reading one entry takes only these query parameters; anything else is refused, not ignored. */
export const assertItemParameters = (rawQuery: string, allowed: ReadonlySet<string>): void => {
  const unsupported = [...new URLSearchParams(rawQuery).keys()].find(
    (key) => !allowed.has(key.split('[')[0] ?? key),
  );
  if (unsupported !== undefined) {
    throw queryInvalid(`"${unsupported}" is not supported when reading one entry`);
  }
};

/**
 * A delivery-shaped read of one model, once the caller is authorised and the query parsed. The source
 * (published heads, a snapshot, or drafts for preview) comes from the read environment; `conditions` adds
 * row restrictions on top of the query's own (a preview token's entry scope).
 */
export type DeliveryRead = {
  context: ContentServiceContext;
  env: ReadEnvironment;
  model: ContentModel;
  policy: Policy;
  query: ContentQuery;
  fallback: boolean;
  conditions?: readonly RawBuilder<unknown>[];
};

const localesOf = (read: DeliveryRead) =>
  readScopeFor(read.context.snapshot, read.model.definition, read.query.locale, { fallback: read.fallback });

/** One page of entries in the delivery shape, with the total and the page size used. */
export const readEntryPage = async (read: DeliveryRead) => {
  const { context, env, model, policy, query } = read;
  const { limit, offset } = toLimitOffset(query.page, query.pageSize);
  const compiled = compileHeadQuery({
    modelId: model.definition.id,
    source: env.source,
    locales: localesOf(read),
    conditions: [...queryConditions(context, query, policy), ...(read.conditions ?? [])],
    orderBy: compileOrderBy(
      query.sort.length > 0
        ? query.sort
        : defaultSortTerms(model.definition, (field) => maskAllows(policy.readMask, field)),
    ),
    limit,
    offset,
  });
  const rows = await contentQueriesRepository.runHeadQuery(compiled.rows, env.executor);
  const entries = toEntries(env, await projectRows(env, model, policy, rows, query));
  return {
    entries,
    limit,
    count: () => contentQueriesRepository.runCountQuery(compiled.count, env.executor),
  };
};

/** One entry by ID in the delivery shape, or undefined when it is not there for this read. */
export const readOneEntry = async (read: DeliveryRead, id: string) => {
  const { context, env, model, policy, query } = read;
  const byId = compileHeadQuery({
    modelId: model.definition.id,
    source: env.source,
    locales: localesOf(read),
    conditions: [
      ...queryConditions(context, { ...query, filter: null, search: null }, policy),
      ...(read.conditions ?? []),
      sql`h.entry_id = ${id}::uuid`,
    ],
    orderBy: [],
    limit: 1,
  });
  const rows = await contentQueriesRepository.runHeadQuery(byId.rows, env.executor);
  const [entry] = toEntries(env, await projectRows(env, model, policy, rows, query));
  return entry;
};

/** `GET /api/content/:modelKey`: a page of a collection, or a singleton's one entry. */
export const listDelivery = async (
  context: ContentServiceContext,
  modelKey: string,
  rawQuery: string,
  options: DeliveryReadOptions = {},
): Promise<DeliveryList | DeliveryItem> => {
  const { model, policy } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, { allowSnapshot: true });
  const locale = query.locale ?? context.snapshot.defaultLocale;
  const result = await atSnapshot(context, query, options, async (env, seq) => {
    const { entries, limit, count } = await readEntryPage({
      context,
      env,
      model,
      policy,
      query,
      fallback: options.fallback ?? true,
    });
    if (model.definition.kind === 'singleton') {
      const [entry] = entries;
      if (!entry) {
        throw entryNotFound(modelKey);
      }
      return { data: entry, meta: { locale, snapshot: seq } };
    }
    return {
      data: entries,
      meta: { locale, snapshot: seq, pagination: paginationMeta(query.page, limit, await count()) },
    };
  });
  await recordUsage(context, options, model, policy, query);
  return result;
};

/** `GET /api/content/:modelKey/:id`: one published entry (404 for drafts, unknown or unreadable entries). */
export const getDelivery = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  rawQuery: string,
  options: DeliveryReadOptions = {},
): Promise<DeliveryItem> => {
  assertItemParameters(rawQuery, ITEM_PARAMETERS);
  const { model, policy } = await readableModel(context, modelKey);
  const query = parseQueryFor(context, model, policy, rawQuery, { allowSnapshot: true });
  const result = await atSnapshot(context, query, options, async (env, seq) => {
    const entry = await readOneEntry(
      { context, env, model, policy, query, fallback: options.fallback ?? true },
      id,
    );
    if (!entry) {
      throw entryNotFound(id);
    }
    return { data: entry, meta: { locale: query.locale ?? context.snapshot.defaultLocale, snapshot: seq } };
  });
  await recordUsage(context, options, model, policy, query);
  return result;
};
