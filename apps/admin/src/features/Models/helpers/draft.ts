import {
  canonicalJson,
  DEFAULT_EDITORS,
  effectiveTitleField,
  isCoverEligible,
  isDocumentPlaceable,
  isCustomEditorId,
  listCompatibleEditors,
  renormalizeDefinition,
  type DataType,
  type FieldDefinition,
  type JsonValue,
  type SchemaDefinition,
} from '@shapio/schema';
import { newStableId } from '@/helpers/stableId';
import { withoutGroupField } from './groupFields';

/** Required settings a new field starts with; the user fills them in (inline errors until then). */
const INITIAL_SETTINGS: Partial<Record<DataType, Record<string, JsonValue>>> = {
  enum: { values: [] },
  relation: { target: '', cardinality: 'one' },
  component: { component: '' },
  dynamiczone: { components: [] },
};

/** A new field with Shapio's defaults (public, optional, default editor), normalized like the server does. */
export const createField = (
  definition: SchemaDefinition,
  input: {
    type: DataType;
    label: string;
    apiKey: string;
    /** Replaces the type's initial settings (defaults still apply to what's left out). */
    settings?: Record<string, JsonValue>;
    editorId?: string;
    localized?: boolean;
  },
): FieldDefinition => {
  const raw = {
    id: newStableId(),
    apiKey: input.apiKey,
    label: input.label,
    type: input.type,
    settings: input.settings ?? INITIAL_SETTINGS[input.type] ?? {},
    ...(input.editorId === undefined ? {} : { editor: { id: input.editorId } }),
    ...(input.localized === undefined ? {} : { localized: input.localized }),
  };
  const normalized = renormalizeDefinition({
    ...definition,
    fields: [raw],
  } as unknown as SchemaDefinition);
  return normalized.fields[0] as FieldDefinition;
};

/** Sets (or, with `undefined`, removes) one key of a record, immutably. */
export const withKey = <T extends Record<string, unknown>>(record: T, key: string, value: unknown): T => {
  const next: Record<string, unknown> = { ...record };
  if (value === undefined) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next as T;
};

export const withSetting = (field: FieldDefinition, key: string, value: unknown): FieldDefinition =>
  ({ ...field, settings: withKey(field.settings as Record<string, unknown>, key, value) }) as FieldDefinition;

/** Whether the draft means something different from the active definition (compared normalized). */
export const isDraftDirty = (draft: SchemaDefinition, base: SchemaDefinition): boolean =>
  canonicalJson(renormalizeDefinition(draft)) !== canonicalJson(renormalizeDefinition(base));

/** Moves the item at `from` to `to`, immutably. */
export const moveItem = <T>(items: readonly T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
};

/** Removes a field and every reference to it (display settings, slug sources), so the draft stays valid. */
export const removeField = (definition: SchemaDefinition, fieldId: string): SchemaDefinition => {
  const fields = definition.fields
    .filter((field) => field.id !== fieldId)
    .map((field) =>
      field.type === 'slug' && field.settings.sourceFieldId === fieldId
        ? withSetting(field, 'sourceFieldId', undefined)
        : field,
    );
  const display: Record<string, unknown> = { ...definition.display };
  if (display.titleFieldId === fieldId) {
    delete display.titleFieldId;
  }
  if ('listFieldIds' in definition.display && definition.display.listFieldIds) {
    display.listFieldIds = definition.display.listFieldIds.filter((id) => id !== fieldId);
  }
  if ('defaultSort' in definition.display && definition.display.defaultSort?.fieldId === fieldId) {
    delete display.defaultSort;
  }
  if (definition.display.groups) {
    const groups = withoutGroupField(definition.display.groups, fieldId);
    if (groups.length > 0) {
      display.groups = groups;
    } else {
      delete display.groups;
    }
  }
  return pruneLayout({ ...definition, fields, display });
};

/**
 * Drops document-layout references (`canvasFieldIds`, `coverFieldId`, `stripFieldIds`) that no longer
 * point at an eligible field, after a field is removed, changes type or settings, moves, or becomes the
 * title (the title is the document's heading, never a field in it). Keeps the draft valid without a trip to
 * Display.
 */
export const pruneLayout = (definition: SchemaDefinition): SchemaDefinition => {
  if (definition.kind === 'component') {
    return definition;
  }
  const { canvasFieldIds, coverFieldId, stripFieldIds } = definition.display;
  if (canvasFieldIds === undefined && coverFieldId === undefined && stripFieldIds === undefined) {
    return definition;
  }
  const fields = new Map(definition.fields.map((field) => [field.id, field]));
  const eligible = (id: string, test: (field: FieldDefinition) => boolean) => {
    const field = fields.get(id);
    return field !== undefined && test(field);
  };
  const title = effectiveTitleField(definition);
  const canvas = canvasFieldIds?.filter((id) => eligible(id, (field) => isDocumentPlaceable(field, title)));
  const cover =
    coverFieldId !== undefined && eligible(coverFieldId, isCoverEligible) && !canvas?.includes(coverFieldId)
      ? coverFieldId
      : undefined;
  const strip = stripFieldIds?.filter((id) => fields.has(id) && id !== cover && !(canvas ?? []).includes(id));
  let display = withKey(definition.display, 'canvasFieldIds', canvas);
  display = withKey(display, 'coverFieldId', cover);
  display = withKey(display, 'stripFieldIds', strip);
  return { ...definition, display };
};

/**
 * Keeps the field's editor usable after a settings change (e.g. radio buttons cannot edit a multi-value
 * enum): an incompatible built-in editor is replaced by the first compatible one. Custom editors are kept.
 */
export const withCompatibleEditor = (field: FieldDefinition): FieldDefinition => {
  if (isCustomEditorId(field.editor.id)) {
    return field;
  }
  const compatible = listCompatibleEditors(field);
  if (compatible.some((entry) => entry.id === field.editor.id)) {
    return field;
  }
  return { ...field, editor: { id: compatible[0]?.id ?? DEFAULT_EDITORS[field.type], options: {} } };
};
