import {
  ANY_TARGET,
  type DefinitionIndex,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import type { TFunction } from 'i18next';

/**
 * What a field points at, in the builder's words (plan interfaces D11): the relation Target select's labels
 * and the field list's "→ Page and 3 kinds". The content side has its own (`fields/helpers`), which only
 * knows the models the viewer can read.
 */

/** The lookups the labels need: the definitions with the draft in place. */
export type TargetIndex = Pick<DefinitionIndex, 'get' | 'descendants'>;

/** A type as a relation target: "Page", or "Page and 3 kinds" when other types extend it. */
export const targetTypeLabel = (definition: SchemaDefinition, index: TargetIndex, t: TFunction): string => {
  const kinds = index.descendants(definition.id).length;
  return kinds > 0
    ? t('models.builder.targetWithKinds', { name: definition.label, count: kinds })
    : definition.label;
};

/**
 * A relation's `settings.target` as a name: "Any entry", "Linkable (interface)", "Page and 3 kinds", or
 * undefined when it is unset or not in the index (another site's type, or one this view can't see).
 */
export const relationTargetLabel = (
  target: unknown,
  index: TargetIndex,
  t: TFunction,
): string | undefined => {
  if (typeof target !== 'string' || target === '') {
    return undefined;
  }
  if (target === ANY_TARGET) {
    return t('models.builder.anyEntry');
  }
  const definition = index.get(target);
  if (!definition) {
    return undefined;
  }
  return definition.kind === 'interface'
    ? t('models.builder.targetInterfaceLabel', { name: definition.label })
    : targetTypeLabel(definition, index, t);
};

/** The labels of the known definitions among `ids`, in order, joined: "Hero, Grid". */
const labelsOf = (ids: unknown, index: TargetIndex): string | undefined => {
  const labels = (Array.isArray(ids) ? ids : [ids]).flatMap((id) => {
    const definition = typeof id === 'string' ? index.get(id) : undefined;
    return definition ? [definition.label] : [];
  });
  return labels.length > 0 ? labels.join(', ') : undefined;
};

/**
 * What a field points at, for the field list: a relation's target, a component field's component, or a
 * dynamic zone's components. Undefined for every other type and for a target not chosen yet.
 */
export const fieldTargetLabel = (
  field: Pick<FieldDefinition, 'type'> & { settings?: unknown },
  index: TargetIndex,
  t: TFunction,
): string | undefined => {
  const settings = (field.settings ?? {}) as Record<string, unknown>;
  switch (field.type) {
    case 'relation':
      return relationTargetLabel(settings.target, index, t);
    case 'component':
      return labelsOf(settings.component, index);
    case 'dynamiczone':
      return labelsOf(settings.components, index);
    default:
      return undefined;
  }
};
