import { isModelDefinition, RESERVED_QUERY_NAMES, type ModelDefinition } from '@shapio/schema';
import {
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  type GraphQLFieldConfigMap,
} from 'graphql';
import type { SchemaSnapshot } from '../../snapshot.js';
import { createBuild } from './build.js';
import type { GraphqlContext } from './context.js';
import { createFixedTypes } from './fixedTypes.js';
import { mutationFields } from './mutations.js';
import { queryFields } from './operations.js';
import { siteQueryFields } from './siteFields.js';
import { snapshotQueryFields } from './snapshotFields.js';
import { buildUsageMap, USAGE_MAP_EXTENSION } from './usageSelection.js';

/** A root field every schema has (GraphQL needs one even before the first model exists). */
const SCHEMA_VERSION_FIELD = RESERVED_QUERY_NAMES[0] as string;

export type BuiltSchema = { version: number; schema: GraphQLSchema };

/**
 * The GraphQL schema of one schema snapshot, built programmatically (never from SDL strings, ADR 0006).
 * Resolvers close over the snapshot they were built from, so a request always executes against the model
 * definitions its schema describes.
 */
export const buildGraphqlSchema = (snapshot: SchemaSnapshot): BuiltSchema => {
  const build = createBuild(snapshot, createFixedTypes());
  const models = snapshot.definitions
    .map((active) => active.definition)
    .filter((definition): definition is ModelDefinition => isModelDefinition(definition))
    .sort((a, b) => a.apiKey.localeCompare(b.apiKey));
  const query: GraphQLFieldConfigMap<unknown, GraphqlContext> = {};
  const mutation: GraphQLFieldConfigMap<unknown, GraphqlContext> = {};
  for (const model of models) {
    Object.assign(query, queryFields(build, model));
    Object.assign(mutation, mutationFields(build, model));
  }
  // Reserved in naming.ts (RESERVED_QUERY_NAMES), so no model can take it.
  query[SCHEMA_VERSION_FIELD] = {
    type: new GraphQLNonNull(GraphQLInt),
    description: 'The schema version this API reflects; it changes whenever a model changes',
    resolve: () => snapshot.version,
  };
  Object.assign(query, snapshotQueryFields(snapshot), siteQueryFields(snapshot, build.fixed));
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: query }),
    ...(models.length > 0 ? { mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutation }) } : {}),
    // Every generated object type, including those reachable only as dynamic-zone union members.
    types: [...build.objects.values()],
    // Entry type → model and fields, for counting field usage per operation (usageSelection.ts).
    extensions: { [USAGE_MAP_EXTENSION]: buildUsageMap(snapshot) },
  });
  return { version: snapshot.version, schema };
};
