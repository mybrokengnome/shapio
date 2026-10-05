import { isSeoField, type SeoDefaults } from '@shapio/schema';
import type { RawBuilder } from 'kysely';
import {
  compileHeadPage,
  type HeadQueryPlan,
  type HeadRow,
  type HeadSource,
} from '../content/compiler/compile.js';
import { entryIdIs } from '../content/compiler/conditions.js';
import { toLimitOffset } from '../content/compiler/paginate.js';
import { maskAllows } from '../content/compiler/policy.js';
import { selectFields } from '../content/compiler/select.js';
import { compileOrderBy, defaultSortTerms } from '../content/compiler/sort.js';
import type { ContentQuery, RichTextMode } from '../content/compiler/types.js';
import { readScopeFor } from '../content/locales.js';
import type { ContentModel } from '../content/model.js';
import {
  needsFollowUpReads,
  needsMediaReads,
  projectRows,
  systemAttributes,
  type ReadEnvironment,
} from '../content/read.js';
import type { Policy } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import type { ContentServiceContext } from './contentAccess.js';
import { queryConditions, queryReadsEntries } from './contentReads.js';
import { loadSeoDefaults } from './siteSeo.js';

/**
 * Delivery-shaped reads (delivery, preview, GraphQL root fields) at one consistent moment (plan
 * delivery-perf). The heads, the page total and the site's publication sequence come from one statement, so
 * a read that needs nothing else (no relation, populate or asset follow-up) runs without a transaction.
 * Anything that needs a follow-up statement runs in one REPEATABLE READ, read-only transaction, so every
 * statement of the response sees the moment `meta.snapshot` names, except a live published read whose only
 * follow-up is relation visibility: that runs on the pool (`readConsistently` explains why it is safe).
 */

export const deliveryEnvironment = (
  context: ContentServiceContext,
  executor: ReadEnvironment['executor'],
  source: HeadSource,
  locale: string | undefined,
  richText?: RichTextMode,
  seo?: SeoDefaults,
): ReadEnvironment => ({
  executor,
  snapshot: context.snapshot,
  permissions: context.permissions,
  actor: context.actor,
  siteId: context.site.id,
  audience: 'delivery',
  source,
  locale,
  ...(context.media ? { media: context.media } : {}),
  ...(richText ? { richText } : {}),
  ...(seo ? { seo } : {}),
});

/**
 * A delivery-shaped read of one model, once the caller is authorised and the query parsed. `source` is
 * published heads, a snapshot, or drafts (previews); `conditions` adds row restrictions on top of the query's
 * own (a preview token's entry scope).
 */
export type DeliveryRead = {
  context: ContentServiceContext;
  source: HeadSource;
  model: ContentModel;
  policy: Policy;
  query: ContentQuery;
  fallback: boolean;
  conditions?: readonly RawBuilder<unknown>[];
  /** `?seo=resolved`: the site's SEO defaults (loaded by `withSeoDefaults`). */
  seo?: SeoDefaults;
};

/** What a read saw: its environment (for projection), the rows, the page total and the publication sequence. */
type ConsistentHeads = {
  env: ReadEnvironment;
  rows: HeadRow[];
  /** Null unless the read asked for it. */
  total: number | null;
  seq: number;
};

const environmentOf = (read: DeliveryRead, executor: ReadEnvironment['executor']) =>
  deliveryEnvironment(read.context, executor, read.source, read.query.locale, read.query.richText, read.seo);

/**
 * Selected top-level relation or media fields, populate, or a default SEO image to show: the read will need a
 * follow-up statement.
 */
const followsUp = (read: DeliveryRead): boolean =>
  read.query.populate.size > 0 ||
  selectFields(read.model, read.policy.readMask, read.query.fields).some(
    (field) =>
      field.type === 'relation' ||
      field.type === 'media' ||
      (Boolean(read.seo?.imageId) && isSeoField(field)),
  );

/**
 * A live read of published heads (no `?snapshot`, not a preview or draft read, no extra conditions) without
 * populate: its only possible follow-up is relation visibility (asset views are checked on the rows).
 */
const isLiveVisibilityRead = (read: DeliveryRead): boolean =>
  read.source.kind === 'heads' &&
  read.source.state === 'published' &&
  read.query.populate.size === 0 &&
  (read.conditions?.length ?? 0) === 0;

/**
 * Loads the site's SEO defaults when the query asks for resolved SEO. Read before the heads, outside their
 * consistent moment: defaults are not part of a snapshot (`?snapshot=N&seo=resolved` uses today's).
 */
const withSeoDefaults = async (read: DeliveryRead): Promise<DeliveryRead> =>
  read.query.seo === 'resolved'
    ? { ...read, seo: await loadSeoDefaults(read.context.site.id, read.context.db) }
    : read;

const seqOf = (seq: number | null): number => {
  if (seq === null) {
    throw new Error('The site has no publication state');
  }
  return seq;
};

/**
 * Runs the plan's statement on the pool when the read cannot need a follow-up, and keeps that result when
 * the rows indeed need none; otherwise reads again inside one REPEATABLE READ transaction. `finish` projects
 * the rows (through the same executor), so its own statements see the same moment. A live published read
 * whose only follow-up is relation visibility also stays on the pool (see below).
 */
const readConsistently = async <T>(
  read: DeliveryRead,
  plan: HeadQueryPlan,
  options: { total: boolean },
  finish: (heads: ConsistentHeads) => Promise<T>,
): Promise<T> => {
  const compiled = compileHeadPage(plan, options);
  const { db } = read.context;
  const live = isLiveVisibilityRead(read);
  if (!followsUp(read) || live) {
    const env = environmentOf(read, db);
    const { rows, meta } = await contentQueriesRepository.runHeadPage(compiled.rows, db);
    const fields = selectFields(read.model, read.policy.readMask, read.query.fields);
    // An empty page carries no meta row; the transaction below reads it consistently.
    if (meta && !needsFollowUpReads(env, read.model, rows, read.query, read.policy)) {
      return finish({ env, rows, total: meta.total, seq: seqOf(meta.seq) });
    }
    // Relation visibility on the pool, without BEGIN … REPEATABLE READ … COMMIT (plan delivery-perf-2, step
    // 4). The heads and `meta.snapshot` come from the one statement above; the visibility fetch is a second
    // statement that may see a later moment. That can only move a target to its newer live state: the fetch
    // itself reads published heads only (and the target's read policy), so a target unpublished or deleted in
    // between is hidden, and one published in between is shown although the snapshot named predates it. It
    // never shows an unpublished target (rule 7). Pinned (`?snapshot=N`), preview and draft reads, populate and
    // asset views keep the transaction, so their responses are exactly the moment they name.
    if (meta && live && !needsMediaReads(env, read.model, rows, fields)) {
      return finish({ env, rows, total: meta.total, seq: seqOf(meta.seq) });
    }
  }
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const env = environmentOf(read, trx);
    const page = await contentQueriesRepository.runHeadPage(compiled.rows, trx);
    const meta = page.meta ?? (await contentQueriesRepository.runHeadPageMeta(compiled.meta, trx));
    return finish({ env, rows: page.rows, total: meta.total, seq: seqOf(meta.seq) });
  }, db);
};

const localesOf = (read: DeliveryRead) =>
  readScopeFor(read.context.snapshot, read.model.definition, read.query.locale, { fallback: read.fallback });

const toEntries = async (read: DeliveryRead, env: ReadEnvironment, rows: readonly HeadRow[]) =>
  (await projectRows(env, read.model, read.policy, rows, read.query)).map(({ row, data }) => ({
    ...systemAttributes(env, row),
    ...data,
  }));

export type EntryPage = {
  entries: Array<Record<string, unknown>>;
  limit: number;
  /** The matching total (0 when not asked for). */
  total: number;
  /** The site's publication sequence when the page was read. */
  seq: number;
};

/**
 * One page of entries in the delivery shape, with the total (`total: false` skips counting: a singleton) and
 * the publication sequence it was read at. `check` runs on the sequence before anything is projected.
 */
export const readEntryPage = async (
  unloaded: DeliveryRead,
  options: { total: boolean; check?: (seq: number) => void } = { total: true },
): Promise<EntryPage> => {
  const read = await withSeoDefaults(unloaded);
  const { context, model, policy, query } = read;
  const { limit, offset } = toLimitOffset(query.page, query.pageSize);
  const sort =
    query.sort.length > 0
      ? query.sort
      : defaultSortTerms(model.definition, (field) => maskAllows(policy.readMask, field));
  const plan: HeadQueryPlan = {
    siteId: context.site.id,
    modelId: model.definition.id,
    source: read.source,
    locales: localesOf(read),
    conditions: [...queryConditions(context, query, policy), ...(read.conditions ?? [])],
    // A caller's extra conditions (a preview token's entry scope) are not inspected: they keep the join.
    conditionsReadEntries: queryReadsEntries(query, policy) || (read.conditions?.length ?? 0) > 0,
    orderBy: compileOrderBy(sort),
    limit,
    offset,
  };
  return readConsistently(read, plan, { total: options.total }, async ({ env, rows, total, seq }) => {
    options.check?.(seq);
    return { entries: await toEntries(read, env, rows), limit, total: total ?? 0, seq };
  });
};

/** One entry by ID in the delivery shape (undefined when it is not there for this read), and the sequence. */
export const readOneEntry = async (
  unloaded: DeliveryRead,
  id: string,
  options: { check?: (seq: number) => void } = {},
): Promise<{ entry: Record<string, unknown> | undefined; seq: number }> => {
  const read = await withSeoDefaults(unloaded);
  const { context, model, policy, query } = read;
  const plan: HeadQueryPlan = {
    siteId: context.site.id,
    modelId: model.definition.id,
    source: read.source,
    locales: localesOf(read),
    conditions: [
      ...queryConditions(context, { ...query, filter: null, search: null }, policy),
      ...(read.conditions ?? []),
      entryIdIs(id),
    ],
    orderBy: [],
    limit: 1,
  };
  return readConsistently(read, plan, { total: false }, async ({ env, rows, seq }) => {
    options.check?.(seq);
    const [entry] = await toEntries(read, env, rows);
    return { entry, seq };
  });
};
