import type { GraphQLEnumType, GraphQLInputObjectType, GraphQLObjectType, GraphQLUnionType } from 'graphql';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlContext, ValueNode } from './context.js';
import type { FixedTypes } from './fixedTypes.js';

/** State of one schema build: the snapshot it is built from and the types created so far (by ID). */
export type SchemaBuild = {
  snapshot: SchemaSnapshot;
  fixed: FixedTypes;
  objects: Map<string, GraphQLObjectType<ValueNode, GraphqlContext>>;
  enums: Map<string, GraphQLEnumType>;
  zones: Map<string, GraphQLUnionType | null>;
  inputs: Map<string, GraphQLInputObjectType | null>;
};

export const createBuild = (snapshot: SchemaSnapshot, fixed: FixedTypes): SchemaBuild => ({
  snapshot,
  fixed,
  objects: new Map(),
  enums: new Map(),
  zones: new Map(),
  inputs: new Map(),
});

/** Memoizes a type per key within one build (thunks make cyclic relations possible). */
export const memoType = <T>(cache: Map<string, T>, key: string, create: () => T): T => {
  if (cache.has(key)) {
    return cache.get(key) as T;
  }
  const created = create();
  cache.set(key, created);
  return created;
};
