import {
  compileAuthorCondition,
  compileFilter,
  compileHeadQuery,
  compileSearch,
  compileStatusCondition,
  type HeadRow,
} from '../content/compiler/compile.js';
import { paginationMeta, toLimitOffset, type Pagination } from '../content/compiler/paginate.js';
import { parseContentQuery } from '../content/compiler/parse.js';
import { compileRowFilter, maskAllows } from '../content/compiler/policy.js';
import { parseQueryTree } from '../content/compiler/querystring.js';
import { compileOrderBy, defaultSortTerms } from '../content/compiler/sort.js';
import type { ContentQuery } from '../content/compiler/types.js';
import { entryLocaleNotFound, revisionNotFound } from '../content/errors.js';
import { outdatedSharedLocales, readScopeFor } from '../content/locales.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import { projectRows, type ReadEnvironment } from '../content/read.js';
import type { Policy } from '../permissions/types.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as entriesRepository from '../repositories/entries.js';
import type { EntryRow } from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import { assertEntryVisible, modelWithPolicy, type ContentServiceContext } from './contentAccess.js';
import { listDetailsFor, type ListAuthor, type ListLocaleStatus } from './contentListDetails.js';

/** Admin reads of content: drafts, per-locale status, revisions. */

export type EntryStatus = 'draft' | 'published' | 'modified';

export const statusOf = (
  draft: Pick<HeadRecord, 'revision_id' | 'autosaved_at'>,
  published?: Pick<HeadRecord, 'revision_id'>,
): EntryStatus => {
  if (!published) {
    return 'draft';
  }
  return published.revision_id === draft.revision_id && !draft.autosaved_at ? 'published' : 'modified';
};

const adminEnvironment = (context: ContentServiceContext, locale: string | undefined): ReadEnvironment => ({
  executor: context.db,
  snapshot: context.snapshot,
  permissions: context.permissions,
  actor: context.actor,
  audience: 'admin',
  source: { kind: 'heads', state: 'draft' },
  locale,
  ...(context.media ? { media: context.media } : {}),
});

const toHeadRow = (
  entry: EntryRow,
  head: Pick<HeadRecord, 'locale' | 'data' | 'version' | 'revision_id' | 'updated_at' | 'autosaved_at'>,
): HeadRow => ({
  entry_id: entry.id,
  locale: head.locale,
  data: head.data,
  version: head.version,
  revision_id: head.revision_id,
  updated_at: head.updated_at,
  autosaved_at: head.autosaved_at,
  created_at: entry.created_at,
  entry_updated_at: entry.updated_at,
  created_by_admin_id: entry.created_by_admin_id,
  owner_app_user_id: entry.owner_app_user_id,
});

export type LocaleState = {
  locale: string;
  version: number;
  status: EntryStatus;
  publishedAt: string | null;
  /** The published version's shared fields are older than the draft's (ADR 0004 prompt). */
  sharedOutdated: boolean;
};

const localeStates = (model: ContentModel, heads: readonly HeadRecord[]): LocaleState[] => {
  const drafts = heads.filter((head) => head.state === 'draft');
  const publishedOf = (locale: string) =>
    heads.find((head) => head.state === 'published' && head.locale === locale);
  const outdated = new Set(
    outdatedSharedLocales(
      model.definition,
      drafts.map((draft) => {
        const published = publishedOf(draft.locale);
        return {
          locale: draft.locale,
          draft: draft.data,
          ...(published ? { published: published.data } : {}),
        };
      }),
    ),
  );
  return drafts.map((draft) => {
    const published = publishedOf(draft.locale);
    return {
      locale: draft.locale,
      version: draft.version,
      status: statusOf(draft, published),
      publishedAt: published?.updated_at.toISOString() ?? null,
      sharedOutdated: outdated.has(draft.locale),
    };
  });
};

export type AdminEntryView = {
  id: string;
  model: string;
  locale: string;
  version: number;
  revisionId: string;
  status: EntryStatus;
  /** Saved without full validation (autosave or duplicate): Save or Publish validates it. */
  autosaved: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  data: Record<string, unknown>;
  locales: LocaleState[];
  /** Other published locales whose live shared values are older than their drafts. */
  sharedOutdatedLocales: string[];
};

/** One entry's draft in one locale, with every locale's status. */
export const buildAdminEntryView = async (
  context: ContentServiceContext,
  model: ContentModel,
  policy: Policy,
  entry: EntryRow,
  requestedLocale: string | undefined,
): Promise<AdminEntryView> => {
  const heads = await entryHeadsRepository.findForEntry(entry.id, context.db);
  const drafts = heads.filter((head) => head.state === 'draft');
  const locale = model.definition.localized
    ? (requestedLocale ?? context.snapshot.defaultLocale)
    : drafts[0]?.locale;
  const draft = drafts.find((head) => head.locale === locale);
  if (!draft || locale === undefined) {
    throw entryLocaleNotFound(
      entry.id,
      locale ?? context.snapshot.defaultLocale,
      drafts.map((head) => head.locale),
    );
  }
  const published = heads.find((head) => head.state === 'published' && head.locale === locale);
  const [projected] = await projectRows(
    adminEnvironment(context, locale),
    model,
    policy,
    [toHeadRow(entry, draft)],
    {
      fields: null,
      populate: new Map(),
    },
  );
  const states = localeStates(model, heads);
  return {
    id: entry.id,
    model: model.definition.apiKey,
    locale,
    version: draft.version,
    revisionId: draft.revision_id,
    status: statusOf(draft, published),
    autosaved: draft.autosaved_at !== null,
    createdAt: entry.created_at.toISOString(),
    updatedAt: draft.updated_at.toISOString(),
    publishedAt: published?.updated_at.toISOString() ?? null,
    data: projected?.data ?? {},
    locales: states,
    sharedOutdatedLocales: states
      .filter((state) => state.sharedOutdated && state.locale !== locale)
      .map((state) => state.locale),
  };
};

/**
 * The entry view returned after a write. The caller may lack `read` (a write-only role): it then sees the
 * fields its read grants allow (possibly none), never more.
 */
export const viewAfterWrite = async (
  context: ContentServiceContext,
  model: ContentModel,
  writePolicy: Policy,
  entryId: string,
  locale: string | undefined,
): Promise<AdminEntryView> => {
  const readPolicy = await context.permissions.evaluate(context.actor, {
    action: 'read',
    modelId: model.definition.id,
  });
  const entry = assertEntryVisible(
    writePolicy,
    context.actor,
    await entriesRepository.findLive(entryId, model.definition.id, context.db),
    entryId,
  );
  return buildAdminEntryView(context, model, readPolicy.allowed ? readPolicy : writePolicy, entry, locale);
};

export const getAdminEntry = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  locale: string | undefined,
): Promise<AdminEntryView> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  const entry = assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.db),
    id,
  );
  return buildAdminEntryView(context, model, policy, entry, locale);
};

/** Filters, search and row filter of a parsed query as SQL conditions. */
export const queryConditions = (context: ContentServiceContext, query: ContentQuery, policy: Policy) => {
  const rowFilter = compileRowFilter(policy.rowFilter, context.actor);
  return [
    ...(query.filter ? [compileFilter(query.filter)] : []),
    ...(query.search ? [compileSearch(query.search.field.id, query.search.text)] : []),
    ...(query.status ? [compileStatusCondition(query.status)] : []),
    ...(query.author ? [compileAuthorCondition(query.author)] : []),
    ...(rowFilter ? [rowFilter] : []),
  ];
};

export const parseQueryFor = (
  context: ContentServiceContext,
  model: ContentModel,
  policy: Policy,
  rawQuery: string,
  options: { allowSnapshot: boolean; allowAdminFilters?: boolean },
): ContentQuery =>
  parseContentQuery(parseQueryTree(rawQuery), {
    model: model.definition,
    locales: context.snapshot.locales.map((locale) => locale.code),
    isReadable: (field) => maskAllows(policy.readMask, field),
    allowSnapshot: options.allowSnapshot,
    allowAdminFilters: options.allowAdminFilters ?? false,
    resolveModel: (modelId) => resolveModelById(context.snapshot, modelId)?.definition,
  });

export type AdminListItem = {
  id: string;
  locale: string;
  version: number;
  status: EntryStatus;
  autosaved: boolean;
  createdAt: string;
  updatedAt: string;
  data: Record<string, unknown>;
  author: ListAuthor | null;
  locales?: ListLocaleStatus[];
};

/** The admin content list: drafts, filtered/sorted/paginated by the same compiler as delivery. */
export const listAdminEntries = async (
  context: ContentServiceContext,
  modelKey: string,
  rawQuery: string,
): Promise<{ items: AdminListItem[]; pagination: Pagination; locale: string }> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  const query = parseQueryFor(context, model, policy, rawQuery, {
    allowSnapshot: false,
    allowAdminFilters: true,
  });
  const { limit, offset } = toLimitOffset(query.page, query.pageSize);
  const compiled = compileHeadQuery({
    modelId: model.definition.id,
    source: { kind: 'heads', state: 'draft' },
    locales: readScopeFor(context.snapshot, model.definition, query.locale, { fallback: true }),
    conditions: queryConditions(context, query, policy),
    orderBy: compileOrderBy(
      query.sort.length > 0
        ? query.sort
        : defaultSortTerms(model.definition, (field) => maskAllows(policy.readMask, field)),
    ),
    limit,
    offset,
  });
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const rows = await contentQueriesRepository.runHeadQuery(compiled.rows, trx);
    const total = await contentQueriesRepository.runCountQuery(compiled.count, trx);
    const published = await entryHeadsRepository.findPublishedRevisions(
      rows.map((row) => row.entry_id),
      trx,
    );
    const publishedBy = new Map(published.map((head) => [`${head.entry_id}|${head.locale}`, head]));
    const env = { ...adminEnvironment(context, query.locale), executor: trx };
    const projected = await projectRows(env, model, policy, rows, query);
    const details = await listDetailsFor(trx, model, rows, statusOf);
    return {
      items: projected.map(({ row, data }) => ({
        id: row.entry_id,
        locale: row.locale,
        version: row.version,
        status: statusOf(row, publishedBy.get(`${row.entry_id}|${row.locale}`)),
        autosaved: row.autosaved_at !== null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        data,
        author: details.authorOf(row),
        ...(model.definition.localized ? { locales: details.localesOf(row.entry_id) ?? [] } : {}),
      })),
      pagination: paginationMeta(query.page, limit, total),
      locale: query.locale ?? context.snapshot.defaultLocale,
    };
  }, context.db);
};

const visibleEntry = async (context: ContentServiceContext, modelKey: string, id: string) => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  const entry = assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.db),
    id,
  );
  return { model, policy, entry };
};

export const listRevisions = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  locale: string | undefined,
) => {
  const { entry } = await visibleEntry(context, modelKey, id);
  return contentRevisionsRepository.listForEntry(entry.id, locale ?? null, 200, context.db);
};

/** One revision with its data projected through the current schema and the caller's read mask. */
export const getRevision = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  revisionId: string,
) => {
  const { model, policy, entry } = await visibleEntry(context, modelKey, id);
  const revision = await contentRevisionsRepository.findById(revisionId, context.db);
  if (!revision || revision.entry_id !== entry.id) {
    throw revisionNotFound(revisionId);
  }
  const row = toHeadRow(entry, {
    locale: revision.locale,
    data: revision.data,
    version: 0,
    revision_id: revision.id,
    updated_at: revision.created_at,
    autosaved_at: null,
  });
  const [projected] = await projectRows(adminEnvironment(context, revision.locale), model, policy, [row], {
    fields: null,
    populate: new Map(),
  });
  return { revision, data: projected?.data ?? {} };
};
