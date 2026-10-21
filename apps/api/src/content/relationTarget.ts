import { ANY_TARGET, isInterfaceDefinition, isModelDefinition, type FieldDefinition } from '@shapio/schema';
import type { SchemaById } from '../schema/snapshot.js';
import { familyIdsOf } from './family.js';

/**
 * What a relation field accepts (plan interfaces, D4): the one way to read a relation's `settings.target`.
 *
 * - `model`: a collection and its kinds (plan polymorphic-types), the collection first.
 * - `interface`: every member of the interface in the schema view (directly or through an ancestor, kinds
 *   and singletons included).
 * - `any`: an entry of any collection or singleton on the site. It carries no model list on purpose: the
 *   write check needs no model predicate (entries only belong to collections and singletons), and reads by
 *   ID look up the models the IDs belong to first, so neither scales with the size of the schema.
 *
 * `modelIds` are as of the given schema (a site's view, the network, a proposed schema). A target that is not
 * in it (a deleted model) is a `model` target of that one ID, which matches no live entry.
 */
export type RelationTarget =
  | { kind: 'model'; id: string; modelIds: readonly string[] }
  | { kind: 'interface'; id: string; modelIds: readonly string[] }
  | { kind: 'any' };

export const relationTargetOf = (snapshot: SchemaById, field: FieldDefinition<'relation'>): RelationTarget =>
  relationTargetFor(snapshot, field.settings.target);

/** `relationTargetOf` from a relation's stored `settings.target` (a model ID, an interface ID, or `*`). */
export const relationTargetFor = (snapshot: SchemaById, target: string): RelationTarget => {
  if (target === ANY_TARGET) {
    return { kind: 'any' };
  }
  const definition = snapshot.byId.get(target)?.definition;
  if (definition && isInterfaceDefinition(definition)) {
    return { kind: 'interface', id: target, modelIds: snapshot.implementedBy(target) };
  }
  return { kind: 'model', id: target, modelIds: familyIdsOf(snapshot, target) };
};

/**
 * Whether an entry of the model may be a value of a relation with this target. For `any`, the model must be a
 * collection or singleton of the schema.
 */
export const targetAcceptsModel = (
  snapshot: SchemaById,
  target: RelationTarget,
  modelId: string,
): boolean => {
  if (target.kind === 'any') {
    const definition = snapshot.byId.get(modelId)?.definition;
    return definition !== undefined && isModelDefinition(definition);
  }
  return target.modelIds.includes(modelId);
};

/**
 * A stable key for the set of models a target accepts, for caches keyed by schema shape (the content
 * validator's): a type joining or leaving an interface, or a new kind, changes it. `any` is constant.
 */
export const relationTargetKey = (target: RelationTarget): string =>
  target.kind === 'any' ? ANY_TARGET : `${target.id}=${target.modelIds.join(',')}`;
