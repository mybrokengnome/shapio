import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { SYSTEM_FILTER_FIELDS, type ListFilter } from '../../helpers/filterOperators';

export const isSystemField = (key: string): key is (typeof SYSTEM_FILTER_FIELDS)[number] =>
  (SYSTEM_FILTER_FIELDS as readonly string[]).includes(key);

/** The live field a filter row targets, or undefined for a system attribute (createdAt, updatedAt). */
export const filterFieldOf = (model: ModelDefinition, filter: ListFilter): FieldDefinition | undefined =>
  isSystemField(filter.field)
    ? undefined
    : model.fields.find((field) => !field.deprecated && field.apiKey === filter.field);

/** A relation filter that names one entry (`author is <id>`): its chip shows the entry's title. */
export const isEntryFilter = (field: FieldDefinition | undefined, filter: ListFilter) =>
  field?.type === 'relation' && (filter.operator === '$eq' || filter.operator === '$ne');

/** Filters the quick relation chips manage: relation fields that take an equality condition. */
export const relationFilterFields = (model: ModelDefinition): FieldDefinition[] =>
  model.fields.filter((field) => !field.deprecated && field.type === 'relation');
