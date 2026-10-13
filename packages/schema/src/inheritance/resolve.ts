import { isCanvasEligible } from '../display/layout.js';
import {
  isModelDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type ModelDisplay,
  type ResolvedField,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '../types/definitions.js';

/**
 * Model inheritance (plan polymorphic-types). A collection may extend another (`extends`, the parent's stable
 * ID). Stored definitions hold their own fields only; the effective definition is resolved at read time:
 * every ancestor's fields (root first, each marked `inheritedFrom`), then the model's own, and the display
 * merged down the chain. Nothing is copied into children, so a parent edit changes one definition.
 */

/** Most levels a family may have, root included (`Products > Physical > Apparel` is three). */
export const MAX_INHERITANCE_DEPTH = 8;

export type DefinitionLookup = (id: string) => SchemaDefinition | undefined;

/** Why an ancestor chain stops early. `invalid`: the parent is a component, a singleton or the model itself. */
export type AncestorProblem = 'missing' | 'invalid' | 'cycle' | 'tooDeep';

export type AncestorChain = {
  /** The ancestors that resolve, root first (the parent last). */
  ids: string[];
  problem?: AncestorProblem;
  /** The definition whose `extends` is the problem (the model itself or one of its ancestors). */
  problemAt?: string;
};

/** A definition that may be a parent: a collection. */
const canBeParent = (definition: SchemaDefinition | undefined): definition is ModelDefinition =>
  definition !== undefined && definition.kind === 'collection';

/**
 * The ancestors of a definition, root first, walking `extends` up. Stops at the first problem (missing,
 * invalid or cyclic parent, or more than MAX_INHERITANCE_DEPTH levels) and returns what resolved so far.
 */
export const ancestorChain = (definition: SchemaDefinition, lookup: DefinitionLookup): AncestorChain => {
  const upward: string[] = [];
  const seen = new Set<string>([definition.id]);
  let current: SchemaDefinition = definition;
  while (isModelDefinition(current) && current.extends !== undefined) {
    const parentId: string = current.extends;
    const at = current.id;
    const stop = (problem: AncestorProblem): AncestorChain => ({
      ids: upward.reverse(),
      problem,
      problemAt: at,
    });
    if (parentId === current.id) {
      return stop('invalid');
    }
    if (seen.has(parentId)) {
      return stop('cycle');
    }
    const parent = lookup(parentId);
    if (!parent) {
      return stop('missing');
    }
    if (!canBeParent(parent)) {
      return stop('invalid');
    }
    if (upward.length + 1 >= MAX_INHERITANCE_DEPTH) {
      return stop('tooDeep');
    }
    upward.push(parentId);
    seen.add(parentId);
    current = parent;
  }
  return { ids: upward.reverse() };
};

/** Fields a model sees from one ancestor: its own fields, marked with the ancestor's ID. */
const inheritedFieldsOf = (ancestor: ModelDefinition): ResolvedField[] =>
  ancestor.fields.map((field) => ({ ...field, inheritedFrom: ancestor.id }));

/** IDs of the fields in `fields` that `pick` keeps, in field order. */
const fieldIdsWhere = (fields: readonly FieldDefinition[], pick: (field: FieldDefinition) => boolean) =>
  fields.filter(pick).map((field) => field.id);

/**
 * A child's display over its parent's (already merged) one. Scalars and `listFieldIds` take the child's value
 * when set, else the parent's. Groups are the parent's, then the child's. Canvas and strip take the child's
 * list when set; else the parent's list (when set) with the child's own fields appended where the automatic
 * rule would put them: canvas-eligible fields to the canvas, the other fields (not the cover) to the strip.
 */
export const mergeDisplay = (
  parent: ModelDisplay,
  child: ModelDisplay,
  ownFields: readonly FieldDefinition[],
): ModelDisplay => {
  const merged: ModelDisplay = {};
  const layout = child.layout ?? parent.layout;
  const titleFieldId = child.titleFieldId ?? parent.titleFieldId;
  const listFieldIds = child.listFieldIds ?? parent.listFieldIds;
  const defaultSort = child.defaultSort ?? parent.defaultSort;
  const coverFieldId = child.coverFieldId ?? parent.coverFieldId;
  const groups = [...(parent.groups ?? []), ...(child.groups ?? [])];
  const ownCanvas = fieldIdsWhere(ownFields, isCanvasEligible);
  const canvasFieldIds =
    child.canvasFieldIds ?? (parent.canvasFieldIds ? [...parent.canvasFieldIds, ...ownCanvas] : undefined);
  const canvas = new Set(canvasFieldIds ?? []);
  const stripFieldIds =
    child.stripFieldIds ??
    (parent.stripFieldIds
      ? [
          ...parent.stripFieldIds,
          ...fieldIdsWhere(
            ownFields,
            (field) => !isCanvasEligible(field) && !canvas.has(field.id) && field.id !== coverFieldId,
          ),
        ]
      : undefined);
  if (layout !== undefined) merged.layout = layout;
  if (titleFieldId !== undefined) merged.titleFieldId = titleFieldId;
  if (listFieldIds !== undefined) merged.listFieldIds = listFieldIds;
  if (defaultSort !== undefined) merged.defaultSort = defaultSort;
  if (groups.length > 0) merged.groups = groups;
  if (canvasFieldIds !== undefined) merged.canvasFieldIds = canvasFieldIds;
  if (coverFieldId !== undefined) merged.coverFieldId = coverFieldId;
  if (stripFieldIds !== undefined) merged.stripFieldIds = stripFieldIds;
  return merged;
};

/**
 * The effective definition of a model: ancestors' fields first (root first, `inheritedFrom` set, otherwise the
 * same field objects' values and IDs), then its own fields; display merged root → model. A broken chain
 * (see `ancestorChain`) resolves over the part that resolved; the validator reports the problem.
 */
export const resolveModelDefinition = (
  definition: ModelDefinition,
  lookup: DefinitionLookup,
): ResolvedModelDefinition => {
  const { ids } = ancestorChain(definition, lookup);
  const ancestors = ids.map((id) => lookup(id) as ModelDefinition);
  let display: ModelDisplay | undefined;
  const fields: ResolvedField[] = [];
  for (const ancestor of ancestors) {
    display =
      display === undefined ? ancestor.display : mergeDisplay(display, ancestor.display, ancestor.fields);
    fields.push(...inheritedFieldsOf(ancestor));
  }
  return {
    ...definition,
    fields: [...fields, ...definition.fields],
    display:
      display === undefined
        ? definition.display
        : mergeDisplay(display, definition.display, definition.fields),
    ancestorIds: ids,
  };
};

/** The fields a resolved model declares itself (not inherited). */
export const ownFields = (resolved: ResolvedModelDefinition): FieldDefinition[] =>
  resolved.fields.filter((field) => field.inheritedFrom === undefined);

/** Definitions whose parent is `id`, in the given order. */
export const findChildDefinitions = (
  definitions: readonly SchemaDefinition[],
  id: string,
): ModelDefinition[] =>
  definitions.filter(
    (definition): definition is ModelDefinition =>
      isModelDefinition(definition) && definition.extends === id && definition.id !== id,
  );

/**
 * Inheritance lookups over one set of definitions (the active schema, a proposed one, a site's view), each
 * memoised. Unknown IDs give empty answers; components and singletons are never resolved.
 */
export type DefinitionIndex = {
  get: (id: string) => SchemaDefinition | undefined;
  /** The effective definition of a collection or singleton; undefined for components and unknown IDs. */
  resolve: (id: string) => ResolvedModelDefinition | undefined;
  /** Ancestors' IDs, root first; [] for a root or an unknown ID. */
  ancestors: (id: string) => readonly string[];
  /** Direct children's IDs, in definition order. */
  childrenOf: (id: string) => readonly string[];
  /** Every descendant's ID (children, then their children, depth first), not the model itself. */
  descendants: (id: string) => readonly string[];
  /** The model and its descendants, the model first. */
  family: (id: string) => readonly string[];
  /** The family's root (the model itself when it extends nothing). */
  rootOf: (id: string) => string;
};

const memo = <T>(compute: (id: string) => T): ((id: string) => T) => {
  const cache = new Map<string, T>();
  return (id) => {
    if (!cache.has(id)) {
      cache.set(id, compute(id));
    }
    return cache.get(id) as T;
  };
};

export const createDefinitionIndex = (definitions: readonly SchemaDefinition[]): DefinitionIndex => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const lookup: DefinitionLookup = (id) => byId.get(id);
  const children = new Map<string, string[]>();
  for (const definition of definitions) {
    if (
      isModelDefinition(definition) &&
      definition.extends !== undefined &&
      definition.extends !== definition.id
    ) {
      children.set(definition.extends, [...(children.get(definition.extends) ?? []), definition.id]);
    }
  }
  const ancestors = memo((id): readonly string[] => {
    const definition = byId.get(id);
    return definition ? ancestorChain(definition, lookup).ids : [];
  });
  const childrenOf = (id: string): readonly string[] => children.get(id) ?? [];
  const descendants = memo((id): readonly string[] => {
    const found: string[] = [];
    const seen = new Set<string>([id]);
    const walk = (current: string) => {
      for (const child of childrenOf(current)) {
        if (!seen.has(child)) {
          seen.add(child);
          found.push(child);
          walk(child);
        }
      }
    };
    walk(id);
    return found;
  });
  return {
    get: lookup,
    resolve: memo((id) => {
      const definition = byId.get(id);
      return definition && isModelDefinition(definition)
        ? resolveModelDefinition(definition, lookup)
        : undefined;
    }),
    ancestors,
    childrenOf,
    descendants,
    family: memo((id): readonly string[] => [id, ...descendants(id)]),
    rootOf: (id) => ancestors(id)[0] ?? id,
  };
};
