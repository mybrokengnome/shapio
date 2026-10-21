import {
  isStableId,
  routeKeyOf,
  type FieldDefinition,
  type InterfaceDefinition,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  type GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLFieldConfigMap,
} from 'graphql';
import { queryInvalid } from '../../../content/compiler/types.js';
import type { RelationTarget } from '../../../content/relationTarget.js';
import { AppError } from '../../../helpers/appError.js';
import * as contentDeliveryService from '../../../services/contentDelivery.js';
import type { SchemaBuild } from './build.js';
import { PAGE_SIZE_ARGUMENT, TOTAL_COUNT_COST } from './complexity.js';
import { entryNode, type GraphqlContext, type ReadScope, type ValueNode } from './context.js';
import { familyTarget, servableNodes } from './entryKinds.js';
import { contractFields, contractType, interfaceTarget } from './interfaceTypes.js';
import { collectionQueryName, modelTypeName, singleQueryName } from './names.js';
import { entryOutputType } from './outputTypes.js';
import {
  createFilterInput,
  createSortInput,
  filterParams,
  scalarParams,
  sortParams,
  toRawQuery,
} from './queryArgs.js';
import { readableFields } from './visibility.js';

/**
 * Root query fields per model, named only by naming.ts: `page(id)` and `pageCollection(…)` (singletons:
 * `home(…)`). They call the delivery service REST uses (`services/contentDelivery.ts`) with the querystring
 * REST would receive, so both APIs parse, authorize and read identically. A model with children reads its
 * whole family there (plan polymorphic-types D5) and is typed as its interface (D9): filters and sorts name
 * its effective fields, and each row resolves to its own kind's type. An interface definition has the same
 * two queries (`featurable(id)`, `featurables(…)`, plan interfaces D8), served by its interface route: rows of
 * every readable member, filters and sorts over the contract fields every readable member exposes.
 */
export type RootField = GraphQLFieldConfig<unknown, GraphqlContext, Record<string, unknown>>;

type ReadArgs = {
  locale?: string | null;
  fallback?: boolean | null;
  publicationState?: 'published' | 'draft' | null;
  snapshot?: number | null;
};

const readArgs = (build: SchemaBuild): GraphQLFieldConfigArgumentMap => ({
  locale: { type: GraphQLString, description: 'Locale code; the default locale when omitted' },
  fallback: {
    type: GraphQLBoolean,
    defaultValue: true,
    description: "Serve the locale's fallback when an entry has no version in the requested locale",
  },
  publicationState: {
    type: build.fixed.publicationState,
    defaultValue: 'published',
    description: 'DRAFT needs an admin user, an admin API token or a delivery token granted Read drafts',
  },
  snapshot: { type: GraphQLInt, description: 'Read published content as of this publication sequence' },
});

/**
 * The read scope of a root read. Drafts: the delivery service checks the caller may read them (admin
 * principals, delivery tokens granted Read drafts; plan drafts-mode) before reading any head, and the
 * response is marked never to be stored.
 */
const scopeOf = (args: ReadArgs, context: GraphqlContext): ReadScope => {
  const drafts = args.publicationState === 'draft';
  if (drafts) {
    context.markDrafts();
  }
  return {
    locale: args.locale ?? undefined,
    fallback: args.fallback ?? true,
    drafts,
    snapshot: args.snapshot ?? undefined,
  };
};

const readParams = (args: ReadArgs) => scalarParams({ locale: args.locale, snapshot: args.snapshot });

const isNotFound = (error: unknown) => error instanceof AppError && error.code === 'ENTRY_NOT_FOUND';

export const assertId = (id: unknown): string => {
  if (!isStableId(id)) {
    throw queryInvalid('"id" is not a valid entry ID');
  }
  return id;
};

/**
 * What a model's or an interface definition's queries serve: the definition naming the types, the output type
 * of its rows, the fields its filters and sorts may name, and the models whose rows it may resolve.
 */
type Served = {
  owner: SchemaDefinition;
  output: GraphQLObjectType<ValueNode, GraphqlContext> | GraphQLInterfaceType;
  fields: readonly FieldDefinition[];
  target: RelationTarget;
};

const connectionType = (build: SchemaBuild, served: Served) =>
  new GraphQLObjectType({
    name: modelTypeName(served.owner, 'Connection'),
    fields: {
      nodes: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(served.output))),
        extensions: { cost: { list: 'pageSize' } },
      },
      totalCount: {
        type: new GraphQLNonNull(GraphQLInt),
        extensions: { cost: { weight: TOTAL_COUNT_COST } },
      },
      pageInfo: { type: new GraphQLNonNull(build.fixed.pageInfo) },
      locale: { type: new GraphQLNonNull(GraphQLString), description: 'The requested locale' },
      snapshot: {
        type: GraphQLInt,
        description:
          'Publication sequence this page reflects (pin a site build with `snapshot`); null for drafts',
      },
    },
  });

const collectionQuery = (build: SchemaBuild, served: Served): RootField => {
  const { owner } = served;
  return {
    type: connectionType(build, served),
    description: `A page of ${owner.label} entries`,
    extensions: { cost: { pageSizeArgument: PAGE_SIZE_ARGUMENT, weight: 'pageSize' } },
    args: {
      filter: { type: createFilterInput(owner, served.fields, build.fixed) },
      sort: {
        type: new GraphQLList(new GraphQLNonNull(createSortInput(owner, served.fields, build.fixed))),
      },
      search: {
        type: GraphQLString,
        description: `Case-insensitive search of the ${owner.kind === 'interface' ? "interface's" : "model's"} title field`,
      },
      page: { type: GraphQLInt },
      [PAGE_SIZE_ARGUMENT]: { type: GraphQLInt },
      ...readArgs(build),
    },
    resolve: async (_root, args, context) => {
      const scope = scopeOf(args, context);
      const rawQuery = toRawQuery([
        ...filterParams(args.filter as Record<string, unknown> | null),
        ...sortParams(args.sort as Array<Record<string, unknown>> | null),
        ...scalarParams({ q: args.search as string | null, page: args.page as number | null }),
        ...scalarParams({ pageSize: args[PAGE_SIZE_ARGUMENT] as number | null }),
        ...readParams(args),
      ]);
      const result = (await contentDeliveryService.listDelivery(
        await context.content(build.snapshot),
        owner.apiKey,
        rawQuery,
        { fallback: scope.fallback, drafts: scope.drafts },
      )) as contentDeliveryService.DeliveryList;
      return {
        // A row of a kind this caller's schema has no type for is left out (REST already leaves out kinds the
        // caller may not read, so this only guards against a type the schema could not resolve).
        nodes: servableNodes(
          build,
          served.target,
          result.data.map((entry) => entryNode(entry, scope)),
        ),
        totalCount: result.meta.pagination.total,
        pageInfo: result.meta.pagination,
        locale: result.meta.locale,
        snapshot: result.meta.snapshot,
      };
    },
  };
};

const singleQuery = (build: SchemaBuild, served: Served, singleton: boolean): RootField => {
  const { owner } = served;
  return {
    type: served.output,
    description: singleton
      ? `The ${owner.label} entry`
      : `One ${owner.label} entry by ID (null when not found)`,
    args: {
      ...(singleton ? {} : { id: { type: new GraphQLNonNull(GraphQLID) } }),
      ...readArgs(build),
    },
    resolve: async (_root, args, context) => {
      const scope = scopeOf(args, context);
      const service = await context.content(build.snapshot);
      const options = { fallback: scope.fallback, drafts: scope.drafts };
      const rawQuery = toRawQuery(readParams(args));
      try {
        const result = singleton
          ? await contentDeliveryService.listDelivery(service, owner.apiKey, rawQuery, options)
          : await contentDeliveryService.getDelivery(
              service,
              owner.apiKey,
              assertId(args.id),
              rawQuery,
              options,
            );
        const [node] = servableNodes(build, served.target, [
          entryNode((result as contentDeliveryService.DeliveryItem).data, scope),
        ]);
        return node ?? null;
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
  };
};

export const queryFields = (
  build: SchemaBuild,
  model: ResolvedModelDefinition,
): GraphQLFieldConfigMap<unknown, GraphqlContext> => {
  const served: Served = {
    owner: model,
    output: entryOutputType(build, model),
    fields: readableFields(build.visibility, model),
    target: familyTarget(build, model.id),
  };
  return model.kind === 'singleton'
    ? { [singleQueryName(model)]: singleQuery(build, served, true) }
    : {
        [singleQueryName(model)]: singleQuery(build, served, false),
        [collectionQueryName(model)]: collectionQuery(build, served),
      };
};

/**
 * `featurable(id)` and `featurables(…)` of an interface definition (plan interfaces D8); none when the caller
 * may read no member (the interface is then not in its schema).
 */
export const interfaceQueryFields = (
  build: SchemaBuild,
  definition: InterfaceDefinition,
): GraphQLFieldConfigMap<unknown, GraphqlContext> => {
  const output = contractType(build, definition);
  if (!output) {
    return {};
  }
  const served: Served = {
    owner: definition,
    output,
    fields: contractFields(build, definition),
    target: interfaceTarget(build, definition.id),
  };
  return {
    [singleQueryName(definition)]: singleQuery(build, served, false),
    [routeKeyOf(definition)]: collectionQuery(build, served),
  };
};
