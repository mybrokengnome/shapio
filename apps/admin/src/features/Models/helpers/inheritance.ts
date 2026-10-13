import type { DefinitionScope } from '@shapio/client';
import {
  isModelDefinition,
  mergeDisplay,
  type DefinitionIndex,
  type ModelDefinition,
  type ResolvedField,
  type ResolvedModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';

/**
 * Model inheritance in the builder (plan polymorphic-types D13). The draft holds the model's own fields
 * only; display settings, title candidates and the document layout are worked out over the draft resolved
 * against its parent (the parent's effective fields first), so a child can use inherited fields there.
 */

/** The draft's parent, resolved over the active schema; undefined for a model that extends nothing. */
export type DraftParent = ResolvedModelDefinition | undefined;

/**
 * The draft as entries see it: the parent's effective fields (marked `inheritedFrom`) followed by its own,
 * the display merged over the parent's. A component, or a model without a parent, is returned as it is.
 */
export const resolveDraft = (draft: SchemaDefinition, parent: DraftParent): SchemaDefinition => {
  if (!parent || !isModelDefinition(draft)) {
    return draft;
  }
  const resolved: ResolvedModelDefinition = {
    ...draft,
    fields: [...parent.fields.map(markInherited(parent.id)), ...draft.fields],
    display: mergeDisplay(parent.display, draft.display, draft.fields),
    ancestorIds: [...parent.ancestorIds, parent.id],
  };
  return resolved;
};

/** An ancestor's field keeps the model that declares it; a parent's own fields are declared by the parent. */
const markInherited =
  (parentId: string) =>
  (field: ResolvedField): ResolvedField => ({ ...field, inheritedFrom: field.inheritedFrom ?? parentId });

/** The fields the draft inherits (resolved), ancestors' first; none without a parent. */
export const inheritedFieldsOf = (parent: DraftParent): ResolvedField[] =>
  parent ? parent.fields.map(markInherited(parent.id)) : [];

/** A definition from the model list with where it lives, to match a parent's scope against. */
export type ScopedModel = { definition: SchemaDefinition; scope: DefinitionScope; siteId: string | null };

/** Whether two definitions live in the same place: both shared, or both on the same site. */
const sameScope = (a: Pick<ScopedModel, 'scope' | 'siteId'>, b: Pick<ScopedModel, 'scope' | 'siteId'>) =>
  a.scope === b.scope && (a.scope === 'network' || a.siteId === b.siteId);

/**
 * The collections a model may extend: collections in its scope, other than itself and its descendants
 * (which would make a cycle), by label. `modelId` undefined: a model being created.
 */
export const parentChoices = (
  models: readonly ScopedModel[],
  index: DefinitionIndex,
  scope: Pick<ScopedModel, 'scope' | 'siteId'>,
  modelId?: string,
): ModelDefinition[] => {
  const excluded = new Set(modelId ? index.family(modelId) : []);
  return models
    .filter(
      (item) =>
        item.definition.kind === 'collection' && !excluded.has(item.definition.id) && sameScope(item, scope),
    )
    .map((item) => item.definition as ModelDefinition)
    .sort((a, b) => a.label.localeCompare(b.label));
};
