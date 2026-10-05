import { isStableId, type ModelDefinition } from '@shapio/schema';
import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  type GraphQLFieldConfig,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLFieldConfigMap,
} from 'graphql';
import { queryInvalid } from '../../../content/compiler/types.js';
import { AppError } from '../../../helpers/appError.js';
import * as contentDeliveryService from '../../../services/contentDelivery.js';
import type { SchemaBuild } from './build.js';
import { PAGE_SIZE_ARGUMENT, TOTAL_COUNT_COST } from './complexity.js';
import { entryNode, type GraphqlContext, type ReadScope } from './context.js';
import { collectionQueryName, modelTypeName, singleQueryName } from './names.js';
import { entryType } from './outputTypes.js';
import {
  createFilterInput,
  createSortInput,
  filterParams,
  scalarParams,
  sortParams,
  toRawQuery,
} from './queryArgs.js';

/**
 * Root query fields per model, named only by naming.ts: `page(id)` and `pageCollection(…)` (singletons:
 * `home(…)`). They call the delivery service REST uses (`services/contentDelivery.ts`) with the querystring
 * REST would receive, so both APIs parse, authorize and read identically.
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

const connectionType = (build: SchemaBuild, model: ModelDefinition) =>
  new GraphQLObjectType({
    name: modelTypeName(model, 'Connection'),
    fields: {
      nodes: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(entryType(build, model)))),
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

const collectionQuery = (build: SchemaBuild, model: ModelDefinition): RootField => {
  return {
    type: connectionType(build, model),
    description: `A page of ${model.label} entries`,
    extensions: { cost: { pageSizeArgument: PAGE_SIZE_ARGUMENT, weight: 'pageSize' } },
    args: {
      filter: { type: createFilterInput(model, build.fixed) },
      sort: { type: new GraphQLList(new GraphQLNonNull(createSortInput(model, build.fixed))) },
      search: { type: GraphQLString, description: "Case-insensitive search of the model's title field" },
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
        model.apiKey,
        rawQuery,
        { fallback: scope.fallback, drafts: scope.drafts },
      )) as contentDeliveryService.DeliveryList;
      return {
        nodes: result.data.map((entry) => entryNode(entry, scope)),
        totalCount: result.meta.pagination.total,
        pageInfo: result.meta.pagination,
        locale: result.meta.locale,
        snapshot: scope.drafts ? null : result.meta.snapshot,
      };
    },
  };
};

const singleQuery = (build: SchemaBuild, model: ModelDefinition): RootField => {
  const singleton = model.kind === 'singleton';
  return {
    type: entryType(build, model),
    description: singleton
      ? `The ${model.label} entry`
      : `One ${model.label} entry by ID (null when not found)`,
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
          ? await contentDeliveryService.listDelivery(service, model.apiKey, rawQuery, options)
          : await contentDeliveryService.getDelivery(
              service,
              model.apiKey,
              assertId(args.id),
              rawQuery,
              options,
            );
        return entryNode((result as contentDeliveryService.DeliveryItem).data, scope);
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
  model: ModelDefinition,
): GraphQLFieldConfigMap<unknown, GraphqlContext> =>
  model.kind === 'singleton'
    ? { [singleQueryName(model)]: singleQuery(build, model) }
    : {
        [singleQueryName(model)]: singleQuery(build, model),
        [collectionQueryName(model)]: collectionQuery(build, model),
      };
