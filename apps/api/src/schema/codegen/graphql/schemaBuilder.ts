import {
  isInterfaceDefinition,
  RESERVED_QUERY_NAMES,
  type InterfaceDefinition,
  type ResolvedModelDefinition,
} from '@shapio/schema';
import {
  GraphQLInt,
  GraphQLNonNull,
  type GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  type GraphQLFieldConfigMap,
} from 'graphql';
import type { SchemaSnapshot } from '../../snapshot.js';
import { createBuild } from './build.js';
import type { GraphqlContext } from './context.js';
import { hasChildren, resolvedModelById } from './entryKinds.js';
import { createFixedTypes } from './fixedTypes.js';
import { entryInterface } from './interfaceTypes.js';
import { mutationFields } from './mutations.js';
import { interfaceQueryFields, queryFields } from './operations.js';
import { entryType } from './outputTypes.js';
import { siteQueryFields } from './siteFields.js';
import { snapshotQueryFields } from './snapshotFields.js';
import { buildUsageMap, USAGE_MAP_EXTENSION } from './usageSelection.js';
import { FULL_VISIBILITY, modelInSchema, modelReadable, type SchemaVisibility } from './visibility.js';

/** A root field every schema has (GraphQL needs one even before the first model exists). */
const SCHEMA_VERSION_FIELD = RESERVED_QUERY_NAMES[0] as string;

export type BuiltSchema = { version: number; schema: GraphQLSchema };

/**
 * The GraphQL schema of one schema snapshot as one caller may see it (visibility.ts; admin callers and tools
 * see everything), built programmatically (never from SDL strings, ADR 0006). A model no policy allows is
 * absent; one the caller may only write has its mutations and no read queries. Resolvers close over the
 * snapshot they were built from, so a request always executes against the model definitions its schema
 * describes.
 */
export const buildGraphqlSchema = (
  snapshot: SchemaSnapshot,
  visibility: SchemaVisibility = FULL_VISIBILITY,
): BuiltSchema => {
  const build = createBuild(snapshot, visibility, createFixedTypes());
  // Effective definitions (inherited fields first): types, inputs, filters and sorts hold every field a kind has.
  const models = snapshot.definitions
    .map((active) => resolvedModelById(snapshot, active.definition.id))
    .filter((model): model is ResolvedModelDefinition => model !== undefined)
    .filter((model) => modelInSchema(visibility, model.id))
    .sort((a, b) => a.apiKey.localeCompare(b.apiKey));
  const query: GraphQLFieldConfigMap<unknown, GraphqlContext> = {};
  const mutation: GraphQLFieldConfigMap<unknown, GraphqlContext> = {};
  for (const model of models) {
    if (modelReadable(visibility, model.id)) {
      Object.assign(query, queryFields(build, model));
      if (hasChildren(build, model.id)) {
        // Its queries return its interface; its own kind's rows still need their object type.
        entryType(build, model);
      }
    }
    Object.assign(mutation, mutationFields(build, model));
  }
  // Interface definitions with a readable member (plan interfaces D8): their interface and two queries.
  const interfaces = snapshot.definitions
    .map((active) => active.definition)
    .filter((definition): definition is InterfaceDefinition => isInterfaceDefinition(definition))
    .sort((a, b) => a.apiKey.localeCompare(b.apiKey));
  for (const definition of interfaces) {
    Object.assign(query, interfaceQueryFields(build, definition));
  }
  // Reserved in naming.ts (RESERVED_QUERY_NAMES), so no model can take it.
  query[SCHEMA_VERSION_FIELD] = {
    type: new GraphQLNonNull(GraphQLInt),
    description: 'The schema version this API reflects; it changes whenever a model changes',
    resolve: () => snapshot.version,
  };
  Object.assign(query, snapshotQueryFields(snapshot), siteQueryFields(snapshot, build.fixed));
  const entry = entryInterface(build);
  // `Entry` is in `contracts` too, under `ANY_TARGET`.
  const contracts = [...build.contracts.values()].filter(
    (type): type is GraphQLInterfaceType => type !== null && type !== entry,
  );
  const schema = new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: query }),
    ...(models.length > 0 ? { mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutation }) } : {}),
    // Every generated object type, including those reachable only as dynamic-zone union members or as an
    // interface's implementations, and every interface; `Entry` always.
    types: [...build.objects.values(), ...build.interfaces.values(), entry, ...contracts],
    // Entry type → model and fields, for counting field usage per operation (usageSelection.ts).
    extensions: { [USAGE_MAP_EXTENSION]: buildUsageMap(snapshot, visibility) },
  });
  return { version: snapshot.version, schema };
};
