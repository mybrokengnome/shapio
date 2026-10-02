import type { ComponentDefinition, FieldDefinition } from '@shapio/schema';
import type { ContentData } from '../db/contentData.js';
import type { ContentModel } from './model.js';
import { COMPONENT_KEY } from './validator/index.js';

/**
 * Relations live in the head JSON (field → ordered target entry IDs, ADR 0001). These helpers walk a
 * document, including components and dynamic zones, to derive `relation_edges` rows and to find the
 * targets a response mentions.
 */
export type RelationVisit = { field: FieldDefinition & { type: 'relation' }; entryIds: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const referenceIds = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string');

type Components = ContentModel['components'];

const walkFields = (
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  components: Components,
  visit: (relation: RelationVisit) => void,
) => {
  for (const field of fields) {
    const value = data[field.id];
    if (value === undefined || value === null) {
      continue;
    }
    if (field.type === 'relation') {
      visit({ field, entryIds: referenceIds(value) });
    } else if (field.type === 'component') {
      const component = components.get(field.settings.component)?.definition;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (component && isRecord(item)) {
          walkFields(component.fields, item, components, visit);
        }
      }
    } else if (field.type === 'dynamiczone' && Array.isArray(value)) {
      for (const item of value) {
        const component: ComponentDefinition | undefined = isRecord(item)
          ? components.get(String(item[COMPONENT_KEY]))?.definition
          : undefined;
        if (component && isRecord(item)) {
          walkFields(component.fields, item, components, visit);
        }
      }
    }
  }
};

/** Calls `visit` for every relation value in a document, in document order. */
export const walkRelations = (
  model: ContentModel,
  data: Readonly<ContentData>,
  visit: (relation: RelationVisit) => void,
  topLevelFields: readonly FieldDefinition[] = model.definition.fields,
) => walkFields(topLevelFields, data, model.components, visit);

export type RelationEdge = { fieldId: string; position: number; targetEntryId: string };

/** The `relation_edges` rows of one head: per field, targets numbered in document order. */
export const edgesOf = (model: ContentModel, data: Readonly<ContentData>): RelationEdge[] => {
  const positions = new Map<string, number>();
  const edges: RelationEdge[] = [];
  walkRelations(model, data, ({ field, entryIds }) => {
    for (const targetEntryId of entryIds) {
      const position = positions.get(field.id) ?? 0;
      positions.set(field.id, position + 1);
      edges.push({ fieldId: field.id, position, targetEntryId });
    }
  });
  return edges;
};

/** Every target a set of documents mentions, grouped by target model. */
export const targetsByModel = (
  model: ContentModel,
  documents: readonly Readonly<ContentData>[],
  topLevelFields?: readonly FieldDefinition[],
): Map<string, Set<string>> => {
  const targets = new Map<string, Set<string>>();
  for (const data of documents) {
    walkRelations(
      model,
      data,
      ({ field, entryIds }) => {
        const set = targets.get(field.settings.target) ?? new Set<string>();
        entryIds.forEach((id) => set.add(id));
        targets.set(field.settings.target, set);
      },
      topLevelFields,
    );
  }
  return targets;
};
