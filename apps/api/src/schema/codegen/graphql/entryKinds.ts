import {
  isModelDefinition,
  type FieldDefinition,
  type ResolvedField,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { MODEL_KEY } from '../../../content/validator/index.js';
import type { SchemaById } from '../../snapshot.js';
import type { SchemaBuild } from './build.js';
import type { ValueNode } from './context.js';
import { modelTypeName } from './names.js';
import { modelReadable } from './visibility.js';

/*
 * Model inheritance in GraphQL (plan polymorphic-types D9). A model with children is served as
 * `<Type>Interface`; each row is resolved to its own kind's object type through `__model`, the row's singular
 * API ID that every delivery entry carries (like `__component` on dynamic-zone items). `__model` is never a
 * GraphQL field: clients use `__typename`.
 */
/** A collection or singleton by ID with its effective fields (inherited first); undefined for anything else. */
export const resolvedModelById = (snapshot: SchemaById, id: string): ResolvedModelDefinition | undefined => {
  const definition = snapshot.byId.get(id)?.definition;
  return definition && isModelDefinition(definition) ? snapshot.resolve(id) : undefined;
};

/** Whether a model is extended by another: it is then served as an interface (lists, lookups, relations). */
export const hasChildren = (build: SchemaBuild, modelId: string): boolean =>
  build.snapshot.childrenOf(modelId).length > 0;

/**
 * The definition that declares a field: the ancestor it is inherited from, else `owner`. Enum and zone types
 * are keyed and named by it, so a parent and its children share one type object per inherited field.
 */
export const declaringOwner = (
  build: SchemaBuild,
  owner: SchemaDefinition,
  field: FieldDefinition,
): SchemaDefinition => {
  const from = (field as ResolvedField).inheritedFrom;
  return (from !== undefined ? build.snapshot.byId.get(from)?.definition : undefined) ?? owner;
};

/**
 * The object type name of a row served as `model` (a model with children): its own kind's type, when that kind
 * is `model` or one of its descendants and the caller's schema has its type. Undefined otherwise; such rows
 * are left out of lists and resolve to null as single values (rule 7: never served as another kind).
 */
export const kindTypeName = (
  build: SchemaBuild,
  model: SchemaDefinition,
  node: ValueNode,
): string | undefined => {
  const apiKey = node.data[MODEL_KEY];
  const kind = typeof apiKey === 'string' ? build.snapshot.modelsByApiKey.get(apiKey)?.definition : undefined;
  if (!kind || !isModelDefinition(kind) || !modelReadable(build.visibility, kind.id)) {
    return undefined;
  }
  const inFamily = kind.id === model.id || build.snapshot.ancestors(kind.id).includes(model.id);
  return inFamily ? modelTypeName(kind) : undefined;
};

/**
 * Keeps the nodes a field typed as `model` can serve: every node for a model without children (its own object
 * type), the nodes of a kind in the caller's schema for a model with children (its interface).
 */
export const servableNodes = <T extends ValueNode>(
  build: SchemaBuild,
  model: SchemaDefinition,
  nodes: readonly T[],
): T[] =>
  hasChildren(build, model.id)
    ? nodes.filter((node) => kindTypeName(build, model, node) !== undefined)
    : [...nodes];
