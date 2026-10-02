import {
  classifyChange,
  type ClassifiedChange,
  type DataType,
  type FieldDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { withFieldType } from './newField';

/**
 * How the planner would classify changing a saved field to `to` (null for its own type), asked of the
 * same classifier the server uses, on the definition as the change would leave it, so the type grid and
 * the review agree on what is supported, breaking or destructive.
 */
export const classifyFieldTypeChange = (
  saved: SchemaDefinition,
  field: FieldDefinition,
  to: DataType,
): ClassifiedChange | null =>
  field.type === to
    ? null
    : classifyChange(
        { kind: 'field.type', definitionId: saved.id, fieldId: field.id, from: field.type, to },
        { before: saved, after: withFieldType(saved, field.id, to) },
      );
