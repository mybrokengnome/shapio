import type { FieldDefinition } from '@shapio/schema';
import {
  compileAuthorCondition,
  compileFilter,
  filterReadsEntries,
  compileHeadQuery,
  compileSearch,
  compileStatusCondition,
  type HeadQueryPlan,
  type HeadRow,
} from '../content/compiler/compile.js';
import { matchesNothing } from '../content/compiler/conditions.js';
import { paginationMeta, toLimitOffset, type Pagination } from '../content/compiler/paginate.js';
import { parseContentQuery } from '../content/compiler/parse.js';
import { compileRowFilter, everyRowReadMask, maskAllows } from '../content/compiler/policy.js';
import { parseQueryTree } from '../content/compiler/querystring.js';
import { compileOrderBy, defaultSortTerms } from '../content/compiler/sort.js';
import type { ContentQuery } from '../content/compiler/types.js';
import { entryLocaleNotFound, revisionNotFound } from '../content/errors.js';
import { familyIdsOf, readableMembers, type ReadMember } from '../content/family.js';
import { outdatedSharedLocales, readScopeFor } from '../content/locales.js';
import { resolveModelById, type ContentModel } from '../content/model.js';
import { planMembers, projectMemberRows, projectRows, type ReadEnvironment } from '../content/read.js';
import { visibleReferenceFilter } from '../content/visibleReferences.js';
import type { Policy } from '../permissions/types.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as contentRevisionsRepository from '../repositories/contentRevisions.js';
import * as entriesRepository from '../repositories/entries.js';
import type { EntryRow } from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { HeadRecord } from '../repositories/entryHeads.js';
import * as publicationsRepository from '../repositories/publications.js';
import type { EntryPublicationRow } from '../repositories/publications.js';
import {
  assertEntryVisible,
  entryModelWithPolicy,
  modelWithPolicy,
  type ContentServiceContext,
} from './contentAccess.js';
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
  siteId: context.site.id,
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
  model_id: entry.model_id,
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
    await entriesRepository.findLive(entryId, model.definition.id, context.site.id, context.db),
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
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'read');
  const entry = assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db),
    id,
  );
  return buildAdminEntryView(context, model, policy, entry, locale);
};

/** Whether the filter, search and admin filters of a query name an `entries` column. */
const queryFilterReadsEntries = (query: ContentQuery): boolean =>
  (query.filter !== null && filterReadsEntries(query.filter)) || query.author !== undefined;

/** Whether `queryConditions` names an `entries` column (`HeadQueryPlan.conditionsReadEntries`). */
export const queryReadsEntries = (query: ContentQuery, policy: Policy): boolean =>
  queryFilterReadsEntries(query) || policy.rowFilter !== null;

/** Filters, search and admin filters of a parsed query as SQL conditions. */
const queryFilterConditions = (query: ContentQuery) => [
  ...(query.filter ? [compileFilter(query.filter)] : []),
  ...(query.search ? [compileSearch(query.search.field.id, query.search.text)] : []),
  ...(query.status ? [compileStatusCondition(query.status)] : []),
  ...(query.author ? [compileAuthorCondition(query.author)] : []),
];

/** Filters, search and row filter of a parsed query as SQL conditions. */
export const queryConditions = (context: ContentServiceContext, query: ContentQuery, policy: Policy) => {
  const rowFilter = compileRowFilter(policy.rowFilter, context.actor);
  return [...queryFilterConditions(query), ...(rowFilter ? [rowFilter] : [])];
};

/**
 * The plan of a read over a family's readable members (plan polymorphic-types): the members, and the query's
 * conditions shared by every arm. A lone member's row filter is a shared condition, so a model without kinds
 * compiles as it always has.
 */
export const familyQueryPlan = (
  context: ContentServiceContext,
  query: ContentQuery,
  members: readonly ReadMember[],
): Pick<HeadQueryPlan, 'members' | 'conditions' | 'conditionsReadEntries'> => {
  const [route] = members;
  const kinds = query.kinds ? new Set(query.kinds) : null;
  const narrowed = kinds ? members.filter((member) => kinds.has(member.model.definition.id)) : members;
  if (narrowed.length === 0 && route) {
    // `filters[__model]` named only kinds the caller may not read: nothing, as for any hidden kind.
    return {
      members: [{ modelId: route.model.definition.id }],
      conditions: [matchesNothing()],
      conditionsReadEntries: false,
    };
  }
  const plan = planMembers(narrowed, context.actor);
  return {
    members: plan.members,
    conditions: [...queryFilterConditions(query), ...plan.conditions],
    conditionsReadEntries: queryFilterReadsEntries(query) || plan.conditions.length > 0,
  };
};

/** The route model's family by API ID, for `filters[__model]`. */
const kindsOf = (context: ContentServiceContext, model: ContentModel): Map<string, string> =>
  new Map(
    familyIdsOf(context.snapshot, model.definition.id).flatMap((id) => {
      const apiKey = context.snapshot.byId.get(id)?.definition.apiKey;
      return apiKey ? [[apiKey, id] as const] : [];
    }),
  );

/**
 * The readable members of the route model's family (the route model first, under the policy already
 * evaluated for it). A kind the caller may not read is left out of the read, never a 403.
 */
export const familyMembersFor = (
  context: ContentServiceContext,
  model: ContentModel,
  policy: Policy,
): Promise<ReadMember[]> =>
  readableMembers(context.snapshot, model, (modelId) =>
    modelId === model.definition.id
      ? Promise.resolve(policy)
      : context.permissions.evaluate(context.actor, { action: 'read', modelId }),
  );

/**
 * A field the query may filter, sort or search on (and, in a family read, select): readable on every row of
 * every kind read, so a query never reveals a value one kind's grant hides (plan polymorphic-types, decision
 * 11).
 */
const readableOnEveryRow =
  (members: readonly ReadMember[]) =>
  (field: FieldDefinition): boolean =>
    members.every((member) => maskAllows(everyRowReadMask(member.policy), field));

export const parseQueryFor = (
  context: ContentServiceContext,
  model: ContentModel,
  policy: Policy,
  rawQuery: string,
  options: {
    allowSnapshot: boolean;
    allowAdminFilters?: boolean;
    allowRichText?: boolean;
    allowSeo?: boolean;
    allowPublicationState?: boolean;
    /** A family read: every kind it reads (the route model included). */
    members?: readonly ReadMember[];
  },
): ContentQuery => {
  const members = options.members ?? [{ model, policy }];
  const family = members.length > 1;
  return parseContentQuery(parseQueryTree(rawQuery), {
    model: model.definition,
    locales: context.snapshot.locales.map((locale) => locale.code),
    isReadable: (field) => maskAllows(policy.readMask, field),
    ...(family ? { isSelectable: readableOnEveryRow(members) } : {}),
    isQueryable: readableOnEveryRow(members),
    allowSnapshot: options.allowSnapshot,
    allowAdminFilters: options.allowAdminFilters ?? false,
    allowRichText: options.allowRichText ?? false,
    allowSeo: options.allowSeo ?? false,
    allowPublicationState: options.allowPublicationState ?? false,
    resolveModel: (modelId) => resolveModelById(context.snapshot, modelId)?.definition,
    kinds: kindsOf(context, model),
  });
};

/** The sort of a read: the query's, else the route model's default when every kind read shows that field. */
export const sortOf = (query: ContentQuery, model: ContentModel, members: readonly ReadMember[]) =>
  query.sort.length > 0 ? query.sort : defaultSortTerms(model.definition, readableOnEveryRow(members));

export type AdminListItem = {
  id: string;
  /** The API ID of the entry's own model: a family's list mixes kinds (plan polymorphic-types). */
  model: string;
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

/**
 * The admin content list: drafts, filtered/sorted/paginated by the same compiler as delivery. A model with
 * kinds lists its whole family (each row in its own shape, `model` naming its kind), as delivery does.
 */
export const listAdminEntries = async (
  context: ContentServiceContext,
  modelKey: string,
  rawQuery: string,
): Promise<{ items: AdminListItem[]; pagination: Pagination; locale: string }> => {
  const { model, policy } = await modelWithPolicy(context, modelKey, 'read');
  const members = await familyMembersFor(context, model, policy);
  const parsed = parseQueryFor(context, model, policy, rawQuery, {
    allowSnapshot: false,
    allowAdminFilters: true,
    members,
  });
  const environment = adminEnvironment(context, parsed.locale);
  const query = {
    ...parsed,
    filter: await visibleReferenceFilter(environment, parsed.filter),
  };
  const { limit, offset } = toLimitOffset(query.page, query.pageSize);
  const compiled = compileHeadQuery({
    siteId: context.site.id,
    ...familyQueryPlan(context, query, members),
    source: { kind: 'heads', state: 'draft' },
    locales: readScopeFor(context.snapshot, model.definition, query.locale, { fallback: true }),
    orderBy: compileOrderBy(sortOf(query, model, members)),
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
    const env = { ...environment, executor: trx };
    const projected = await projectMemberRows(env, members, rows, query);
    const details = await listDetailsFor(trx, model, rows, statusOf);
    return {
      items: projected.map(({ row, data }) => ({
        id: row.entry_id,
        model: context.snapshot.byId.get(row.model_id)?.definition.apiKey ?? model.definition.apiKey,
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
  const { model, policy } = await entryModelWithPolicy(context, modelKey, id, 'read');
  const entry = assertEntryVisible(
    policy,
    context.actor,
    await entriesRepository.findLive(id, model.definition.id, context.site.id, context.db),
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
  const [revisions, publications] = await Promise.all([
    contentRevisionsRepository.listForEntry(entry.id, locale ?? null, HISTORY_LIMIT, context.db),
    publicationsRepository.listForEntry(entry.id, locale ?? null, HISTORY_LIMIT, context.db),
  ]);
  const names = await actorNames(context, [
    ...revisions.map((row) => ({ type: row.author_type, id: row.author_id })),
    ...publications.flatMap((row) => [
      { type: row.actor_type, id: row.actor_id },
      { type: row.closed_actor_type, id: row.closed_actor_id },
    ]),
  ]);
  const nameOf = (actorId: string | null) => (actorId === null ? null : (names.get(actorId) ?? null));
  return {
    revisions: revisions.map((row) => ({ ...row, author_name: nameOf(row.author_id) })),
    publications: publications.map((row) => publicationView(row, publications, nameOf)),
  };
};

const HISTORY_LIMIT = 200;

type ActorRef = { type: string | null; id: string | null };

/** Display names of the admins, tokens and app users among `actors`, by ID (system actors have none). */
const actorNames = (context: ContentServiceContext, actors: readonly ActorRef[]) => {
  const idsOf = (type: string) => [
    ...new Set(actors.flatMap((actor) => (actor.type === type && actor.id ? [actor.id] : []))),
  ];
  return changeSetsRepository.findActorNames(
    { adminIds: idsOf('admin'), tokenIds: idsOf('token'), appUserIds: idsOf('app_user') },
    context.db,
  );
};

export type EntryPublicationView = {
  revisionId: string;
  locale: string;
  publishedAt: Date;
  publishedBy: string | null;
  /** Why it went live, when not by a plain Publish: on schedule, or with a change set (named). */
  via: 'schedule' | 'changeSet' | null;
  changeSetTitle: string | null;
  live: boolean;
  /** Set only when the period ended without another publication of the locale taking over. */
  unpublishedAt: Date | null;
  unpublishedBy: string | null;
};

const publicationView = (
  row: EntryPublicationRow,
  all: readonly EntryPublicationRow[],
  nameOf: (actorId: string | null) => string | null,
): EntryPublicationView => {
  // A re-publish closes the previous period at the same sequence number it opens the next one.
  const replaced =
    row.to_seq !== null && all.some((other) => other.locale === row.locale && other.from_seq === row.to_seq);
  const ended = row.to_seq !== null && !replaced;
  return {
    revisionId: row.revision_id,
    locale: row.locale,
    publishedAt: row.published_at,
    publishedBy: nameOf(row.actor_id),
    via: row.change_set_title !== null ? 'changeSet' : row.source === 'schedule' ? 'schedule' : null,
    changeSetTitle: row.change_set_title,
    live: row.to_seq === null,
    unpublishedAt: ended ? (row.closed_at ?? null) : null,
    unpublishedBy: ended ? nameOf(row.closed_actor_id) : null,
  };
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
