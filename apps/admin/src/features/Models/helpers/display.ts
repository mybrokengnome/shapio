import {
  effectiveLayout,
  isCanvasEligible,
  isCoverEligible,
  validateDefinition,
  type FieldDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { pruneLayout, withKey } from './draft';

/**
 * Fields that may label entries (`display.titleFieldId`). Asks the definition validator rather than
 * duplicating its rule: each field is checked alone, as the only field of a minimal definition.
 */
export const titleFieldCandidates = (definition: SchemaDefinition): FieldDefinition[] =>
  definition.fields.filter((field) => {
    const probe = {
      ...definition,
      fields: [field],
      display: { titleFieldId: field.id },
    } as SchemaDefinition;
    return !validateDefinition(probe).some((found) => found.path === '/display/titleFieldId');
  });

/**
 * Appends a new field. The first field that can label entries also becomes the title field while none is
 * set, so entries get a readable title without a trip to the model settings. A title field left unset on
 * purpose next to existing candidates stays unset. A new block field (rich text, a zone, a repeatable list,
 * a gallery) joins the document's configured fields, as it would join the automatic ones.
 */
export const withAddedField = (definition: SchemaDefinition, field: FieldDefinition): SchemaDefinition => {
  const next = { ...definition, fields: [...definition.fields, field] };
  const becomesTitle =
    definition.display.titleFieldId === undefined &&
    titleFieldCandidates(definition).length === 0 &&
    titleFieldCandidates(next).some((candidate) => candidate.id === field.id);
  const titled = becomesTitle ? { ...next, display: { ...next.display, titleFieldId: field.id } } : next;
  if (
    titled.kind === 'component' ||
    titled.display.canvasFieldIds === undefined ||
    !isCanvasEligible(field)
  ) {
    return titled;
  }
  return {
    ...titled,
    display: { ...titled.display, canvasFieldIds: [...titled.display.canvasFieldIds, field.id] },
  };
};

/** Why a field's "Show in document" switch can't change: it is the title, the chosen cover, or the last one. */
export type PlacementLock = 'title' | 'cover' | 'last';

export type DocumentPlacement = { inDocument: boolean; lock: PlacementLock | undefined };

/**
 * Whether the entry document shows the field (`effectiveLayout`), and why that can't be switched: the title
 * is the document's heading, the cover chosen in Display sits above it, and the last document field stays
 * because an empty list means the automatic layout.
 */
export const documentPlacementOf = (model: ModelDefinition, field: FieldDefinition): DocumentPlacement => {
  const layout = effectiveLayout(model);
  const inDocument = layout.canvas.some((candidate) => candidate.id === field.id);
  const lock: PlacementLock | undefined =
    layout.title?.id === field.id
      ? 'title'
      : model.display.coverFieldId === field.id && layout.cover?.id === field.id
        ? 'cover'
        : inDocument && layout.canvas.length === 1
          ? 'last'
          : undefined;
  return { inDocument, lock };
};

/**
 * Puts the field in the document or takes it out. The automatic layout becomes an explicit list first; a
 * field put in goes before the first listed field that follows it in field order. Taking a field out keeps
 * the others, and `pruneLayout` keeps the strip and cover consistent.
 */
export const withDocumentPlacement = (
  model: ModelDefinition,
  fieldId: string,
  inDocument: boolean,
): ModelDefinition => {
  const current = effectiveLayout(model).canvas.map((field) => field.id);
  const without = current.filter((id) => id !== fieldId);
  let next = without;
  if (inDocument) {
    const order = new Map(model.fields.map((field, index) => [field.id, index]));
    const position = order.get(fieldId) ?? model.fields.length;
    const before = without.findIndex((id) => (order.get(id) ?? 0) > position);
    next =
      before === -1
        ? [...without, fieldId]
        : [...without.slice(0, before), fieldId, ...without.slice(before)];
  }
  const display = withKey(model.display, 'canvasFieldIds', next.length > 0 ? next : undefined);
  return pruneLayout({ ...model, display }) as ModelDefinition;
};

export type DocumentLayoutChoices = {
  /** Single image fields that can be the cover. */
  coverOptions: FieldDefinition[];
  /** Canvas-eligible fields: the current canvas in its order, then the others in field order. */
  canvasOptions: FieldDefinition[];
  /** The canvas as the document shows it (configured, or the default). */
  canvas: string[];
  /** Fields the strip can show (the document's properties). */
  stripOptions: FieldDefinition[];
};

/** What the Display section offers for the entry document, from the definition being edited. */
export const documentLayoutChoices = (model: ModelDefinition): DocumentLayoutChoices => {
  const live = model.fields.filter((field) => !field.deprecated);
  const layout = effectiveLayout(model);
  const canvas = layout.canvas.map((field) => field.id);
  const others = live.filter((field) => isCanvasEligible(field) && !canvas.includes(field.id));
  return {
    coverOptions: live.filter(isCoverEligible),
    canvasOptions: [...layout.canvas, ...others],
    canvas,
    stripOptions: layout.properties,
  };
};
