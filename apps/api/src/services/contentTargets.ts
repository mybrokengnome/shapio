import {
  effectiveTitleField,
  isComponentDefinition,
  isInterfaceDefinition,
  isModelDefinition,
  isStableId,
  TEXT_TITLE_FIELD_TYPES,
  type FieldDefinition,
} from '@shapio/schema';
import {
  compileHeadQuery,
  compileSearch,
  type HeadQueryMember,
  type HeadRow,
} from '../content/compiler/compile.js';
import { toLimitOffset } from '../content/compiler/paginate.js';
import { compileRowFilter, everyRowReadMask, maskAllows, rowReadMask } from '../content/compiler/policy.js';
import { compileOrderBy } from '../content/compiler/sort.js';
import { QUERY_LIMITS, queryInvalid } from '../content/compiler/types.js';
import { readableMembers, type ReadMember } from '../content/family.js';
import { readScopeFor } from '../content/locales.js';
import { fetchTargetHeadsByIds, type ReadEnvironment } from '../content/read.js';
import { relationTargetOf, type RelationTarget } from '../content/relationTarget.js';
import { AppError } from '../helpers/appError.js';
import * as contentQueriesRepository from '../repositories/contentQueries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import type { ContentServiceContext } from './contentAccess.js';
import { statusOf, type EntryStatus } from './contentReads.js';

/**
 * `GET /api/admin/content-targets` (plan interfaces, decision 12): what a relation field may point at, for the
 * admin's relation picker. Keyed by the relation field (top level or inside a component; field IDs are
 * global): the server resolves its target (a model's family, an interface's members, or any entry) and the
 * models the caller may read, so the admin never enumerates models. Drafts, newest first, each titled by its
 * own model's title field, masked by that model's read mask. A search skips (never errors on) models whose
 * title the caller may not search. With `ids`, exactly those entries: labels and models of a stored value.
 */

export type ContentTargetsInput = {
  field: string;
  types?: readonly string[];
  q?: string;
  page?: number;
  pageSize?: number;
  locale?: string;
  ids?: readonly string[];
};

export type ContentTargetItem = {
  id: string;
  model: string;
  title: string | null;
  status: EntryStatus;
  locale: string;
  updatedAt: string;
};

export type ContentTargetsView = {
  target: { kind: RelationTarget['kind']; label: string | null };
  members: Array<{ apiKey: string; label: string }>;
  items: ContentTargetItem[];
  total: number;
};

/** Entry IDs are stable IDs (lower-case UUIDs); anything else is refused before it reaches SQL. */
const isEntryId = (id: string): boolean => isStableId(id);

/** Most entries one `ids` request may name. */
export const MAX_TARGET_IDS = 100;

const fieldNotFound = (fieldId: string) =>
  new AppError(404, 'FIELD_NOT_FOUND', `No relation field ${fieldId} in this site's schema`, {
    field: fieldId,
  });

/** The relation field with this ID, on a model or a component of the request's view. */
const relationFieldOf = (context: ContentServiceContext, fieldId: string): FieldDefinition<'relation'> => {
  for (const { definition } of context.snapshot.definitions) {
    if (!isModelDefinition(definition) && !isComponentDefinition(definition)) {
      continue;
    }
    const field = definition.fields.find((candidate) => candidate.id === fieldId);
    if (field) {
      if (field.type !== 'relation' || field.deprecated) {
        throw fieldNotFound(fieldId);
      }
      return field;
    }
  }
  throw fieldNotFound(fieldId);
};

/** The models a target accepts in the view: its family, its members, or every collection and singleton. */
const acceptedModelIds = (context: ContentServiceContext, target: RelationTarget): readonly string[] =>
  target.kind === 'any'
    ? context.snapshot.definitions.flatMap(({ definition }) =>
        isModelDefinition(definition) ? [definition.id] : [],
      )
    : target.modelIds;

const targetLabel = (context: ContentServiceContext, target: RelationTarget): string | null => {
  if (target.kind === 'any') {
    return null;
  }
  const definition = context.snapshot.byId.get(target.id)?.definition;
  return definition && (isModelDefinition(definition) || isInterfaceDefinition(definition))
    ? definition.label
    : null;
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
});

/** A member's title field when it is one the caller may read on every row (searchable when a text type). */
const titleFieldOf = (member: ReadMember): FieldDefinition | undefined => {
  const field = effectiveTitleField(member.model.definition);
  return field && maskAllows(everyRowReadMask(member.policy), field) ? field : undefined;
};

/** Each row as an item: its model, its title where its own row mask shows it, its draft status. */
const toItems = async (
  context: ContentServiceContext,
  members: readonly ReadMember[],
  rows: readonly HeadRow[],
  executor: ReadEnvironment['executor'] = context.db,
): Promise<ContentTargetItem[]> => {
  const published = await entryHeadsRepository.findPublishedRevisions(
    rows.map((row) => row.entry_id),
    executor,
  );
  const publishedBy = new Map(published.map((head) => [`${head.entry_id}|${head.locale}`, head]));
  return rows.flatMap((row) => {
    const member = members.find((candidate) => candidate.model.definition.id === row.model_id);
    if (!member) {
      return [];
    }
    const field = effectiveTitleField(member.model.definition);
    const shown = field && maskAllows(rowReadMask(member.policy, context.actor, row), field);
    const value = shown ? row.data[field.id] : undefined;
    return [
      {
        id: row.entry_id,
        model: member.model.definition.apiKey,
        title: typeof value === 'string' && value !== '' ? value : null,
        status: statusOf(row, publishedBy.get(`${row.entry_id}|${row.locale}`)),
        locale: row.locale,
        updatedAt: row.updated_at.toISOString(),
      },
    ];
  });
};

/** The members a page covers: the type filter's, and for a search those whose title the caller may search. */
type PageMember = { member: ReadMember; search?: { fieldId: string; text: string } };

const pageMembers = (members: readonly ReadMember[], input: ContentTargetsInput): PageMember[] => {
  const types = input.types && input.types.length > 0 ? new Set(input.types) : null;
  const known = new Set(members.map(({ model }) => model.definition.apiKey));
  for (const type of types ?? []) {
    if (!known.has(type)) {
      throw queryInvalid(`"${type}" is not a type this field may point at`, { types: type });
    }
  }
  const text = input.q?.trim();
  return members.flatMap((member): PageMember[] => {
    if (types && !types.has(member.model.definition.apiKey)) {
      return [];
    }
    if (!text) {
      return [{ member }];
    }
    const title = titleFieldOf(member);
    return title && TEXT_TITLE_FIELD_TYPES.has(title.type)
      ? [{ member, search: { fieldId: title.id, text } }]
      : [];
  });
};

const newestFirst = () =>
  compileOrderBy([{ target: { kind: 'system', name: 'updatedAt' }, direction: 'desc' }]);

/** One page of the readable members' drafts, newest first, searched on each one's own title. */
const listPage = async (
  context: ContentServiceContext,
  members: readonly ReadMember[],
  input: ContentTargetsInput,
): Promise<{ items: ContentTargetItem[]; total: number }> => {
  const chosen = pageMembers(members, input);
  if (chosen.length === 0) {
    return { items: [], total: 0 };
  }
  const page = input.page ?? 1;
  const pageSize = Math.min(input.pageSize ?? QUERY_LIMITS.defaultPageSize, QUERY_LIMITS.maxPageSize);
  const { limit, offset } = toLimitOffset(page, pageSize);
  const arms: HeadQueryMember[] = chosen.map(({ member: { model, policy }, search }) => {
    const rowFilter = compileRowFilter(policy.rowFilter, context.actor);
    return {
      modelId: model.definition.id,
      conditions: [
        ...(search ? [compileSearch(search.fieldId, search.text)] : []),
        ...(rowFilter ? [rowFilter] : []),
      ],
      conditionsReadEntries: rowFilter !== null,
      locales: readScopeFor(context.snapshot, model.definition, input.locale, { fallback: true }),
    };
  });
  const compiled = compileHeadQuery({
    siteId: context.site.id,
    members: arms,
    source: { kind: 'heads', state: 'draft' },
    locales: { kind: 'any' },
    conditions: [],
    conditionsReadEntries: false,
    orderBy: newestFirst(),
    limit,
    offset,
  });
  return contentQueriesRepository.withConsistentRead(async (trx) => {
    const rows = await contentQueriesRepository.runHeadQuery(compiled.rows, trx);
    const total = await contentQueriesRepository.runCountQuery(compiled.count, trx);
    return { items: await toItems(context, members, rows, trx), total };
  }, context.db);
};

/** Exactly the named entries among the readable members (one primary-key lookup of their models first). */
const listIds = async (
  context: ContentServiceContext,
  target: RelationTarget,
  members: readonly ReadMember[],
  input: ContentTargetsInput,
): Promise<{ items: ContentTargetItem[]; total: number }> => {
  const ids = [...new Set(input.ids ?? [])];
  if (ids.length > MAX_TARGET_IDS) {
    throw queryInvalid(`At most ${MAX_TARGET_IDS} IDs are allowed`);
  }
  const malformed = ids.find((id) => !isEntryId(id));
  if (malformed !== undefined) {
    throw queryInvalid(`"${malformed}" is not an entry ID`, { ids: malformed });
  }
  const heads = await fetchTargetHeadsByIds(adminEnvironment(context, input.locale), target, ids);
  const readable = new Set(members.map(({ model }) => model.definition.id));
  const items = await toItems(
    context,
    members,
    heads.rows.filter((row) => readable.has(row.model_id)),
  );
  // In the order the IDs were asked for.
  const position = new Map(ids.map((id, index) => [id, index]));
  items.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return { items, total: items.length };
};

export const listContentTargets = async (
  context: ContentServiceContext,
  input: ContentTargetsInput,
): Promise<ContentTargetsView> => {
  const target = relationTargetOf(context.snapshot, relationFieldOf(context, input.field));
  const members = await readableMembers(context.snapshot, acceptedModelIds(context, target), (modelId) =>
    context.permissions.evaluate(context.actor, { action: 'read', modelId }),
  );
  if (members.length === 0) {
    throw new AppError(403, 'FORBIDDEN', 'You may not read any entries this field may point at');
  }
  const { items, total } =
    input.ids !== undefined
      ? await listIds(context, target, members, input)
      : await listPage(context, members, input);
  return {
    target: { kind: target.kind, label: targetLabel(context, target) },
    members: members.map(({ model }) => ({ apiKey: model.definition.apiKey, label: model.definition.label })),
    items,
    total,
  };
};
