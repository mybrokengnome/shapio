import type { ComponentDefinition, FieldDefinition, SchemaDefinition } from '@shapio/schema';
import type { ContentData } from '../db/contentData.js';
import { matchesFieldType } from './compiler/select.js';
import type { ContentModel } from './model.js';
import { COMPONENT_KEY, type ModelValidator, type ValidationOutcome } from './validator/index.js';
import { pointer, type ContentIssue } from './validator/issues.js';

/**
 * An older revision's data as the current schema reads it, in storage form: a value written before its field's
 * type changed is left out, exactly where the read path (`projectData`) shows it as empty, so restoring a
 * revision brings back what its view shows. Values of removed and deprecated fields are kept, as the validator
 * keeps them.
 */

/** A value left out, by its API-key pointer (as validation issues name it) and its field's current type. */
export type DroppedValue = { path: string; type: FieldDefinition['type'] };

type Components = ContentModel['components'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const walkComponent = (
  component: ComponentDefinition | undefined,
  value: unknown,
  path: string,
  dropped: DroppedValue[],
  components: Components,
): unknown =>
  component && isRecord(value) ? walkFields(component, value, path, dropped, components) : value;

const walkValue = (
  field: FieldDefinition,
  value: unknown,
  path: string,
  dropped: DroppedValue[],
  components: Components,
): unknown => {
  switch (field.type) {
    case 'component': {
      const component = components.get(field.settings.component)?.definition;
      return Array.isArray(value)
        ? value.map((item, index) =>
            walkComponent(component, item, pointer(path, index), dropped, components),
          )
        : walkComponent(component, value, path, dropped, components);
    }
    case 'dynamiczone':
      return (value as unknown[]).map((item, index) =>
        walkComponent(
          isRecord(item) ? components.get(String(item[COMPONENT_KEY]))?.definition : undefined,
          item,
          pointer(path, index),
          dropped,
          components,
        ),
      );
    default:
      return value;
  }
};

function walkFields(
  definition: SchemaDefinition,
  data: Readonly<Record<string, unknown>>,
  path: string,
  dropped: DroppedValue[],
  components: Components,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...data };
  for (const field of definition.fields) {
    const value = data[field.id];
    if (field.deprecated || value === undefined || value === null) {
      continue;
    }
    const at = pointer(path, field.apiKey);
    if (!matchesFieldType(field, value)) {
      delete output[field.id];
      dropped.push({ path: at, type: field.type });
      continue;
    }
    output[field.id] = walkValue(field, value, at, dropped, components);
  }
  return output;
}

/** The revision's data without values of another type than their field's current one, and where they were. */
export const dropForeignTypedValues = (
  model: ContentModel,
  data: Readonly<ContentData>,
): { data: ContentData; dropped: DroppedValue[] } => {
  const dropped: DroppedValue[] = [];
  return { data: walkFields(model.definition, data, '', dropped, model.components), dropped };
};

/** Names the type change on an issue about a value this revision held under an earlier type. */
const explainDroppedValues = (
  issues: readonly ContentIssue[],
  dropped: readonly DroppedValue[],
): ContentIssue[] =>
  issues.map((issue) => {
    const change = dropped.find((value) => value.path === issue.path);
    return change
      ? {
          ...issue,
          message: `${issue.message} (this version's value was saved before the field's type changed to ${change.type})`,
        }
      : issue;
  });

/**
 * Validates an older revision for restoring or republishing it under the current schema: values of an earlier
 * type are left out first, and an issue they cause (a required field now empty) says so.
 */
export const validateRevisionData = (
  validator: ModelValidator,
  data: Readonly<ContentData>,
): ValidationOutcome => {
  const current = dropForeignTypedValues(validator.model, data);
  const outcome = validator.validate(current.data);
  return { ...outcome, issues: explainDroppedValues(outcome.issues, current.dropped) };
};
