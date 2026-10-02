import {
  GraphQLEnumType,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  type GraphQLFieldConfigMap,
  type GraphQLNullableType,
} from 'graphql';
import * as snapshotChangesService from '../../../services/snapshotChanges.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlContext } from './context.js';

/**
 * `_changes` and `_snapshot` (plan developer-face §5): the snapshot diff API in GraphQL, through the same
 * service as REST `/api/snapshots`. Their names and the `SnapshotChange*`/`SnapshotInfo` types are reserved
 * in `@shapio/schema` naming.ts, so no model can take them.
 */
export const CHANGES_QUERY = '_changes';
export const SNAPSHOT_QUERY = '_snapshot';

const nonNull = <T extends GraphQLNullableType>(type: T) => new GraphQLNonNull(type);

const createTypes = () => {
  const kind = new GraphQLEnumType({
    name: 'SnapshotChangeKind',
    values: {
      PUBLISHED: { value: 'published', description: 'Not live at `from`, live at `to`' },
      UPDATED: { value: 'updated', description: 'Live at both ends with different content' },
      UNPUBLISHED: { value: 'unpublished', description: 'Live at `from`, not live (or deleted) at `to`' },
    },
  });
  const locale = new GraphQLObjectType({
    name: 'SnapshotChangeLocale',
    fields: { locale: { type: nonNull(GraphQLString) }, change: { type: nonNull(kind) } },
  });
  const change = new GraphQLObjectType({
    name: 'SnapshotChange',
    description: 'An entry whose live content differs between two snapshots, with the locales that changed',
    fields: {
      id: { type: nonNull(GraphQLID) },
      modelId: { type: nonNull(GraphQLID) },
      modelKey: { type: nonNull(GraphQLString), description: "The model's API ID" },
      routeKey: {
        type: nonNull(GraphQLString),
        description: 'The REST route key (`/api/content/<routeKey>`)',
      },
      locales: { type: nonNull(new GraphQLList(nonNull(locale))) },
    },
  });
  const page = new GraphQLObjectType({
    name: 'SnapshotChangePage',
    fields: {
      from: { type: nonNull(GraphQLInt) },
      to: { type: nonNull(GraphQLInt) },
      fromSchemaVersion: {
        type: GraphQLInt,
        resolve: (source: snapshotChangesService.SnapshotChangesPage) => source.schemaVersions.from,
      },
      toSchemaVersion: {
        type: GraphQLInt,
        resolve: (source: snapshotChangesService.SnapshotChangesPage) => source.schemaVersions.to,
      },
      nodes: {
        type: nonNull(new GraphQLList(nonNull(change))),
        resolve: (source: snapshotChangesService.SnapshotChangesPage) => source.items,
      },
      nextCursor: {
        type: GraphQLID,
        description: 'Pass as `after` for the next page; null on the last page',
      },
    },
  });
  const info = new GraphQLObjectType({
    name: 'SnapshotInfo',
    fields: {
      snapshot: { type: nonNull(GraphQLInt), description: 'The latest publication sequence number' },
      schemaVersion: { type: nonNull(GraphQLInt), description: 'The active schema version' },
      publishedAt: {
        type: GraphQLString,
        resolve: (source: snapshotChangesService.CurrentSnapshot) =>
          source.publishedAt?.toISOString() ?? null,
      },
    },
  });
  return { page, info };
};

type ChangesArgs = { from: number; to?: number | null; after?: string | null; first?: number | null };

export const snapshotQueryFields = (
  snapshot: SchemaSnapshot,
): GraphQLFieldConfigMap<unknown, GraphqlContext> => {
  const { page, info } = createTypes();
  return {
    [CHANGES_QUERY]: {
      type: nonNull(page),
      description: 'Entries whose live content changed between two snapshots (incremental builds)',
      args: {
        from: { type: nonNull(GraphQLInt) },
        to: { type: GraphQLInt, description: 'Defaults to the current snapshot' },
        after: { type: GraphQLID, description: '`nextCursor` of the previous page' },
        first: {
          type: GraphQLInt,
          description: `Entries per page (default ${snapshotChangesService.SNAPSHOT_CHANGES_DEFAULT_LIMIT}, at most ${snapshotChangesService.SNAPSHOT_CHANGES_MAX_LIMIT})`,
        },
      },
      extensions: { cost: { weight: 10 } },
      resolve: async (_root, args: ChangesArgs, context) =>
        snapshotChangesService.listSnapshotChanges(await context.content(snapshot), {
          from: args.from,
          ...(args.to !== null && args.to !== undefined ? { to: args.to } : {}),
          ...(args.after ? { after: args.after } : {}),
          ...(args.first !== null && args.first !== undefined ? { limit: args.first } : {}),
        }),
    },
    [SNAPSHOT_QUERY]: {
      type: nonNull(info),
      description: 'The current snapshot and schema version',
      resolve: async (_root, _args, context) =>
        snapshotChangesService.currentSnapshot(await context.content(snapshot)),
    },
  };
};
