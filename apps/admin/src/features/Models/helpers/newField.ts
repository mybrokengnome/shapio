import {
  foldApiKey,
  RESERVED_FIELD_API_KEYS,
  type DataType,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { deriveApiKey } from './deriveApiKey';
import { titleFieldCandidates } from './display';
import { createField } from './draft';

const RESERVED: ReadonlySet<string> = new Set(RESERVED_FIELD_API_KEYS.map(foldApiKey));

/**
 * A label and API ID for a field added with one click: `baseLabel` ("New field"), then "New field 2",
 * "New field 3"... until neither the label nor its API ID (case-folded) is taken or reserved.
 */
export const uniqueNewFieldName = (
  definition: SchemaDefinition,
  baseLabel: string,
): { label: string; apiKey: string } => {
  const labels = new Set(definition.fields.map((field) => field.label));
  const apiKeys = new Set(definition.fields.map((field) => foldApiKey(field.apiKey)));
  for (let number = 1; ; number += 1) {
    const label = number === 1 ? baseLabel : `${baseLabel} ${number}`;
    const apiKey = deriveApiKey(label);
    const folded = foldApiKey(apiKey);
    if (!labels.has(label) && !apiKeys.has(folded) && !RESERVED.has(folded)) {
      return { label, apiKey };
    }
  }
};

/**
 * Changes a field's data type: its type-specific settings, editor and default value start over with the new
 * type's defaults; its ID, position, names, help text and options are kept. A title field that can no
 * longer label entries is unset, and the title-field rule of `withAddedField` applies again. Other
 * references that no longer fit show as draft issues.
 */
export const withFieldType = (
  definition: SchemaDefinition,
  fieldId: string,
  type: DataType,
): SchemaDefinition => {
  const current = definition.fields.find((field) => field.id === fieldId);
  if (!current || current.type === type) {
    return definition;
  }
  const fresh = createField(definition, { type, label: current.label, apiKey: current.apiKey });
  const { defaultValue: _defaultValue, ...kept } = current as FieldDefinition & { defaultValue?: unknown };
  const next = { ...kept, type, settings: fresh.settings, editor: fresh.editor } as FieldDefinition;
  const fields = definition.fields.map((field) => (field.id === fieldId ? next : field));
  const others = { ...definition, fields: definition.fields.filter((field) => field.id !== fieldId) };
  const display: Record<string, unknown> = { ...definition.display };
  const placed = { ...definition, fields, display };
  const isCandidate = titleFieldCandidates(placed).some((candidate) => candidate.id === fieldId);
  if (display.titleFieldId === fieldId && !isCandidate) {
    delete display.titleFieldId;
  } else if (display.titleFieldId === undefined && isCandidate && titleFieldCandidates(others).length === 0) {
    display.titleFieldId = fieldId;
  }
  return placed;
};

/**
 * `withFieldType`, except that going back to the saved field's own type restores its saved settings,
 * editor and default value, so trying another type and returning leaves nothing changed.
 */
export const withFieldTypeOrSaved = (
  definition: SchemaDefinition,
  fieldId: string,
  type: DataType,
  saved: FieldDefinition | undefined,
): SchemaDefinition => {
  const next = withFieldType(definition, fieldId, type);
  if (saved?.type !== type) {
    return next;
  }
  const { settings, editor } = saved;
  const defaultValue = (saved as { defaultValue?: unknown }).defaultValue;
  return {
    ...next,
    fields: next.fields.map((field) =>
      field.id === fieldId
        ? ({
            ...field,
            settings,
            editor,
            ...(defaultValue === undefined ? {} : { defaultValue }),
          } as FieldDefinition)
        : field,
    ),
  };
};
