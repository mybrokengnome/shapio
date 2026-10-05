import type { DataType } from '../types/dataTypes.js';
import type { FieldDefinition, ModelDefinition } from '../types/definitions.js';
import { effectiveTitleField } from './titleField.js';

/**
 * Data types that are blocks of the entry document's canvas by default. Components must also be repeatable
 * and media must hold several files (`isCanvasEligible`); a single component or file is a property unless
 * `display.canvasFieldIds` places it in the document.
 */
export const CANVAS_ELIGIBLE: ReadonlySet<DataType> = new Set<DataType>([
  'richtext',
  'dynamiczone',
  'component',
  'media',
]);

/** Title types that the document edits inline as its H1; any other title type stays a property. */
export const INLINE_TITLE_TYPES: ReadonlySet<DataType> = new Set<DataType>(['string', 'text']);

/** How many properties the strip shows when `display.stripFieldIds` is not set. */
export const STRIP_DEFAULT_COUNT = 5;

/**
 * The automatic rule: the fields written in the document while `display.canvasFieldIds` is unset (rich
 * text, dynamic zones, repeatable components, media with several files). Also what a canvas field can take
 * between blocks: only these hold blocks.
 */
export const isCanvasEligible = (field: FieldDefinition): boolean => {
  switch (field.type) {
    case 'richtext':
    case 'dynamiczone':
      return true;
    case 'component':
      return field.settings.repeatable;
    case 'media':
      return field.settings.multiple;
    default:
      return false;
  }
};

/**
 * Whether `display.canvasFieldIds` may list the field: any field but the entry's title (`effectiveTitleField`),
 * which the document shows as its heading. A configured cover is refused by the validator; an automatically
 * chosen one placed in the document simply stops being the cover.
 */
export const isDocumentPlaceable = (field: FieldDefinition, title: FieldDefinition | undefined): boolean =>
  field.id !== title?.id;

/** A single `media` field that may hold an image. */
export const isCoverEligible = (field: FieldDefinition): boolean =>
  field.type === 'media' &&
  !field.settings.multiple &&
  (field.settings.allowedKinds === undefined || field.settings.allowedKinds.includes('image'));

/** Properties under one of the model's `display.groups` (`label` undefined for ungrouped fields). */
export type PropertyGroup = { id: string; label: string | undefined; fields: FieldDefinition[] };

export type DocumentLayout = {
  /** The field that labels the entry (`effectiveTitleField`), if any. */
  title: FieldDefinition | undefined;
  /** The title is edited inline as the H1 (string/text); otherwise it is shown read-only and is a property. */
  titleInline: boolean;
  cover: FieldDefinition | undefined;
  /**
   * The fields written in the document, in order: block fields (`isCanvasEligible`) and any other field
   * that `display.canvasFieldIds` places there, each under its heading.
   */
  canvas: FieldDefinition[];
  /** Every other live field, ordered by `display.groups`, then field order. */
  properties: FieldDefinition[];
  /** `properties` split by group, for the settings drawer and the property grid. */
  propertyGroups: PropertyGroup[];
  /**
   * The strip's configured properties, or null when it is not configured: then it shows the first
   * STRIP_DEFAULT_COUNT non-empty properties (`stripFieldsOf`), which depends on the entry's values.
   */
  strip: FieldDefinition[] | null;
};

const byIds = (live: readonly FieldDefinition[], ids: readonly string[] | undefined) =>
  (ids ?? [])
    .map((id) => live.find((field) => field.id === id))
    .filter((field): field is FieldDefinition => field !== undefined);

const unique = (fields: readonly FieldDefinition[]) => [...new Map(fields.map((f) => [f.id, f])).values()];

const groupProperties = (model: ModelDefinition, properties: readonly FieldDefinition[]): PropertyGroup[] => {
  const groups = (model.display.groups ?? [])
    .map((group) => ({ id: group.id, label: group.label, fields: byIds(properties, group.fieldIds) }))
    .filter((group) => group.fields.length > 0);
  const grouped = new Set(groups.flatMap((group) => group.fields.map((field) => field.id)));
  const rest = properties.filter((field) => !grouped.has(field.id));
  return rest.length > 0 ? [...groups, { id: 'other', label: undefined, fields: rest }] : groups;
};

const coverOf = (model: ModelDefinition, live: readonly FieldDefinition[], canvas: ReadonlySet<string>) => {
  const configured = byIds(live, model.display.coverFieldId ? [model.display.coverFieldId] : [])[0];
  if (configured && isCoverEligible(configured) && !canvas.has(configured.id)) {
    return configured;
  }
  return live.find((field) => isCoverEligible(field) && !canvas.has(field.id));
};

/**
 * The entry document's layout: title, cover, document fields and properties. Configured `display` ids win
 * when they point at live, eligible fields; anything else falls back to the defaults (canvas: every block
 * field in field order; cover: the first single image field not in the canvas). Deprecated, unknown ids and
 * the title are skipped, so a stale definition never breaks the editor. Pure: no values, no I/O.
 */
export const effectiveLayout = (model: ModelDefinition): DocumentLayout => {
  const live = model.fields.filter((field) => !field.deprecated);
  const title = effectiveTitleField(model);
  const titleInline = title !== undefined && INLINE_TITLE_TYPES.has(title.type);
  const configuredCanvas = unique(
    byIds(live, model.display.canvasFieldIds).filter((field) => isDocumentPlaceable(field, title)),
  );
  const canvasCandidates =
    model.display.canvasFieldIds === undefined ? live.filter(isCanvasEligible) : configuredCanvas;
  const cover = coverOf(model, live, new Set(configuredCanvas.map((field) => field.id)));
  const canvas = canvasCandidates.filter((field) => field.id !== cover?.id);
  const placed = new Set([
    ...canvas.map((field) => field.id),
    ...(cover ? [cover.id] : []),
    ...(titleInline && title ? [title.id] : []),
  ]);
  const propertyGroups = groupProperties(
    model,
    live.filter((field) => !placed.has(field.id)),
  );
  const properties = propertyGroups.flatMap((group) => group.fields);
  const strip =
    model.display.stripFieldIds === undefined ? null : unique(byIds(properties, model.display.stripFieldIds));
  return { title, titleInline, cover, canvas, properties, propertyGroups, strip };
};

/** The strip's properties: the configured ones, or the first `limit` that `hasValue` says are non-empty. */
export const stripFieldsOf = (
  layout: DocumentLayout,
  hasValue: (field: FieldDefinition) => boolean,
  limit = STRIP_DEFAULT_COUNT,
): FieldDefinition[] => layout.strip ?? layout.properties.filter(hasValue).slice(0, limit);
