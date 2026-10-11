import { canonicalJson } from '../fileFormat/canonical.js';
import type { FieldDefinition, SchemaDefinition } from '../types/definitions.js';
import type { JsonValue } from '../types/json.js';
import { routeKeyOf } from '../validators/naming.js';
import type { SchemaChange } from './types.js';

const same = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const asJson = (value: unknown): JsonValue | undefined => value as JsonValue | undefined;

const DEFINITION_METADATA = ['label', 'description', 'category', 'icon', 'display'] as const;
const FIELD_METADATA = ['label', 'description', 'defaultValue', 'width'] as const;
const FIELD_FLAGS = [
  ['required', 'field.required'],
  ['localized', 'field.localized'],
  ['public', 'field.public'],
  ['deprecated', 'field.deprecated'],
  ['unique', 'field.unique'],
  ['filterable', 'field.filterable'],
  ['sortable', 'field.sortable'],
] as const;

const diffFieldSettings = (
  definitionId: string,
  before: FieldDefinition,
  after: FieldDefinition,
): SchemaChange[] => {
  const from = before.settings as Record<string, unknown>;
  const to = after.settings as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  return keys
    .filter((key) => !same(from[key], to[key]))
    .map((key) => ({
      kind: 'field.settings',
      definitionId,
      fieldId: after.id,
      property: key,
      from: asJson(from[key]),
      to: asJson(to[key]),
    }));
};

const diffField = (definitionId: string, before: FieldDefinition, after: FieldDefinition): SchemaChange[] => {
  const changes: SchemaChange[] = [];
  const base = { definitionId, fieldId: after.id };
  if (before.apiKey !== after.apiKey) {
    changes.push({ ...base, kind: 'field.apiKey', from: before.apiKey, to: after.apiKey });
  }
  for (const property of FIELD_METADATA) {
    if (!same(before[property], after[property])) {
      changes.push({
        ...base,
        kind: 'field.metadata',
        property,
        from: asJson(before[property]),
        to: asJson(after[property]),
      });
    }
  }
  if (!same(before.editor, after.editor)) {
    changes.push({ ...base, kind: 'field.editor', from: before.editor, to: after.editor });
  }
  if (before.type !== after.type) {
    // Settings are type-specific; a type change is planned as one conversion including its new settings.
    changes.push({ ...base, kind: 'field.type', from: before.type, to: after.type });
  } else {
    changes.push(...diffFieldSettings(definitionId, before, after));
  }
  for (const [flag, kind] of FIELD_FLAGS) {
    if (before[flag] !== after[flag]) {
      changes.push({ ...base, kind, from: before[flag], to: after[flag] });
    }
  }
  return changes;
};

/**
 * Every difference between two versions of a definition, matched by stable IDs (so a renamed field is a
 * rename, not a removal plus an addition). Pass `null` for a side that does not exist. The order is
 * deterministic: definition-level changes, then fields in the new order, then removed fields.
 */
export const diffDefinitions = (
  before: SchemaDefinition | null,
  after: SchemaDefinition | null,
): SchemaChange[] => {
  if (!before && !after) {
    return [];
  }
  if (!before) {
    return [
      {
        kind: 'definition.added',
        definitionId: (after as SchemaDefinition).id,
        to: (after as SchemaDefinition).apiKey,
      },
    ];
  }
  if (!after) {
    return [{ kind: 'definition.removed', definitionId: before.id, from: before.apiKey }];
  }
  const definitionId = after.id;
  const changes: SchemaChange[] = [];
  if (before.apiKey !== after.apiKey) {
    changes.push({ kind: 'definition.apiKey', definitionId, from: before.apiKey, to: after.apiKey });
  }
  const beforeRecord = before as unknown as Record<string, unknown>;
  const afterRecord = after as unknown as Record<string, unknown>;
  for (const property of DEFINITION_METADATA) {
    if (!same(beforeRecord[property], afterRecord[property])) {
      changes.push({
        kind: 'definition.metadata',
        definitionId,
        property,
        from: asJson(beforeRecord[property]),
        to: asJson(afterRecord[property]),
      });
    }
  }
  if (before.kind !== after.kind) {
    changes.push({ kind: 'model.kind', definitionId, from: before.kind, to: after.kind });
  }
  // Only between two collections: a kind switch is its own (breaking) change and adds or drops the plural.
  if (before.kind === 'collection' && after.kind === 'collection') {
    const [from, to] = [routeKeyOf(before), routeKeyOf(after)];
    if (from !== to) {
      changes.push({ kind: 'definition.pluralApiKey', definitionId, from, to });
    }
  }
  if (before.kind !== 'component' && after.kind !== 'component') {
    if (before.localized !== after.localized) {
      changes.push({ kind: 'model.localized', definitionId, from: before.localized, to: after.localized });
    }
    if (before.draftAndPublish !== after.draftAndPublish) {
      changes.push({
        kind: 'model.draftAndPublish',
        definitionId,
        from: before.draftAndPublish,
        to: after.draftAndPublish,
      });
    }
  }

  const beforeFields = new Map(before.fields.map((field) => [field.id, field]));
  const afterIds = new Set(after.fields.map((field) => field.id));
  for (const field of after.fields) {
    const previous = beforeFields.get(field.id);
    if (!previous) {
      changes.push({
        kind: 'field.added',
        definitionId,
        fieldId: field.id,
        to: field as unknown as JsonValue,
      });
    } else {
      changes.push(...diffField(definitionId, previous, field));
    }
  }
  for (const field of before.fields) {
    if (!afterIds.has(field.id)) {
      changes.push({
        kind: 'field.removed',
        definitionId,
        fieldId: field.id,
        from: field as unknown as JsonValue,
      });
    }
  }
  const keptBefore = before.fields.filter((field) => afterIds.has(field.id)).map((field) => field.id);
  const keptAfter = after.fields.filter((field) => beforeFields.has(field.id)).map((field) => field.id);
  if (!same(keptBefore, keptAfter)) {
    changes.push({ kind: 'field.order', definitionId, from: keptBefore, to: keptAfter });
  }
  return changes;
};
