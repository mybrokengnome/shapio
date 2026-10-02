import type { ComponentDefinition, FieldDefinition, ModelDefinition } from '@shapio/schema';
import { liveFields, toFormValues } from '@/fields/helpers/formValues';
import { summarizeValue } from '@/fields/helpers/summary';
import { isEmptyValue, isSameContent, type FormValues } from '@/fields/helpers/values';

export type FieldChange = {
  field: FieldDefinition;
  kind: 'added' | 'removed' | 'changed';
  /** Short readable values (empty for structured values, which show their kind of change only). */
  before: string;
  after: string;
};

/**
 * What restoring a revision would change, field by field: the revision's values compared with the form's
 * current values. Text-like values show before/after summaries; structured ones (components, lists, rich
 * text) are reported as changed.
 */
export const diffRevision = (
  model: ModelDefinition,
  components: ReadonlyMap<string, ComponentDefinition>,
  revisionData: Readonly<Record<string, unknown>>,
  current: FormValues,
): FieldChange[] => {
  const revision = toFormValues(model.fields, revisionData, components);
  return liveFields(model.fields).flatMap((field): FieldChange[] => {
    const now = current[field.apiKey];
    const then = revision[field.apiKey];
    if (isSameContent(now, then)) {
      return [];
    }
    const kind = isEmptyValue(now) ? 'added' : isEmptyValue(then) ? 'removed' : 'changed';
    return [{ field, kind, before: summarizeValue(field, now), after: summarizeValue(field, then) }];
  });
};
