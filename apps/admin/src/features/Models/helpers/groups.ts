import type { FieldGroup, ModelDefinition } from '@shapio/schema';
import { withKey } from './draft';
import { withoutGroupField } from './groupFields';

/**
 * Sections of a model's entries: a view over `display.groups`. A field is in one section at most; the order
 * of sections and of their fields comes from field order (`effectiveFormLayout`), so these helpers never
 * reorder anything. An empty `groups` list is written as unset so the definition stays minimal.
 */

const withGroups = (model: ModelDefinition, groups: readonly FieldGroup[]): ModelDefinition => ({
  ...model,
  display: withKey(model.display, 'groups', groups.length > 0 ? groups : undefined),
});

/** The ID of the section a field is in, if any. */
export const groupIdOf = (model: ModelDefinition, fieldId: string): string | undefined =>
  model.display.groups?.find((group) => group.fieldIds.includes(fieldId))?.id;

/** Moves a field into the section `groupId`, or out of every section with `undefined`. */
export const withFieldInGroup = (
  model: ModelDefinition,
  fieldId: string,
  groupId: string | undefined,
): ModelDefinition => {
  const groups = model.display.groups ?? [];
  if (groupIdOf(model, fieldId) === groupId || (groupId && !groups.some((group) => group.id === groupId))) {
    return model;
  }
  const next = withoutGroupField(groups, fieldId).map((group) =>
    group.id === groupId ? { ...group, fieldIds: [...group.fieldIds, fieldId] } : group,
  );
  return withGroups(model, next);
};

/** Adds a section `{ id, label }` holding the field, which leaves the section it was in. */
export const withFieldInNewGroup = (
  model: ModelDefinition,
  fieldId: string,
  group: { id: string; label: string },
): ModelDefinition =>
  withGroups(model, [
    ...withoutGroupField(model.display.groups ?? [], fieldId),
    { ...group, fieldIds: [fieldId] },
  ]);

/** Renames a section; its ID, and so every reference to it, stays the same. */
export const withGroupLabel = (model: ModelDefinition, groupId: string, label: string): ModelDefinition =>
  withGroups(
    model,
    (model.display.groups ?? []).map((group) => (group.id === groupId ? { ...group, label } : group)),
  );

/** Removes a section; its fields stay and become ungrouped. */
export const withoutGroup = (model: ModelDefinition, groupId: string): ModelDefinition =>
  withGroups(
    model,
    (model.display.groups ?? []).filter((group) => group.id !== groupId),
  );
