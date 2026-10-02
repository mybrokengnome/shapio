import type { JsonValue, SchemaChange, SchemaDefinition, DataType } from '@shapio/schema';

/**
 * Where a definition's values live inside entries: for a model, its own heads at the root; for a
 * component, every model that embeds it, with the field-ID path from the entry root down to the component
 * or dynamic-zone field that holds it.
 */
export type ValueLocation = { modelId: string; path: string[] };

/** Prerequisite work that reads or rewrites content. Run by the content ports (package E). */
export type ContentStep =
  | { kind: 'validateRequired'; ownerId: string; fieldId: string; locations: ValueLocation[] }
  | { kind: 'backfill'; ownerId: string; fieldId: string; value: JsonValue; locations: ValueLocation[] }
  | {
      kind: 'validateValues';
      ownerId: string;
      /** Absent for definition-level rules (e.g. a singleton holds at most one entry). */
      fieldId?: string;
      locations: ValueLocation[];
    }
  | {
      kind: 'checkUnique';
      modelId: string;
      fieldId: string;
      /**
       * The field is already unique under the active schema (its type changes): its live registry rows stay in
       * force until activation, so the dry run stages its claims under a separate registry key and the
       * activation swaps them in.
       */
      rebuild?: boolean;
    }
  | { kind: 'convert'; ownerId: string; change: SchemaChange; locations: ValueLocation[] };

export type IndexStep = {
  kind: 'buildIndex';
  modelId: string;
  fieldId: string;
  fieldType: DataType;
  /** Index layout: with the locale column (localized models) or without. Absent in older plans: localized. */
  localized?: boolean;
  indexName: string;
};

export type PrerequisiteStep = ContentStep | IndexStep;

/** Work after activation, once nothing reads the old structure. */
export type FollowUpStep =
  | IndexStep
  | { kind: 'dropIndex'; indexName: string }
  | { kind: 'releaseUnique'; fieldId: string }
  /** Deletes a removed locale's heads, revisions and unique-registry rows (content ports). */
  | { kind: 'purgeLocale'; code: string };

export const isIndexStep = (step: PrerequisiteStep): step is IndexStep => step.kind === 'buildIndex';

/** Stable identity of a step, for checkpoints and de-duplication. */
export const stepKey = (step: PrerequisiteStep | FollowUpStep): string => {
  switch (step.kind) {
    case 'buildIndex':
    case 'dropIndex':
      return `${step.kind}:${step.indexName}`;
    case 'checkUnique':
      return `${step.kind}:${step.modelId}:${step.fieldId}`;
    case 'releaseUnique':
      return `${step.kind}:${step.fieldId}`;
    case 'purgeLocale':
      return `${step.kind}:${step.code}`;
    case 'convert':
      return `${step.kind}:${step.ownerId}:${step.change.kind}:${step.change.fieldId ?? ''}:${step.change.property ?? ''}`;
    default:
      return `${step.kind}:${step.ownerId}:${step.fieldId ?? ''}`;
  }
};

/** Value locations of a definition's fields across the given (proposed) schema. */
export const findValueLocations = (
  definitions: readonly SchemaDefinition[],
  ownerId: string,
): ValueLocation[] => {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const owner = byId.get(ownerId);
  if (!owner) {
    return [];
  }
  if (owner.kind !== 'component') {
    return [{ modelId: owner.id, path: [] }];
  }
  const locations: ValueLocation[] = [];
  // Walk down from every model; components cannot cycle (validated), so this terminates.
  const walk = (definition: SchemaDefinition, modelId: string, path: string[]) => {
    for (const field of definition.fields) {
      const children =
        field.type === 'component'
          ? [field.settings.component]
          : field.type === 'dynamiczone'
            ? field.settings.components
            : [];
      for (const childId of children) {
        const child = byId.get(childId);
        if (!child) {
          continue;
        }
        if (childId === ownerId) {
          locations.push({ modelId, path: [...path, field.id] });
        }
        walk(child, modelId, [...path, field.id]);
      }
    }
  };
  for (const definition of definitions) {
    if (definition.kind !== 'component') {
      walk(definition, definition.id, []);
    }
  }
  return locations;
};
