import type { FieldDefinition, SchemaDefinition } from '../types/definitions.js';

/**
 * Whether a field's values are stored per locale: on a localized model only (ADR 0004). The unique registry
 * keys such a field by locale and a shared one by `*`.
 */
const storedPerLocale = (definition: SchemaDefinition, field: FieldDefinition): boolean =>
  definition.kind !== 'component' && definition.localized === true && field.localized === true;

/**
 * Unique fields of a model whose values move between per-locale and shared storage in this change (the field's
 * or the model's `localized` flips). Their registry rows change key (locale ↔ `*`), and values that were unique
 * per locale may collide once shared, so each needs a uniqueness check that rebuilds its rows. Deprecated fields
 * are skipped: the registry does not track them.
 */
export const uniqueFieldsChangingLocalization = (
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): FieldDefinition[] => {
  if (!before || !after || after.kind === 'component') {
    return [];
  }
  return after.fields.filter((field) => {
    const previous = before.fields.find((candidate) => candidate.id === field.id);
    return (
      previous !== undefined &&
      field.unique === true &&
      !field.deprecated &&
      storedPerLocale(before, previous) !== storedPerLocale(after, field)
    );
  });
};
