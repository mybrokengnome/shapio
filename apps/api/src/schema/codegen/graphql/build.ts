import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLUnionType,
} from 'graphql';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlContext, ValueNode } from './context.js';
import type { FixedTypes } from './fixedTypes.js';
import type { SchemaVisibility } from './visibility.js';

/**
 * State of one schema build: the snapshot it is built from, what the caller may see of it (visibility.ts) and
 * the types created so far (by ID).
 */
export type SchemaBuild = {
  snapshot: SchemaSnapshot;
  visibility: SchemaVisibility;
  fixed: FixedTypes;
  objects: Map<string, GraphQLObjectType<ValueNode, GraphqlContext>>;
  /**
   * `<Type>Interface` by model ID, for models that have children (plan polymorphic-types D9): the model's own
   * object type and every descendant's implement it.
   */
  interfaces: Map<string, GraphQLInterfaceType>;
  /**
   * GraphQL interfaces of interface definitions by ID (plan interfaces D8), null when no member is readable by
   * the caller, and `Entry` under `ANY_TARGET` (every entry type implements it).
   */
  contracts: Map<string, GraphQLInterfaceType | null>;
  /** Component types by ID; null when the caller sees none of the component's fields. */
  components: Map<string, GraphQLObjectType<ValueNode, GraphqlContext> | null>;
  enums: Map<string, GraphQLEnumType>;
  zones: Map<string, GraphQLUnionType | null>;
  inputs: Map<string, GraphQLInputObjectType | null>;
};

export const createBuild = (
  snapshot: SchemaSnapshot,
  visibility: SchemaVisibility,
  fixed: FixedTypes,
): SchemaBuild => ({
  snapshot,
  visibility,
  fixed,
  objects: new Map(),
  interfaces: new Map(),
  contracts: new Map(),
  components: new Map(),
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
