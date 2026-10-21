import { isSeoField, type FieldDefinition, type InterfaceDefinition } from '@shapio/schema';
import {
  compileFilter,
  compileSearch,
  filterReadsEntries,
  type HeadQueryMember,
} from '../content/compiler/compile.js';
import { matchesNothing } from '../content/compiler/conditions.js';
import { memberQuery } from '../content/compiler/memberQuery.js';
import { parseContentQuery } from '../content/compiler/parse.js';
import { compileRowFilter, everyRowReadMask, maskAllows } from '../content/compiler/policy.js';
import { parseQueryTree } from '../content/compiler/querystring.js';
import { compileOrderBy, defaultSortTerms } from '../content/compiler/sort.js';
import type { ContentQuery, PopulateTree } from '../content/compiler/types.js';
import type { ReadMember } from '../content/family.js';
import { readScopeFor } from '../content/locales.js';
import type { ReadEnvironment } from '../content/read.js';
import { visibleReferenceFilter } from '../content/visibleReferences.js';
import type { SchemaById } from '../schema/snapshot.js';
import type { ContentServiceContext } from './contentAccess.js';
import { queryDefinitionOf } from './contentReads.js';

/**
 * Reads through an interface (plan interfaces, D6 and decision 2). The query is parsed against the
 * contract, then rewritten onto each member's own fields (`memberQuery`): every member is one arm of the head
 * query with its own conditions, sort expressions and locale scope. A contract field may be filtered, sorted,
 * searched, selected or populated only when every readable member's field for it is readable on every row,
 * so a query never reveals a value one member's grant hides.
 */

/** A member of an interface read with the query rewritten onto its own fields. */
export type QueryMember = ReadMember & { query: ContentQuery };

/** An interface and the members the caller may read, each with its policy. */
export type InterfaceRoute = { definition: InterfaceDefinition; members: readonly ReadMember[] };

const fieldForOf =
  (snapshot: SchemaById, contract: InterfaceDefinition, member: ReadMember) =>
  (contractField: FieldDefinition): FieldDefinition | undefined =>
    snapshot.memberFieldOf(contract.id, contractField.id, member.model.definition.id);

/** Readable on every row of every member: what an interface query may name. */
const readableOnEveryMember =
  (snapshot: SchemaById, route: InterfaceRoute) =>
  (contractField: FieldDefinition): boolean =>
    route.members.every((member) => {
      const field = fieldForOf(snapshot, route.definition, member)(contractField);
      return field !== undefined && maskAllows(everyRowReadMask(member.policy), field);
    });

/** Whether any readable member has an SEO field the caller may read (`?seo=resolved`, plan interfaces Q-d). */
const anyMemberHasSeo = (route: InterfaceRoute): boolean =>
  route.members.some(({ model, policy }) =>
    model.definition.fields.some(
      (field) => !field.deprecated && isSeoField(field) && maskAllows(policy.readMask, field),
    ),
  );

/** Every member of the interface in the view by API ID (readable or not), for `filters[__model]`. */
const memberKinds = (snapshot: SchemaById, contract: InterfaceDefinition): Map<string, string> =>
  new Map(
    snapshot.implementedBy(contract.id).flatMap((id) => {
      const apiKey = snapshot.byId.get(id)?.definition.apiKey;
      return apiKey ? [[apiKey, id] as const] : [];
    }),
  );

export const parseInterfaceQuery = (
  context: ContentServiceContext,
  route: InterfaceRoute,
  rawQuery: string,
  options: {
    allowSnapshot: boolean;
    allowRichText?: boolean;
    allowSeo?: boolean;
    allowPublicationState?: boolean;
  },
): ContentQuery => {
  const { snapshot } = context;
  const everyMember = readableOnEveryMember(snapshot, route);
  return parseContentQuery(parseQueryTree(rawQuery), {
    model: route.definition,
    locales: snapshot.locales.map((locale) => locale.code),
    isReadable: everyMember,
    isSelectable: everyMember,
    isQueryable: everyMember,
    allowSnapshot: options.allowSnapshot,
    allowAdminFilters: false,
    allowRichText: options.allowRichText ?? false,
    allowSeo: options.allowSeo ?? false,
    allowPublicationState: options.allowPublicationState ?? false,
    resolveModel: (id) => queryDefinitionOf(snapshot, id),
    kinds: memberKinds(snapshot, route.definition),
    hasSeoField: anyMemberHasSeo(route),
  });
};

/** `populate=*` on an interface: each member's own readable relation fields, next to what was named. */
const withOwnRelations = (member: ReadMember, populate: PopulateTree): PopulateTree => {
  const all = new Map(populate);
  for (const field of member.model.definition.fields) {
    if (field.type === 'relation' && !field.deprecated && maskAllows(member.policy.readMask, field)) {
      all.set(field.id, all.get(field.id) ?? new Map());
    }
  }
  return all;
};

/**
 * The members a read covers (narrowed by `filters[__model]`), each with the query on its own fields. The
 * sort is the query's, else the contract's default sort when every member may be sorted on it, else newest
 * first.
 */
export const queryMembers = (
  snapshot: SchemaById,
  route: InterfaceRoute,
  query: ContentQuery,
): QueryMember[] => {
  const kinds = query.kinds ? new Set(query.kinds) : null;
  const sort =
    query.sort.length > 0
      ? query.sort
      : defaultSortTerms(route.definition, readableOnEveryMember(snapshot, route));
  return route.members
    .filter((member) => !kinds || kinds.has(member.model.definition.id))
    .map((member) => {
      const own = memberQuery(
        { ...query, sort },
        route.definition.fields,
        fieldForOf(snapshot, route.definition, member),
      );
      return {
        ...member,
        query: query.populateAll ? { ...own, populate: withOwnRelations(member, own.populate) } : own,
      };
    });
};

/** The sort terms the union is ordered by (each arm sorts by its own, term for term). */
export const interfaceOrderBy = (members: readonly QueryMember[]) => {
  const [first] = members;
  return compileOrderBy(first?.query.sort ?? []);
};

/**
 * The arms of an interface read: each member's filter (limited to what the read shows), search, row filter,
 * sort and locale scope. When `filters[__model]` left no member, one arm that matches nothing.
 */
export const interfaceArms = async (
  env: ReadEnvironment,
  route: InterfaceRoute,
  members: readonly QueryMember[],
  /** `filtered`: a list (filter, search and sort apply); else one entry by ID (none do). */
  options: { fallback: boolean; filtered: boolean },
): Promise<HeadQueryMember[]> => {
  const [anyMember] = route.members;
  if (members.length === 0) {
    return anyMember
      ? [
          {
            modelId: anyMember.model.definition.id,
            conditions: [matchesNothing()],
            conditionsReadEntries: false,
          },
        ]
      : [];
  }
  return Promise.all(
    members.map(async ({ model, policy, query }) => {
      const filter = await visibleReferenceFilter(env, options.filtered ? query.filter : null);
      const rowFilter = compileRowFilter(policy.rowFilter, env.actor);
      const search = options.filtered ? query.search : null;
      return {
        modelId: model.definition.id,
        conditions: [
          ...(filter ? [compileFilter(filter)] : []),
          ...(search ? [compileSearch(search.field.id, search.text)] : []),
          ...(rowFilter ? [rowFilter] : []),
        ],
        conditionsReadEntries: (filter !== null && filterReadsEntries(filter)) || rowFilter !== null,
        orderBy: options.filtered ? compileOrderBy(query.sort) : [],
        locales: readScopeFor(env.snapshot, model.definition, query.locale, { fallback: options.fallback }),
      };
    }),
  );
};
