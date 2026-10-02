import type { FieldDefinition, SchemaDefinition } from '../types/definitions.js';

/** Field types that may label entries: the only types `display.titleFieldId` accepts, and the fallback's. */
export const TITLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'text',
  'slug',
  'email',
  'uid',
  'enum',
]);

/**
 * Field types the list API's `q` search runs on, checked on top of the title field: an enum title is not
 * searchable. `url` is listed for search only; it is never a title.
 */
export const TEXT_TITLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'string',
  'text',
  'slug',
  'email',
  'url',
  'uid',
]);

/**
 * The field that labels a definition's entries in lists, pickers, relation summaries and search: the
 * configured `display.titleFieldId` when it points at a live (non-deprecated) field, otherwise the first
 * live field of a title type (TITLE_FIELD_TYPES) in field order, otherwise undefined. `titleFieldId` is
 * optional, so a model built without one still gets a readable title.
 */
export const effectiveTitleField = (definition: SchemaDefinition): FieldDefinition | undefined => {
  const live = definition.fields.filter((field) => !field.deprecated);
  const configured = definition.display.titleFieldId;
  return (
    (configured === undefined ? undefined : live.find((field) => field.id === configured)) ??
    live.find((field) => TITLE_FIELD_TYPES.has(field.type))
  );
};
