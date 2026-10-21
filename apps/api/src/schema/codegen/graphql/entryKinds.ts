import {
  isModelDefinition,
  type FieldDefinition,
  type ResolvedField,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { familyIdsOf } from '../../../content/family.js';
import { targetAcceptsModel, type RelationTarget } from '../../../content/relationTarget.js';
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
 * GraphQL field: clients use `__typename`. Interface definitions and `Entry` (plan interfaces D8) resolve their
 * rows the same way, over their members and over every model.
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

/** What a model's own queries serve: the model and its kinds (its family in the view). */
export const familyTarget = (build: SchemaBuild, modelId: string): RelationTarget => ({
  kind: 'model',
  id: modelId,
  modelIds: familyIdsOf(build.snapshot, modelId),
});

/**
 * The members of an interface definition the caller may read and whose entry type the schema has (plan
 * interfaces D8). The interface is in the caller's schema exactly when this is not empty.
 */
export const readableMemberIds = (build: SchemaBuild, interfaceId: string): string[] =>
  build.snapshot
    .implementedBy(interfaceId)
    .filter(
      (id) => resolvedModelById(build.snapshot, id) !== undefined && modelReadable(build.visibility, id),
    );

/**
 * The object type name of a row served as `target` (a model with children, an interface, any entry): its own
 * kind's type, when that model is one the target accepts and the caller's schema has its type. Undefined
 * otherwise; such rows are left out of lists and resolve to null as single values (rule 7: never served as
 * another kind).
 */
export const rowTypeName = (
  build: SchemaBuild,
  target: RelationTarget,
  node: ValueNode,
): string | undefined => {
  const apiKey = node.data[MODEL_KEY];
  const kind = typeof apiKey === 'string' ? build.snapshot.modelsByApiKey.get(apiKey)?.definition : undefined;
  if (!kind || !isModelDefinition(kind) || !modelReadable(build.visibility, kind.id)) {
    return undefined;
  }
  return targetAcceptsModel(build.snapshot, target, kind.id) ? modelTypeName(kind) : undefined;
};

/**
 * Keeps the nodes a field typed as `target` can serve: every node for a model without children (its own
 * object type), the nodes of a model the caller's schema has a type for otherwise (an interface).
 */
export const servableNodes = <T extends ValueNode>(
  build: SchemaBuild,
  target: RelationTarget,
  nodes: readonly T[],
): T[] =>
  target.kind === 'model' && !hasChildren(build, target.id)
    ? [...nodes]
    : nodes.filter((node) => rowTypeName(build, target, node) !== undefined);
