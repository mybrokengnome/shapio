import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { liveFields } from '@/fields/helpers/formValues';
import { titleFieldOf } from '@/fields/helpers/titles';

const MAX_DEFAULT_COLUMNS = 3;
const LISTABLE_TYPES: ReadonlySet<string> = new Set([
  'string',
  'slug',
  'email',
  'url',
  'uid',
  'number',
  'integer',
  'decimal',
  'biginteger',
  'boolean',
  'date',
  'datetime',
  'time',
  'enum',
]);
/** Values too large or nested to read in a table cell. */
const UNLISTABLE_TYPES: ReadonlySet<string> = new Set(['richtext', 'json', 'component', 'dynamiczone']);

/** Fields the column chooser offers: the title first, then every field with a readable cell. */
export const columnChoicesFor = (model: ModelDefinition): FieldDefinition[] => {
  const title = titleFieldOf(model);
  const rest = liveFields(model.fields).filter(
    (field) => field !== title && !UNLISTABLE_TYPES.has(field.type),
  );
  return [...(title ? [title] : []), ...rest];
};

/** The list's default columns: the model's `display.listFieldIds`, else its title and a few short fields. */
export const columnsFor = (model: ModelDefinition): FieldDefinition[] => {
  const fields = liveFields(model.fields);
  const configured = (model.display.listFieldIds ?? [])
    .map((id) => fields.find((field) => field.id === id))
    .filter((field): field is FieldDefinition => field !== undefined);
  if (configured.length > 0) {
    return configured;
  }
  const title = titleFieldOf(model);
  const rest = fields.filter((field) => field !== title && LISTABLE_TYPES.has(field.type));
  return [...(title ? [title] : []), ...rest].slice(0, MAX_DEFAULT_COLUMNS);
};
