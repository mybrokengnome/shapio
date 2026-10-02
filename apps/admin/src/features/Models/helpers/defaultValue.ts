import type { FieldDefinition } from '@shapio/schema';

/** Types stored as JSON strings whose default is typed as text (the validator checks the format). */
const TEXT_DEFAULT_TYPES: ReadonlySet<string> = new Set([
  'string',
  'text',
  'slug',
  'email',
  'url',
  'uid',
  'date',
  'datetime',
  'time',
  'decimal',
  'biginteger',
]);

/** Whether the builder offers a default value for this field (single scalar values only). */
export const supportsDefaultValue = (field: FieldDefinition) =>
  TEXT_DEFAULT_TYPES.has(field.type) ||
  field.type === 'number' ||
  field.type === 'integer' ||
  field.type === 'boolean' ||
  (field.type === 'enum' && !field.settings.multiple);
