import {
  ANY_TARGET,
  isInterfaceDefinition,
  type DefinitionIndex,
  type ModelDefinition,
} from '@shapio/schema';
import type { TFunction } from 'i18next';

/**
 * What a relation field points at, as the admin can see it (plan interfaces D4, D11):
 * - `model`: a collection the viewer can read (and its kinds);
 * - `interface`: an interface, labeled from the resolved index (every member of the schema can read it);
 * - `any`: "Any entry" (`settings.target` is `*`);
 * - `unreadable`: neither a readable model nor a known interface, i.e. a type this role can't read.
 */
export type RelationTargetInfo =
  | { kind: 'model'; model: ModelDefinition }
  | { kind: 'interface'; id: string; label: string }
  | { kind: 'any' }
  | { kind: 'unreadable' };

/**
 * Classifies a relation's `settings.target`: the readable models first, then the index (interfaces), else
 * unreadable. Never read `models.get(settings.target)` directly: a `*` or an interface ID is not a model.
 */
export const relationTargetInfoOf = (
  target: string,
  models: ReadonlyMap<string, ModelDefinition>,
  index: Pick<DefinitionIndex, 'get'> | undefined,
): RelationTargetInfo => {
  if (target === ANY_TARGET) {
    return { kind: 'any' };
  }
  const model = models.get(target);
  if (model) {
    return { kind: 'model', model };
  }
  const definition = index?.get(target);
  if (definition && isInterfaceDefinition(definition)) {
    return { kind: 'interface', id: definition.id, label: definition.label };
  }
  return { kind: 'unreadable' };
};

/** The target's name in copy: the model's or interface's label, "Any entry", or undefined when unreadable. */
export const relationTargetLabel = (info: RelationTargetInfo, t: TFunction): string | undefined => {
  switch (info.kind) {
    case 'model':
      return info.model.label;
    case 'interface':
      return info.label;
    case 'any':
      return t('content.relation.anyEntry');
    case 'unreadable':
      return undefined;
  }
};

/** Whether the picker reads through the admin content-targets endpoint (a target spanning several types). */
export const readsContentTargets = (
  info: RelationTargetInfo,
): info is Extract<RelationTargetInfo, { kind: 'interface' | 'any' }> =>
  info.kind === 'interface' || info.kind === 'any';
