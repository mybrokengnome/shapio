import { isSeoField, stripFieldsOf, type DocumentLayout, type FieldDefinition } from '@shapio/schema';
import { isEmptyValue } from '@/fields/helpers/values';

/**
 * The strip's properties for these values: the configured ones, or the first five worth seeing at once —
 * required ones (what blocks publishing), ones with a value, and the SEO group even while empty, which
 * otherwise only showed behind "+N more" and read as missing.
 */
export const stripFieldsFor = (
  layout: DocumentLayout,
  values: Readonly<Record<string, unknown>>,
): FieldDefinition[] =>
  stripFieldsOf(
    layout,
    (field) => field.required || isSeoField(field) || !isEmptyValue(values[field.apiKey]),
  );
